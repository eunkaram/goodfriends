/**
 * 댓글 — §6.2, §11.7.4. `comments` 테이블 자체엔 RLS가 없다(§13 "다형성이라
 * 정책 불가" — reactions와 같은 갭, 0011_comments.sql에 이미 문서화됨).
 *
 * 🔒 PRD가 명시한 대응: "댓글 조회 API 본격 구현 시 대상(post) 조인 경유로만
 * 노출할 것". 모든 조회·작성이 posts를 반드시 JOIN하거나 재조회한다 —
 * posts는 RLS가 있으므로 대상 글이 안 보이면 댓글도 함께 안 보인다/못 쓴다.
 * comments를 단독으로 SELECT하는 코드는 이 보호를 우회하니 절대 추가하지 말 것.
 */
import type pg from 'pg';
import { appPool, withRelationCtx } from './db.ts';
import { checkRateLimit } from './rate-limit.ts';
import { createNotification } from './notifications.ts';

export type Comment = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  body: string;
  createdAt: string;
  /** 🔒 사용자 지시(2026-08, /design-review) — thread류 댓글 목록의 하트(좋아요). reactions.target_type='comment'는 스키마에 이미 있었다(0001_schema.sql) — 앱에서 처음 쓴다. */
  reactionCount: number;
  myReaction: boolean;
  /** 사용자 지시(2026-08, 1-depth 답글) — null이면 최상위 댓글, 값이 있으면 그 댓글의 답글이다. */
  parentCommentId: string | null;
};

const pool = appPool('exists');

// 🔒 /review 발견(red-team) — LIMIT이 전혀 없어서, 한 글에 댓글이 계속
// 쌓이면 그 글을 보는 모든 방문자(비로그인 포함, §4.3)가 매번 전체 댓글을
// 무제한으로 조회·렌더링해야 했다. 코멘트 자체가 시간순 스레드라 최신 N개면
// 충분하고, "더보기" UI는 별도 과제로 남긴다.
const MAX_COMMENTS = 500;
const MAX_COMMENT_LENGTH = 2000;

export async function fetchComments(userId: string | null, postId: string): Promise<Comment[]> {
  return withRelationCtx(pool, { userId }, (client) => fetchCommentsWithClient(client, userId, postId));
}

type CommentRow = {
  id: string;
  author_id: string;
  author_username: string;
  author_nickname: string;
  author_avatar_url: string;
  body: string;
  created_at: string;
  reaction_count: number;
  my_reaction: boolean;
  parent_comment_id: string | null;
};

export async function fetchCommentsWithClient(
  client: pg.PoolClient,
  userId: string | null,
  postId: string,
): Promise<Comment[]> {
  // 🔒 상관 서브쿼리로 반응 수·내 반응 여부를 붙인다 — feed.ts가 §5.1에서
  // GROUP BY 선집계 대신 이 패턴으로 바꿔 약 450배 빨라진 것과 같은 이유
  // (댓글 수는 대개 적어 체감은 작지만, 패턴을 일관되게 유지한다).
  const rows = await client.query<CommentRow>(
    `SELECT c.id, c.author_id, u.username AS author_username, u.nickname AS author_nickname, u.avatar_url AS author_avatar_url, c.body, c.created_at, c.parent_comment_id,
            (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = c.id)::int AS reaction_count,
            EXISTS(SELECT 1 FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.user_id = $3) AS my_reaction
     FROM comments c
     JOIN posts p ON p.id = c.target_id AND c.target_type = 'post'  -- RLS가 여기서 걸린다(§13)
     JOIN users u ON u.id = c.author_id
     WHERE p.id = $1
     ORDER BY c.created_at ASC
     LIMIT $2`,
    [postId, MAX_COMMENTS, userId],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorUsername: r.author_username,
    authorNickname: r.author_nickname,
    authorAvatarUrl: r.author_avatar_url,
    body: r.body,
    createdAt: r.created_at,
    reactionCount: r.reaction_count,
    myReaction: r.my_reaction,
    parentCommentId: r.parent_comment_id,
  }));
}

export type CreateCommentResult = { ok: true; id: string } | { ok: false; error: 'INVALID_INPUT' | 'NOT_FOUND' | 'RATE_LIMITED' };

/**
 * 🔒 사용자 지시(2026-08) — "댓글에서 1depth 댓글은 쓸수 있어야해... 댓글의
 * 댓글은 댓글을 달수 없도록". `parentCommentId`가 있으면 답글이다 — INSERT
 * 직전에 그 부모가 (1) 같은 글 소속이고 (2) 자기 자신도 최상위 댓글인지
 * (parent_comment_id가 NULL인지) 재검증한다. UI가 답글의 답글 아이콘 자체를
 * 숨기지만, API를 직접 두드리는 경우까지 대비한 저장 시점 재검증이다(P4와
 * 같은 원칙).
 */
export async function createComment(
  userId: string,
  postId: string,
  body: string,
  parentCommentId: string | null = null,
): Promise<CreateCommentResult> {
  const trimmed = body?.trim();
  if (!trimmed || trimmed.length > MAX_COMMENT_LENGTH) return { ok: false, error: 'INVALID_INPUT' };

  // 🔒 /review 발견(red-team) — 댓글 작성엔 아무 제한이 없어서, 계정 하나로
  // 한 글에 댓글을 무제한 스크립팅해 쌓을 수 있었다(추가 비용 O(1), 이후 모든
  // 조회 비용은 O(n)). 사용자당 시간당 30개로 제한한다.
  if (!(await checkRateLimit(`comment:${userId}`, 30, 3600))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  const result = await withRelationCtx(pool, { userId }, async (client) => {
    // 🔒 재검증 — 대상 글이 RLS로 지금도 보이는지 먼저 확인한다(P4와 같은 원칙).
    // 안 보이면(삭제·차단·비공개 전환) 댓글을 쓸 수 없다 — comments 자체엔 방어가 없어서다.
    const visible = await client.query<{ author_id: string }>('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if ((visible.rowCount ?? 0) === 0) return { ok: false as const, error: 'NOT_FOUND' as const };
    const postAuthorId = visible.rows[0].author_id;

    let parentAuthorId: string | null = null;
    if (parentCommentId) {
      const parent = await client.query<{ parent_comment_id: string | null; author_id: string }>(
        `SELECT parent_comment_id, author_id FROM comments WHERE id = $1 AND target_type = 'post' AND target_id = $2`,
        [parentCommentId, postId],
      );
      if ((parent.rowCount ?? 0) === 0 || parent.rows[0].parent_comment_id !== null) {
        return { ok: false as const, error: 'INVALID_INPUT' as const };
      }
      parentAuthorId = parent.rows[0].author_id;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO comments (target_type, target_id, author_id, body, parent_comment_id) VALUES ('post', $1, $2, $3, $4) RETURNING id`,
      [postId, userId, trimmed, parentCommentId],
    );
    // 사용자 지시 — 답글은 부모 댓글 작성자에게만 알린다(글 작성자에겐 안 알림, 깊은
    // 스레드에서 중복 알림을 피한다). 최상위 댓글은 글 작성자에게 알린다.
    const recipientId = parentCommentId ? parentAuthorId! : postAuthorId;
    const notified = await createNotification(client, userId, recipientId, 'comment', 'comment', inserted.rows[0].id);
    return { ok: true as const, id: inserted.rows[0].id, notified, recipientId };
  });
  // §9.1.1과 같은 자리(messages.ts sendMessage 참고) — 커밋 이후, fire-and-forget.
  if (result.ok && result.notified) {
  }
  return result.ok ? { ok: true, id: result.id } : result;
}

export type DeleteCommentResult = { ok: true } | { ok: false; error: 'NOT_FOUND' };

/**
 * 사용자 지시(2026-08, /design-review) — "점 세개부분에는 메뉴형태로
 * 수정하기, 삭제하기등이 있으면 좋을것 같아"(수정은 이번 범위 밖, 삭제만).
 * `comments`엔 RLS가 없어(위 파일 설명 참고) `author_id = $2`가 유일한
 * 권한 경계다 — `deletePost`(posts.ts)와 같은 원칙, 사유는 구분해 알리지
 * 않는다(§10.2). 이 댓글에 달린 반응도 FK가 없어(다형성) 같이 지운다.
 *
 * 🔒 1-depth 답글(2026-08) 추가 이후 — 최상위 댓글을 지우면 `parent_comment_id`의
 * `ON DELETE CASCADE`가 그 답글들을 `comments`에서 자동으로 지워주지만,
 * `reactions`는 다형성이라 FK 자체가 없어 CASCADE가 안 닿는다 — 지워질
 * 댓글(자기 자신 + 직속 답글) id를 먼저 모아 그만큼의 반응도 같이 지운다.
 */
export async function deleteComment(userId: string, commentId: string): Promise<DeleteCommentResult> {
  const deleted = await withRelationCtx(pool, { userId }, async (client) => {
    const affected = await client.query<{ id: string }>(
      `SELECT id FROM comments WHERE id = $1 OR parent_comment_id = $1`,
      [commentId],
    );
    const del = await client.query(`DELETE FROM comments WHERE id = $1 AND author_id = $2`, [commentId, userId]);
    if ((del.rowCount ?? 0) === 0) return false;
    const affectedIds = affected.rows.map((r) => r.id);
    await client.query(`DELETE FROM reactions WHERE target_type = 'comment' AND target_id = ANY($1::uuid[])`, [affectedIds]);
    return true;
  });
  return deleted ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}

export type ToggleCommentReactionResult = { ok: true; reacted: boolean } | { ok: false; error: 'NOT_FOUND' };

/**
 * 사용자 지시(2026-08, /design-review) — 댓글의 하트(좋아요). 반응 6종 중
 * '공감' 하나만 쓴다(포스트 상세의 compact 반응 바와 같은 결정 —
 * "하트와 댓글만 사용해"). 재검증은 P4와 같은 원칙 — 댓글이 속한 글이
 * 지금도 RLS로 보이는지 다시 확인한 뒤에만 토글한다.
 */
export async function toggleCommentReaction(userId: string, commentId: string): Promise<ToggleCommentReactionResult> {
  const result = await withRelationCtx(pool, { userId }, async (client) => {
    const visible = await client.query<{ id: string; author_id: string }>(
      `SELECT c.id, c.author_id FROM comments c JOIN posts p ON p.id = c.target_id AND c.target_type = 'post' WHERE c.id = $1`,
      [commentId],
    );
    if ((visible.rowCount ?? 0) === 0) return { ok: false as const, error: 'NOT_FOUND' as const };
    const commentAuthorId = visible.rows[0].author_id;

    const existing = await client.query(`SELECT 1 FROM reactions WHERE target_type = 'comment' AND target_id = $1 AND user_id = $2`, [
      commentId,
      userId,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query(`DELETE FROM reactions WHERE target_type = 'comment' AND target_id = $1 AND user_id = $2`, [commentId, userId]);
      return { ok: true as const, reacted: false };
    }
    // 🔒 재시도·경합으로 이미 있는 행을 다시 넣으려 하면 reactions_one_per_user
    // UNIQUE 제약(23505)에 걸린다 — 멱등하게 성공으로 처리한다(P4와 같은 원칙).
    try {
      await client.query(`INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('comment', $1, $2, 'empathy')`, [
        commentId,
        userId,
      ]);
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
    }
    // 토글-ON에서만 알린다 — 해제(위 DELETE)는 알리지 않는다.
    const notified = await createNotification(client, userId, commentAuthorId, 'reaction', 'comment', commentId);
    return { ok: true as const, reacted: true, notified, recipientId: commentAuthorId };
  });
  if (result.ok && result.reacted && result.notified) {
  }
  return result.ok ? { ok: true, reacted: result.reacted } : result;
}

export type AdminCommentRow = {
  id: string;
  bodyExcerpt: string;
  authorUsername: string;
  /** 내부 PK — 삭제 API 호출 등 서버 쪽 조작에만 쓴다. */
  postId: string;
  /** 공개 URL에 쓰는 짧은 불투명 ID(0038) — 부모 글의 원문 링크를 만드는 데 쓴다. */
  postPublicId: string;
  postTitle: string;
  /** posts.ts의 AdminPostRow.categorySlug와 같은 용도 — 부모 글의 원문 링크를 만드는 데 쓴다. */
  postCategorySlug: string | null;
  createdAt: string;
};

const ADMIN_EXCERPT_LENGTH = 200;

/**
 * 관리자 댓글 검색 — posts.ts의 searchPublicPosts()와 같은 이유·같은 범위
 * (전체공개 글에 달린 댓글만, §6.8 bigm 검색 계약도 동일). comments는
 * RLS가 없어(§13) 새 정책은 필요 없지만, "단독 조회 금지, posts 조인
 * 경유"라는 이 파일의 확립된 규칙은 여기서도 지킨다 — posts 조인이
 * visibility='public'을 강제해 비공개 글의 댓글은 이 검색에 안 걸린다.
 *
 * 🔒 사용자 지시(2026-09-08, "유저로 글/댓글을 트래킹할 필요가 있어") —
 * posts.ts searchPublicPosts()와 같은 이유로 `authorId` 선택 필터 추가.
 */
export async function searchPublicComments(
  moderatorId: string,
  query: string,
  limit: number,
  offset: number,
  authorId?: string,
): Promise<AdminCommentRow[]> {
  const trimmed = query.trim();
  const pattern = `%${trimmed}%`;
  const rows = await withRelationCtx(pool, { userId: moderatorId }, (client) =>
    client.query<{
      id: string;
      body_excerpt: string;
      author_username: string;
      post_id: string;
      post_public_id: string;
      post_title: string;
      post_category_slug: string | null;
      created_at: string;
    }>(
      `SELECT c.id, LEFT(c.body, $4) AS body_excerpt, u.username AS author_username, p.id AS post_id, p.public_id AS post_public_id, p.title AS post_title,
              cat.slug AS post_category_slug, c.created_at
       FROM comments c
       JOIN posts p ON p.id = c.target_id AND c.target_type = 'post'
       JOIN users u ON u.id = c.author_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE p.visibility = 'public' AND p.deleted_at IS NULL
         AND ($3 = '' OR lower(c.body) LIKE lower($3))
         AND ($5::uuid IS NULL OR c.author_id = $5)
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, trimmed === '' ? '' : pattern, ADMIN_EXCERPT_LENGTH, authorId ?? null],
    ),
  );
  return rows.rows.map((row) => ({
    id: row.id,
    bodyExcerpt: row.body_excerpt,
    authorUsername: row.author_username,
    postId: row.post_id,
    postPublicId: row.post_public_id,
    postTitle: row.post_title,
    postCategorySlug: row.post_category_slug,
    createdAt: row.created_at,
  }));
}
