/**
 * 홈 피드 — §5 "최신순 + 가중치". RLS(posts)가 차단·삭제·공개범위를 걸러주고,
 * 이 쿼리는 그 위에 §5 홈 게이트(커뮤니티 글 + 홈노출 로그 글)와 §5.1 정렬만 얹는다.
 *
 * 🔒 반응수·댓글수는 지금 즉석 COUNT다. §13 PostStats는 테이블만 있고 아직
 * 어디서도 갱신하지 않는다(글쓰기·반응 자체가 이번에 처음 생기는 기능이라서) —
 * §9.2가 요구하는 "PostStats PK 조인"으로 나중에 교체할 것.
 *
 * 🔒 /review 발견(performance) — 원래 이 COUNT를 `LEFT JOIN (SELECT target_id,
 * count(*) FROM reactions GROUP BY target_id)` 형태로 짰었다. 이 서브쿼리는
 * WHERE/LIMIT과 무관하게 reactions·comments 테이블 전체를 먼저 집계한 뒤에야
 * 조인한다 — 실측(30만 반응·50만 댓글, EXPLAIN ANALYZE)으로 271ms·11,607
 * 버퍼 vs 상관 서브쿼리 0.6ms·234버퍼, 약 450배 차이가 확인됐다. p.id별
 * 상관 서브쿼리로 교체해 LIMIT 적용 후의 행에 대해서만 인덱스로 계산하게 했다.
 *
 * 페이징은 지금 offset 방식이다. §5.1은 (created_at, id) 커서를 요구하지만
 * 2차 정렬 키(구독·팔로잉 가중치)가 계산값이라 커서 비교가 3중 튜플이 되고,
 * 이번 1차 구현에서 그 경계 케이스까지 검증할 여유가 없었다 — 트래픽이
 * 늘면 §5.1 원안대로 커서로 바꿀 것.
 */
import { appPool, withRelationCtx, queryRaw } from './db.ts';
import { hasImageMarkers, detectFirstLink, truncatePreview } from './link-detect.ts';

export type FeedSort = 'latest' | 'popular';

export type FeedPost = {
  /** 내부 PK(uuid) — 저장/삭제 등 API 호출에만 쓴다. */
  id: string;
  /** 공개 URL에 쓰는 짧은 불투명 ID(0038). */
  publicId: string;
  title: string;
  bodyPreview: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  /**
   * 🔒 M4(M3 후속) — 뉴스봇·다이제스트봇(is_agent=true)이 쓴 글은 프론트가
   * "AI 에디터" 배지를 그린다. Claude Design 확정안과 같은 매커니즘(False
   * 카운터feit 배지 불가 — 이 값은 users 테이블에서 온다).
   */
  authorIsAgent: boolean;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  /**
   * 🔒 사용자 지시(2026-09-06, "삭제된 글이면 모더레이터가 볼 때 삭제된 글이라고
   * 표시가 되어야... 글 리스트는 수정안되어있어") — post-detail.ts의 PostDetail이
   * 이미 갖고 있던 것과 같은 필드. RLS(app_moderator_can_view, 0035)가 신고
   * 열려있는 삭제된 글을 모더레이터에게만 계속 보여줘서, 이 목록 쿼리들도
   * deleted_at IS NULL을 SQL로 걸지 않고 RLS에 맡긴다 — 그래서 모더레이터
   * 피드에 삭제된 글이 섞여 나올 수 있고, 프론트가 구분해서 배지를 그려야 한다.
   * 일반 유저는 RLS가 애초에 그 행 자체를 안 줘서 이 필드가 null 아닌 걸 볼 일이 없다.
   */
  deletedAt: string | null;
};

const pool = appPool('exists');

type FeedRow = {
  id: string;
  public_id: string;
  title: string;
  body: string;
  author_id: string;
  author_username: string;
  author_nickname: string;
  author_avatar_url: string;
  author_is_agent: boolean;
  category_name_key: string | null;
  category_slug: string | null;
  created_at: string;
  reaction_count: string;
  comment_count: string;
  deleted_at: string | null;
};

function toFeedPost(row: FeedRow, t: (key: string) => string): FeedPost {
  return {
    id: row.id,
    publicId: row.public_id,
    title: row.title,
    bodyPreview: truncatePreview(row.body, 300),
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorNickname: row.author_nickname,
    authorAvatarUrl: row.author_avatar_url,
    authorIsAgent: row.author_is_agent,
    categoryName: row.category_name_key ? t(row.category_name_key) : '',
    categorySlug: row.category_slug ?? '',
    createdAt: row.created_at,
    reactionCount: Number(row.reaction_count),
    commentCount: Number(row.comment_count),
    deletedAt: row.deleted_at,
  };
}

// 아래 모든 쿼리가 공유하는 SELECT/FROM — 고정 SQL 텍스트만 조립한다(값은 전부
// 바인드 파라미터). p.id당 상관 서브쿼리라 LIMIT 적용 후의 행에만 비용이 든다.
// 🔒 사용자 지시(2026-08, "리스트에서 내글인데 3점 메뉴를 클릭하면 삭제하기
// 메뉴가 없어") — author_id를 추가해 목록 화면에서도 본인 글 판별(삭제 메뉴
// 노출)이 가능해졌다. 이전엔 PostCardMenu에 링크복사/저장/신고하기만 있었다.
// 🔒 사용자 지시(2026-08, "글 목록/글 상세의 작성자 아바타"도 실제 프로필
// 사진을 반영해야 한다) — u.avatar_url을 추가.
// 🔒 사용자 지시(2026-08, "모든 글 리스트에도 아이디대신 유저네임으로") —
// u.nickname을 추가 — 목록 화면 표시는 닉네임, href 라우팅은 여전히 username.
const POST_SELECT_FIELDS = `
  p.id, p.public_id, p.title, p.body, p.author_id, u.username AS author_username, u.nickname AS author_nickname, u.avatar_url AS author_avatar_url, u.is_agent AS author_is_agent,
  c.name_key AS category_name_key, c.slug AS category_slug, p.created_at, p.deleted_at,
  (SELECT count(*) FROM reactions WHERE target_type = 'post' AND target_id = p.id) AS reaction_count,
  (SELECT count(*) FROM comments  WHERE target_type = 'post' AND target_id = p.id) AS comment_count
`;
const POST_FROM_JOIN = `
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

/** §5 홈 게이트: 커뮤니티 글(늘 전체공개, §5.2) + 홈노출 체크된 전체공개 로그 글. */
export const HOME_GATE = `(p.category_id IS NOT NULL OR (p.log_id IS NOT NULL AND p.show_on_home = true AND p.visibility = 'public'))`;

/**
 * 🔒 M2 — 공개 검색(PLAN M2 "Postgres FTS 검색"). §6.8 검색 계약을 그대로:
 * `lower(col) LIKE lower($1) || '%'`가 posts_title_bigm_idx/posts_body_bigm_idx
 * (0001, pg_bigm GIN)를 탄다 — ILIKE는 이 인덱스를 안 타서 금지.
 * 일단 문자열 검색(tsvector보다 싸고, 한국어 CJK에선 형태소 분석이 필요해 2차 과제).
 * 검색 대상은 홈 게이트(커뮤니티 글 + 홈노출 공개 로그)와 동일 — 공개 피드와 같은
 * 스코프로 검색한다.
 */
export async function searchPosts(
  userId: string | null,
  query: string,
  opts: { limit: number; offset: number; categorySlug?: string },
): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const categoryFilter = opts.categorySlug ? 'AND c.slug = $4' : '';
  const params: unknown[] = [needle, opts.limit, opts.offset];
  if (opts.categorySlug) params.push(opts.categorySlug);
  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE ${HOME_GATE}
         AND (lower(p.title) LIKE lower($1) || '%' OR lower(p.body) LIKE lower($1) || '%')
         ${categoryFilter}
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      params,
    ),
  );
  return rows.rows.map((r) => toFeedPost(r, t));
}

async function fetchByRankedIds(userId: string | null, pageIds: string[]): Promise<FeedRow[]> {
  if (pageIds.length === 0) return [];
  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE p.id = ANY($1::uuid[])
       ORDER BY array_position($1::uuid[], p.id)`,
      [pageIds],
    ),
  );
  return rows.rows;
}

export async function fetchHomeFeed(
  userId: string | null,
  opts: { sort: FeedSort; limit: number; offset: number },
): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');

  if (opts.sort === 'popular') {
    const { computePopularity, getPopularity } = await import('./popularity.ts');
    let ids = await getPopularity(null, '7d');
    if (ids === null) ids = await computePopularity(pool, null, '7d'); // 콜드스타트 폴백(§5.1.1) — 캐시가 비어도 화면은 비지 않는다
    const rows = await fetchByRankedIds(userId, ids.slice(opts.offset, opts.offset + opts.limit));
    return rows.map((r) => toFeedPost(r, t));
  }

  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE ${HOME_GATE}
       ORDER BY
         date_trunc('hour', p.created_at AT TIME ZONE 'UTC') DESC,
         (
           EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = $1 AND s.category_id = p.category_id)
           OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id)
         ) DESC,
         p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, opts.limit, opts.offset],
    ),
  );
  return rows.rows.map((r) => toFeedPost(r, t));
}

/**
 * GitHub #9 — 모바일 전용 "For You" 탭. 임베딩·후보생성 없이 기존 테이블
 * (follows/subscriptions/reactions/comments)에 대한 가중 EXISTS 서브쿼리로
 * 정렬만 얹는다 — fetchHomeFeed의 §5.1 팔로잉·구독 tiebreaker를 1차
 * 정렬키로 승격한 것. 새 테이블 없음, 웹의 GET /api/feed는 그대로.
 */
export async function fetchForYouFeed(userId: string, limit: number, offset: number): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');
  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE ${HOME_GATE}
       ORDER BY (
           3 * (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id))::int
         + 2 * (EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = $1 AND s.category_id = p.category_id))::int
         + 2 * (EXISTS (SELECT 1 FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id
                          AND EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = $1 AND f2.followee_id = r.user_id)))::int
         + 1 * (EXISTS (SELECT 1 FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id
                          AND EXISTS (SELECT 1 FROM follows f3 WHERE f3.follower_id = $1 AND f3.followee_id = c.author_id)))::int
       ) DESC,
       p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
  );
  return rows.rows.map((r) => toFeedPost(r, t));
}

/**
 * 카테고리 피드 — §11.7.3. 이미 한 카테고리로 좁혀진 화면이라 §5.1의
 * 구독·팔로잉 가중치(여러 카테고리를 섞을 때만 의미가 있다)는 적용하지
 * 않는다 — 순수 최신순이다. 인기 탭은 popularity.ts가 이미 categoryId를
 * 받으므로 그대로 재사용한다.
 */
export async function fetchCategoryFeed(
  userId: string | null,
  categoryId: string,
  opts: { sort: FeedSort; limit: number; offset: number },
): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');

  if (opts.sort === 'popular') {
    const { computePopularity, getPopularity } = await import('./popularity.ts');
    let ids = await getPopularity(categoryId, '7d');
    if (ids === null) ids = await computePopularity(pool, categoryId, '7d');
    const rows = await fetchByRankedIds(userId, ids.slice(opts.offset, opts.offset + opts.limit));
    return rows.map((r) => toFeedPost(r, t));
  }

  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE p.category_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [categoryId, opts.limit, opts.offset],
    ),
  );
  return rows.rows.map((r) => toFeedPost(r, t));
}

/**
 * 개인 로그 포스트 목록 — §11.7.6. 🔒 실전 발견(2026-08, 사용자 지시 —
 * "좌측 Posts메뉴는 게시판, 공개된 개인 post로 구분없이 최신순으로") — 원래
 * `WHERE p.log_id = $1`만 썼는데, `createCommunityPost`(posts.ts)가 INSERT할 때
 * `log_id`를 아예 안 채운다 — 게시판 글은 항상 `log_id IS NULL`이라(category_id만
 * 채워짐), "크로스포스팅 글도 log_id가 있어 자연히 포함된다"는 예전 주석은
 * 실제로는 한 번도 맞은 적이 없었다(작성 경로가 그렇게 안 짜여 있었다) — 이
 * 함수는 지금까지 사실상 항상 빈 목록만 반환했던 셈이다(기존 테스트도 DB에
 * `log_id`를 직접 꽂아 넣는 픽스처만 검증해서 이 공백이 안 드러났다). `author_id`도
 * 같이 매칭해서 게시판 글(category_id 있음, log_id 없음)과 개인 로그 글(log_id
 * 있음) 둘 다 최신순으로 병합한다 — 이 둘의 author_id/log_id는 항상 같은
 * 사람이라 OR로 묶어도 중복 행이 생기지 않는다. RLS(posts)가 친구공개·비공개를
 * 그대로 걸러준다.
 */
export async function fetchHomeFeedForLog(viewerId: string | null, logUserId: string, limit: number, offset: number): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');
  const rows = await withRelationCtx(pool, { userId: viewerId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE p.author_id = $1 OR p.log_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [logUserId, limit, offset],
    ),
  );
  return rows.rows.map((r) => toFeedPost(r, t));
}

/**
 * §11.7.7 "저장한 글" `/saved` — Claude Design 확정안(artifact `showSaved`)
 * 신규 화면. `saved_posts` SELECT RLS(`user_id = 본인`)가 이미 "남이 뭘
 * 저장했는지 절대 노출 안 함"을 강제하므로, 이 함수는 그 위에 정렬(저장한
 * 시각 최신순)만 얹는다 — 글 자체의 가시성은 posts RLS가 이중으로 걸러준다
 * (삭제되거나 차단된 글은 saved_posts에 행이 남아있어도 이 JOIN에서 빠진다).
 */
export async function fetchSavedPosts(userId: string, limit: number, offset: number): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');
  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       JOIN saved_posts sp ON sp.post_id = p.id
       WHERE sp.user_id = $1
       ORDER BY sp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
  );
  return rows.rows.map((r) => toFeedPost(r, t));
}

/** 저장 취소 — RLS DELETE 정책이 본인 것만 지우게 강제한다(불변식 8, 별도 정책). */
export async function unsavePost(userId: string, postId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) => client.query(`DELETE FROM saved_posts WHERE user_id = $1 AND post_id = $2`, [userId, postId]));
}

/**
 * 프로필 "Replies" 탭(사용자 지시, 2026-08 — "replies탭의 리스트는 내가
 * 작성한 댓글의 글리스트를 보여줘야해(원글 + 내 댓글 그룹만 노출)") — 이
 * 사용자가 댓글(최상위든 답글이든)을 쓴 글 목록 + 그 글에서 이 사용자가
 * 직접 쓴 댓글들만("내 댓글 그룹") 함께 내려준다. 다른 사람의 댓글은 이
 * 목록에 안 섞는다 — "원글 + 내 댓글 그룹만"이라는 요구를 그대로 반영.
 */
export type UserComment = {
  id: string;
  body: string;
  createdAt: string;
  parentCommentId: string | null;
  /** 🔒 사용자 지시(2026-08, "좋아요, 댓글 아이콘등이 빠졌어") — comments.ts의
   * Comment와 같은 필드, 뷰어 기준(profile 주인 기준이 아님). */
  reactionCount: number;
  myReaction: boolean;
};
export type PostWithUserComments = { post: FeedPost; comments: UserComment[] };

export async function fetchPostsCommentedByUser(
  viewerId: string | null,
  targetUserId: string,
  limit: number,
  offset: number,
): Promise<PostWithUserComments[]> {
  const { t } = await import('./i18n/ko.ts');

  // 1단계 — 이 사용자가 댓글을 쓴 글 id를, 그 글에서 가장 최근에 쓴 댓글
  // 시각순으로 페이지네이션. comments는 RLS가 없다(§13 다형성) — 이 쿼리
  // 자체는 posts를 안 건드리므로 RLS 세션 컨텍스트가 필요 없다.
  const grouped = await queryRaw<{ post_id: string }>(
    pool,
    `SELECT target_id AS post_id
     FROM comments
     WHERE target_type = 'post' AND author_id = $1
     GROUP BY target_id
     ORDER BY max(created_at) DESC
     LIMIT $2 OFFSET $3`,
    [targetUserId, limit, offset],
  );
  const postIds = grouped.rows.map((row) => row.post_id);
  if (postIds.length === 0) return [];

  // 2단계 — 그 글들을 posts RLS로 재조회(삭제·차단·비공개는 여기서 자연히
  // 빠진다) — fetchByRankedIds가 array_position으로 1단계 순서를 그대로 지킨다.
  const postRows = await fetchByRankedIds(viewerId, postIds);
  const posts = postRows.map((r) => toFeedPost(r, t));
  if (posts.length === 0) return [];
  const visibleIds = posts.map((p) => p.id);

  // 3단계 — 그 글들 안에서 "이 사용자가 직접 쓴" 댓글만(다른 사람 댓글은
  // 섞지 않는다) 시간순으로 가져와 글별로 묶는다. 🔒 사용자 지시(2026-08,
  // "좋아요, 댓글 아이콘등이 빠졌어. 댓글 디자인을 똑같이 구현해야해") —
  // 하트(좋아요)를 실제로 토글 가능하게 하려면 반응 수·내 반응 여부가
  // 필요하다 — comments.ts의 fetchComments와 정확히 같은 상관 서브쿼리
  // 패턴(§5.1 "GROUP BY 선집계 대신 상관 서브쿼리"와 일관). `myReaction`은
  // "지금 보고 있는 사람"(viewerId) 기준이다 — 이 탭이 본인 전용이 아니라
  // 누구나 볼 수 있어서, 프로필 주인이 아니라 뷰어의 반응을 반영해야 한다.
  const commentRows = await queryRaw<{
    id: string;
    body: string;
    created_at: string;
    target_id: string;
    parent_comment_id: string | null;
    reaction_count: number;
    my_reaction: boolean;
  }>(
    pool,
    `SELECT c.id, c.body, c.created_at, c.target_id, c.parent_comment_id,
            (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = c.id)::int AS reaction_count,
            EXISTS(SELECT 1 FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.user_id = $3) AS my_reaction
     FROM comments c
     WHERE c.target_type = 'post' AND c.author_id = $1 AND c.target_id = ANY($2::uuid[])
     ORDER BY c.created_at ASC`,
    [targetUserId, visibleIds, viewerId],
  );

  return posts.map((post) => ({
    post,
    comments: commentRows.rows
      .filter((c) => c.target_id === post.id)
      .map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        parentCommentId: c.parent_comment_id,
        reactionCount: c.reaction_count,
        myReaction: c.my_reaction,
      })),
  }));
}

/** 본문에 이미지 마커·직접 이미지/영상 URL·유튜브 링크 중 하나라도 있으면 "미디어 있음"으로 본다. */
function bodyHasMedia(body: string): boolean {
  if (hasImageMarkers(body)) return true;
  const link = detectFirstLink(body);
  return !!link && (link.isDirectImage || link.isDirectVideo || link.youtubeVideoId !== null);
}

/**
 * 프로필 "Media" 탭(사용자 지시, 2026-08 — "Media 탭은 본문에 이미지,
 * 동영상등 미디어 타입의 글만 보여줘야해") — `fetchHomeFeedForLog`와 같은
 * 대상(게시판 글 + 개인 로그 글)에서 본문에 미디어가 있는 글만 걸러낸다.
 * 🔒 SQL로 이미지 마커·링크 패턴까지 재현하는 대신, 최근 글을 넉넉히
 * 스캔(`MEDIA_SCAN_LIMIT`)한 뒤 `link-detect.ts`의 기존 판별 로직을 그대로
 * 재사용해 필터링한다 — 실제로 미디어가 있는 글이 스캔 범위보다 오래된
 * 경우 이 페이지에서 놓칠 수 있다는 실용적 타협이다(link-preview.ts의 SSRF
 * 방어 문서화와 같은 태도).
 */
const MEDIA_SCAN_LIMIT = 300;

export async function fetchMediaPostsForLog(viewerId: string | null, logUserId: string, limit: number, offset: number): Promise<FeedPost[]> {
  const { t } = await import('./i18n/ko.ts');
  const rows = await withRelationCtx(pool, { userId: viewerId }, (client) =>
    client.query<FeedRow>(
      `SELECT ${POST_SELECT_FIELDS} ${POST_FROM_JOIN}
       WHERE p.author_id = $1 OR p.log_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [logUserId, MEDIA_SCAN_LIMIT],
    ),
  );
  const filtered = rows.rows.filter((r) => bodyHasMedia(r.body));
  return filtered.slice(offset, offset + limit).map((r) => toFeedPost(r, t));
}
