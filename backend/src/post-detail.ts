/**
 * 포스트 상세 — §11.7.4. RLS(posts)가 삭제·차단·공개범위를 걸러준다 —
 * 조회 결과가 0행이면 곧 "이 글을 볼 수 없다"는 뜻이고, 라우트가 404로 옮긴다.
 */
import { appPool, withRelationCtx } from './db.ts';
export type EmoticonType = 'empathy' | 'cheer' | 'funny' | 'surprise' | 'sad' | 'helpful';
import type { LogPostVisibility } from './posts.ts';

export type PostDetail = {
  /** 내부 PK(uuid) — 댓글/반응/신고 등 내부 조회·API 호출에만 쓴다. URL에는 절대 안 나간다. */
  id: string;
  /** 공개 URL에 쓰는 짧은 불투명 ID(0038, PRD §3.3). */
  publicId: string;
  title: string;
  body: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  /** 🔒 M4 — 뉴스봇·다이제스트봇 글 "AI 에디터" 배지(users.is_agent). */
  authorIsAgent: boolean;
  categoryId: string | null;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  myReaction: EmoticonType | null;
  /** 🔒 사용자 지시(2026-08, "글 수정도 똑같이 기능이 구현되어야해") — "글
   * 수정" 모달을 이 글의 현재 공개범위로 미리 채우는 데 쓴다(로그 전용
   * 글에서만 의미 있음, 게시판 글이면 항상 'public'이라 무시된다). */
  visibility: LogPostVisibility;
  /**
   * 🔒 사용자 지시(2026-09-06, "삭제된 글이면 모더레이터가 볼 때 삭제된
   * 글이라고 표시가 되어야") — RLS(posts_select_*, 0036)는 모더레이터가
   * 삭제한 전체공개 글을 UPDATE의 WITH CHECK 통과를 위해 계속 보여준다
   * (deleted_at 이후에도 카브아웃이 참이어야 함, 불변식 22). 일반 유저는
   * 애초에 이 행 자체를 못 봐서(RLS가 0행) null만 받는다 — non-null이면
   * 보는 사람이 모더레이터라는 뜻이라 화면에서 그대로 "삭제됨" 배지로 쓴다.
   */
  deletedAt: string | null;
  /** 🔒 M2 — 조회수(0050, 카운터 — Redis dedup으로 증가하는 posts.views). */
  views: number;
  /** 🔒 M2 — Q&A 채택된 답변 comment id. null 아니면 상세에서 "채택" 배지를 이 id로 쓴다. */
  adoptedCommentId: string | null;
  /** 🔒 M2 — 시리즈(개발 로그 연재) 헤더. 글 속한 시리즈가 있으면 채워진다. */
  series: { id: string; title: string } | null;
};

const pool = appPool('exists');

/**
 * 🔒 사용자 지시(2026-08-21, "URL이 너무 길어서 줄이고 싶어") — 라우트
 * `[postId]` 세그먼트는 이제 내부 uuid가 아니라 posts.public_id(0038)다.
 * 반환하는 `id`(내부 uuid)를 호출부(post 상세 페이지)가 댓글·반응·신고 등
 * 나머지 모든 조회에 그대로 써야 한다 — publicId를 다른 테이블 조회에
 * 섞어 쓰면 전부 0행으로 조용히 실패한다.
 */
export async function fetchPostDetail(userId: string | null, publicId: string): Promise<PostDetail | null> {
  const row = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{
      id: string;
      public_id: string;
      title: string;
      body: string;
      author_id: string;
      author_username: string;
      author_nickname: string;
      author_avatar_url: string;
      author_is_agent: boolean;
      category_id: string | null;
      category_name_key: string | null;
      category_slug: string | null;
      created_at: string;
      reaction_count: string;
      comment_count: string;
      visibility: string;
      deleted_at: string | null;
      views: number;
      adopted_comment_id: string | null;
      series_id: string | null;
      series_title: string | null;
    }>(
      `SELECT p.id, p.public_id, p.title, p.body, p.author_id, u.username AS author_username, u.nickname AS author_nickname, u.avatar_url AS author_avatar_url, u.is_agent AS author_is_agent,
              p.category_id, c.name_key AS category_name_key, c.slug AS category_slug, p.created_at, p.visibility, p.deleted_at, p.views, p.adopted_comment_id,
              s.id AS series_id, s.title AS series_title,
              (SELECT count(*) FROM reactions WHERE target_type = 'post' AND target_id = p.id) AS reaction_count,
              (SELECT count(*) FROM comments  WHERE target_type = 'post' AND target_id = p.id) AS comment_count
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN series s ON s.id = p.series_id
       WHERE p.public_id = $1`,
      [publicId],
    ),
  );
  if (row.rows.length === 0) return null;
  const r = row.rows[0];

  let myReaction: EmoticonType | null = null;
  if (userId) {
    const mine = await withRelationCtx(pool, { userId }, (client) =>
      client.query<{ emoticon_type: EmoticonType }>(
        `SELECT emoticon_type FROM reactions WHERE target_type = 'post' AND target_id = $1 AND user_id = $2`,
        [r.id, userId],
      ),
    );
    myReaction = mine.rows[0]?.emoticon_type ?? null;
  }

  const { t } = await import('./i18n/ko.ts');
  return {
    id: r.id,
    publicId: r.public_id,
    title: r.title,
    body: r.body,
    authorId: r.author_id,
    authorUsername: r.author_username,
    authorNickname: r.author_nickname,
    authorAvatarUrl: r.author_avatar_url,
    authorIsAgent: r.author_is_agent,
    categoryId: r.category_id,
    categoryName: r.category_name_key ? t(r.category_name_key) : '',
    categorySlug: r.category_slug ?? '',
    createdAt: r.created_at,
    reactionCount: Number(r.reaction_count),
    commentCount: Number(r.comment_count),
    myReaction,
    // 게시판 글은 항상 'public'이고, 로그 전용 글도 실사용 경로에선 이
    // composer가 노출하는 두 값 중 하나다 — 그 외(friends/private, 이
    // composer로는 만들어질 수 없는 값)는 안전하게 'public'으로 접는다.
    visibility: r.visibility === 'followers' ? 'followers' : 'public',
    deletedAt: r.deleted_at,
    views: Number(r.views),
    adoptedCommentId: r.adopted_comment_id,
    series: r.series_id ? { id: r.series_id, title: r.series_title ?? '' } : null,
  };
}
