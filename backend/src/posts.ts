/**
 * 커뮤니티 글 + 로그 전용 글 작성 — §6.2 "인라인 글 작성", §11.7.1 홈 인라인 글쓰기.
 *
 * 🔒 사용자 지시(2026-08, "Post Option을 넣어야 할것 같아. 게시판에 글을
 * 쓸건지 내 로그(프로파일)에만 글을 쓸건지 선택이 필요해, 그리고
 * 내로그에만 쓴 글일경우 읽기 권한을 전체, follower 설정을 할수 있어야") —
 * 이전엔 이 파일 자체가 "로그 글(log_id) 작성 폼은 아직 미착수"라고 범위를
 * 좁혀뒀었다. `categoryId`가 있으면 게시판(커뮤니티) 글(§5.2 CHECK가
 * 강제하듯 visibility 무조건 'public'), 없으면 로그 전용 글(0029 마이그레이션의
 * `posts_visibility_check`가 'public'|'followers'까지 허용 — 다만 이 composer
 * UI는 그 둘만 노출한다, 'friends'/'private'는 이번 요청 범위 밖).
 */
import { randomBytes } from 'node:crypto';
import { appPool, withRelationCtx, queryRaw } from './db.ts';

/** 로그 전용 글에서만 의미가 있다 — 사용자가 명시한 두 옵션만("전체", "follower"). */
export type LogPostVisibility = 'public' | 'followers';

export type CreatePostInput = {
  title: string;
  body: string;
  /** 있으면 게시판 글, 없으면(undefined) 로그 전용 글 — 상호 배타. */
  categoryId?: string;
  /** 로그 전용 글에서만 필수. 게시판 글에선 무시된다(항상 'public'로 강제). */
  visibility?: LogPostVisibility;
};

export type CreatePostResult = { ok: true; id: string; publicId: string } | { ok: false; error: 'INVALID_INPUT' | 'NOT_AUTHENTICATED' };

const pool = appPool('exists');

/**
 * 🔒 사용자 지시(2026-08-21, "URL이 너무 길어서 줄이고 싶어") — PRD §3.3이
 * 이미 "포스트 ID: 불투명 ID(ULID/nanoid)"를 요구했었다(0038 이전엔 UUID를
 * 그대로 노출해 이 결정을 안 지켰음). session.ts/oauth.ts와 같은 패턴
 * (`randomBytes(n).toString('base64url')`) — nanoid 등 새 의존성 없이
 * 11자(64비트) 불투명 ID를 만든다. 충돌 시 재시도 안 함 — 이 정도 엔트로피면
 * 이 서비스 규모에서 실질적으로 무시 가능(session.ts의 32바이트 토큰과 같은
 * 판단 기준, 다만 URL에 노출되는 값이라 세션 토큰만큼 길 필요는 없다).
 */
function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}

/**
 * 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을 처리하는데
 * 계속 에러가 뜬다") — public_id(0038)가 URL에 노출된 뒤로 외부 호출자가
 * 아는 유일한 글 식별자는 이제 public_id뿐이다. src/http-server.ts의
 * /api/intent/execute가 이 함수로 public_id를 내부 uuid로 먼저 해석한다 —
 * fetchPostDetail()(post-detail.ts)이 이미 하는 것과 같은 패턴. RLS 없이
 * 조회한다 — id 해석 자체는 "이 public_id가 존재하는가"만 답할 뿐 접근
 * 권한을 주지 않는다, 실제 가시성 재검증은 호출부(intent-execution.ts의
 * targetPostVisible)가 RLS로 다시 한다.
 */
export async function resolvePostId(maybePublicId: string): Promise<string | null> {
  const r = await queryRaw<{ id: string }>(pool, `SELECT id FROM posts WHERE public_id = $1`, [maybePublicId]);
  return r.rows[0]?.id ?? null;
}

async function validateCommunityCategory(categoryId: string): Promise<boolean> {
  // 🔒 /review 발견 — categoryId를 존재·타입·공개 여부 확인 없이 그대로 꽂아 넣고
  // 있었다. FK(0018)는 "존재하지 않는 카테고리"만 막는다 — 마켓 카테고리나
  // 아직 안 켠(is_public=false) 카테고리를 커뮤니티 글에 넣는 건 못 막는다.
  const category = await queryRaw<{ type: string; is_public: boolean }>(
    pool,
    `SELECT type, is_public FROM categories WHERE id = $1`,
    [categoryId],
  );
  return category.rows[0]?.type === 'community' && !!category.rows[0]?.is_public;
}

/** 🔒 사용자 발견(2026-08, "글쓰기시에 내용을 줄바꿈만 넣어도 저장이 돼.
 * 글자수를 체크하는 로직을 추가해") — 줄바꿈만 있는 본문은 `.trim()`으로
 * 빈 문자열이 되지만, title만 체크하고 있어서 그대로 통과했다. 세
 * 함수(createCommunityPost/createLogPost/updatePost) 전부 title과 같은
 * 자리에 body 필수 체크를 추가한다. */
export async function createCommunityPost(userId: string, input: { categoryId: string; title: string; body: string }): Promise<CreatePostResult> {
  const title = input.title?.trim();
  const body = input.body?.trim() ?? '';
  if (!title || !body || !input.categoryId) return { ok: false, error: 'INVALID_INPUT' };
  if (!(await validateCommunityCategory(input.categoryId))) return { ok: false, error: 'INVALID_INPUT' };

  const result = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; public_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility, public_id)
       VALUES ($1, $2, $3, $4, 'public', $5)
       RETURNING id, public_id`,
      [userId, input.categoryId, title, body, generatePublicId()],
    ),
  );
  return { ok: true, id: result.rows[0].id, publicId: result.rows[0].public_id };
}

/**
 * "내 로그에만" 글 작성 — `category_id`는 NULL, `log_id`는 가입 시 자동
 * 생성된(§6.1) 본인의 로그를 그대로 쓴다(클라이언트가 대상 로그를 지정할
 * 방법 자체가 없다 — 항상 본인 로그).
 *
 * 🔒 실전 버그(2026-08, curl E2E 중 발견) — `user_logs`는 `id` 컬럼이 없는
 * 테이블이다(`user_id`가 PK 자체, `\d user_logs`로 확인). `SELECT id FROM
 * user_logs`는 `column "id" does not exist`(42703)로 매번 500을 냈다.
 * `albums.ts`의 `log_id` 사용(`INSERT INTO albums (log_id, ...) VALUES
 * (userId, ...)`)과 같은 이유로 `log_id`는 그냥 `userId` 그 자체다 — 별도
 * 조회가 필요 없다.
 */
export async function createLogPost(userId: string, input: { title: string; body: string; visibility: LogPostVisibility }): Promise<CreatePostResult> {
  const title = input.title?.trim();
  const body = input.body?.trim() ?? '';
  if (!title || !body) return { ok: false, error: 'INVALID_INPUT' };
  if (input.visibility !== 'public' && input.visibility !== 'followers') return { ok: false, error: 'INVALID_INPUT' };

  const result = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; public_id: string }>(
      `INSERT INTO posts (author_id, log_id, title, body, visibility, public_id)
       VALUES ($1, $1, $2, $3, $4, $5)
       RETURNING id, public_id`,
      [userId, title, body, input.visibility, generatePublicId()],
    ),
  );
  return { ok: true, id: result.rows[0].id, publicId: result.rows[0].public_id };
}

export type DeletePostResult = { ok: true } | { ok: false; error: 'NOT_FOUND' };

/**
 * 사용자 발견(2026-08) — "내 글삭제는 어떻게해? 기능이 빠져있는것 같아."
 * DELETE RLS 정책(`posts_delete_own_exists`, 0002_rls.sql)은 이미 있었다 —
 * `author_id = app_current_user_id()`가 아니면 0행 삭제로 조용히 막힌다.
 * `deleteAccount()`(auth.ts)와 같은 원칙 — 하드 삭제, 유예 없음. `post_stats`·
 * `saved_posts`는 posts로의 FK가 `ON DELETE CASCADE`라 자동 정리되지만,
 * `comments`·`reactions`는 다형성 테이블이라(§13, target_type/target_id) FK
 * 자체가 없어 여기서 직접 지운다.
 */
export async function deletePost(userId: string, postId: string): Promise<DeletePostResult> {
  const deleted = await withRelationCtx(pool, { userId }, async (client) => {
    const del = await client.query(`DELETE FROM posts WHERE id = $1`, [postId]);
    if (del.rowCount === 0) return false; // 본인 글이 아니거나 이미 없음 — RLS가 조용히 막은 것과 구분하지 않는다(§10.2)
    await client.query(`DELETE FROM comments WHERE target_type = 'post' AND target_id = $1`, [postId]);
    await client.query(`DELETE FROM reactions WHERE target_type = 'post' AND target_id = $1`, [postId]);
    return true;
  });
  return deleted ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}

/** CreatePostInput과 같은 상호배타 규칙 — categoryId 있으면 게시판, 없으면 로그 전용. */
export type UpdatePostInput = {
  title: string;
  body: string;
  categoryId?: string;
  visibility?: LogPostVisibility;
};
export type UpdatePostResult = { ok: true } | { ok: false; error: 'INVALID_INPUT' | 'NOT_FOUND' };

/**
 * 사용자 발견(2026-08) — "내글에 대해 수정기능이 없어. 수정할수 있게 만들어줘."
 * DELETE와 마찬가지로 UPDATE RLS 정책(`posts_update_own_exists`, 0002_rls.sql)이
 * 이미 있었다 — author_id가 아니면 0행 갱신으로 조용히 막힌다. `createCommunityPost`
 * 와 같은 이유로 categoryId를 다시 검증한다 — 수정 폼이 클라이언트에서 마켓/비공개
 * 카테고리로 바꿔 보낼 수 있어서다(불변식 19와 별개로, 이건 "존재하는 카테고리"가
 * 아니라 "이 글에 허용된 카테고리"인지의 검증이다).
 *
 * 🔒 사용자 지시(2026-08, "글 수정도 똑같이 기능이 구현되어야해") — 생성과
 * 완전히 같은 게시판/로그 전용 분기를 수정에도 그대로 적용한다. 게시판↔로그
 * 전용 사이의 재분류(예: 원래 게시판 글을 로그 전용으로 바꾸는 것)도 이
 * 함수 하나로 처리된다 — 막을 이유가 없어서 굳이 금지하지 않았다.
 */
export async function updatePost(userId: string, postId: string, input: UpdatePostInput): Promise<UpdatePostResult> {
  const title = input.title?.trim();
  const body = input.body?.trim() ?? '';
  if (!title || !body) return { ok: false, error: 'INVALID_INPUT' };

  if (input.categoryId !== undefined) {
    if (!(await validateCommunityCategory(input.categoryId))) return { ok: false, error: 'INVALID_INPUT' };
    const updated = await withRelationCtx(pool, { userId }, async (client) => {
      const res = await client.query(
        `UPDATE posts SET category_id = $1, log_id = NULL, visibility = 'public', title = $2, body = $3, updated_at = now() WHERE id = $4`,
        [input.categoryId, title, body, postId],
      );
      return (res.rowCount ?? 0) > 0;
    });
    return updated ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
  }

  if (input.visibility !== 'public' && input.visibility !== 'followers') return { ok: false, error: 'INVALID_INPUT' };
  // 🔒 createLogPost와 같은 이유로 log_id는 userId 그 자체다 — 별도 조회 불필요.
  const updated = await withRelationCtx(pool, { userId }, async (client) => {
    const res = await client.query(
      `UPDATE posts SET category_id = NULL, log_id = $1, visibility = $2, title = $3, body = $4, updated_at = now() WHERE id = $5`,
      [userId, input.visibility, title, body, postId],
    );
    return (res.rowCount ?? 0) > 0;
  });
  return updated ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}

export type AdminPostRow = {
  /** 내부 PK — 삭제 API(`/api/admin/posts/:id/delete`) 호출 등 서버 쪽 조작에만 쓴다. */
  id: string;
  title: string;
  bodyExcerpt: string;
  authorUsername: string;
  isCommunity: boolean;
  /** 카테고리 이동 액션(`/api/admin/posts/:id/category`)이 드롭다운 초기값을 잡는 데 쓴다 — 로그 글이면 null. */
  categoryId: string | null;
  categoryNameKey: string | null;
  /** PostCard.tsx의 href 로직(`categorySlug ? '/{slug}/{publicId}' : '/post/{publicId}'`)과 동일하게 원문 링크를 만드는 데 쓴다. */
  categorySlug: string | null;
  /** 원문 링크(공개 URL)에 쓰는 짧은 불투명 ID(0038) — id(uuid)와 별개. */
  publicId: string;
  createdAt: string;
};

const ADMIN_EXCERPT_LENGTH = 200;

/**
 * 관리자 글 검색(사용자 지시, 2026-08-18 — "관리자페이지에서 글/댓글관리...
 * 유저 관리처럼 신고 여부와 무관하게 검색해서 삭제"). 사용자가 범위를
 * 명시적으로 좁혔다 — **전체공개 글만**(비공개/친구공개/팔로워공개 로그는
 * 여전히 신고 경유로만, 0035의 app_moderator_can_view()). visibility='public'
 * 이면 RLS(0036)가 신고 없이도 보여준다.
 *
 * 🔒 §6.8 검색 계약 — `lower(col) LIKE lower($1)`만 posts_title_bigm_idx/
 * posts_body_bigm_idx(둘 다 0001)를 탄다. ILIKE는 이 GIN 인덱스를 안 탄다 —
 * 패턴(%...%)은 바인드 값 쪽에 넣고 SQL엔 항상 lower()+LIKE만 쓴다.
 *
 * 🔒 사용자 지시(2026-09-08, "유저로 글/댓글을 트래킹할 필요가 있어") —
 * `/admin/users/:id` 상세 화면이 이 함수를 `authorId`로 좁혀서 재사용한다
 * (검색어와 동시에 걸 수도 있음). 스코프는 그대로 **전체공개 글만** —
 * 특정 유저를 지목했다고 비공개 글까지 열어주면 §4.6 원칙이 깨진다.
 */
export async function searchPublicPosts(
  moderatorId: string,
  query: string,
  limit: number,
  offset: number,
  authorId?: string,
): Promise<AdminPostRow[]> {
  const trimmed = query.trim();
  const pattern = `%${trimmed}%`;
  const rows = await withRelationCtx(pool, { userId: moderatorId }, (client) =>
    client.query<{
      id: string;
      title: string;
      body_excerpt: string;
      author_username: string;
      is_community: boolean;
      category_id: string | null;
      category_name_key: string | null;
      category_slug: string | null;
      public_id: string;
      created_at: string;
    }>(
      `SELECT p.id, p.title, LEFT(p.body, $4) AS body_excerpt, u.username AS author_username,
              p.category_id IS NOT NULL AS is_community, p.category_id, c.name_key AS category_name_key, c.slug AS category_slug,
              p.public_id, p.created_at
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.visibility = 'public' AND p.deleted_at IS NULL
         AND ($3 = '' OR lower(p.title) LIKE lower($3) OR lower(p.body) LIKE lower($3))
         AND ($5::uuid IS NULL OR p.author_id = $5)
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, trimmed === '' ? '' : pattern, ADMIN_EXCERPT_LENGTH, authorId ?? null],
    ),
  );
  return rows.rows.map((row) => ({
    id: row.id,
    title: row.title,
    bodyExcerpt: row.body_excerpt,
    authorUsername: row.author_username,
    isCommunity: row.is_community,
    categoryId: row.category_id,
    categoryNameKey: row.category_name_key,
    categorySlug: row.category_slug,
    publicId: row.public_id,
    createdAt: row.created_at,
  }));
}
