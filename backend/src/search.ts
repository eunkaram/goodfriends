/**
 * 전체검색 — 글 제목과 본문을 한 번에 조회해 하나의 목록으로 돌려준다.
 *
 * 🔒 검색 계약(§6.8) — 이 파일의 모든 LIKE는 `lower(col) LIKE $n ESCAPE '\'`
 * 형태다. 0001의 posts_title_bigm_idx/posts_body_bigm_idx가
 * lower(...) gin_bigm_ops 인덱스라서, ILIKE나 `col LIKE ...`(lower 없이)로
 * 바꾸면 조용히 Seq Scan으로 돌아간다.
 *
 * 🔒 성능 — LIMIT+1만 읽어 hasMore만 판단하고 COUNT(*)는 세지 않는다.
 * 후보를 인덱스로 좁힌 뒤 그 안에서만 bigm_similarity로 정렬한다. 검색어는
 * 최소 2자(2-gram 인덱스가 동작하는 하한)로 제한한다.
 */
import { appPool, withRelationCtx } from './db.ts';
import { HOME_GATE } from './feed.ts';
import { truncatePreview } from './link-detect.ts';

const pool = appPool('exists');
const MAX_SNIPPET_LENGTH = 180;
export const MIN_SEARCH_LENGTH = 2;

export type SearchPostHit = {
  id: string;
  publicId: string;
  title: string;
  authorId: string;
  snippet: string;
  categoryName: string;
  categorySlug: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
};

export type SearchGroup<T> = {
  items: T[];
  hasMore: boolean;
  nextOffset: number | null;
};

export type SearchResults = {
  query: string;
  posts: SearchGroup<SearchPostHit>;
};

type SearchPostRow = {
  id: string;
  public_id: string;
  title: string;
  body: string;
  author_id: string;
  author_username: string;
  author_nickname: string;
  author_avatar_url: string;
  category_name_key: string | null;
  category_slug: string | null;
  created_at: string;
  reaction_count: number;
  comment_count: number;
  title_matched: boolean;
};

/* 후보 CTE(hits)에서 페이지 몫만 남긴 뒤, 바깥에서 조인·카운트를 붙인다.
 * 카운트 서브쿼리를 CTE 안에 두면 ORDER BY용 정렬 대상 전체(수천 건일 수
 * 있음)에 대해 실행된다 — 실제로 EXPLAIN에서 Seq/Bitmap Scan 아래 SubPlan으로
 * 붙는 것을 확인했다. MATERIALIZED로 후보를 고정해 카운트는 최종 페이지
 * (LIMIT+1)에만 계산한다. */
const POST_FIELDS = `
  h.id, h.public_id, h.title, h.body, h.author_id,
  h.title_matched, h.title_exact, h.title_prefix, h.title_score,
  h.body_exact, h.body_prefix, h.body_score,
  u.username AS author_username, u.nickname AS author_nickname, u.avatar_url AS author_avatar_url,
  c.name_key AS category_name_key, c.slug AS category_slug, h.created_at,
  (SELECT count(*) FROM reactions WHERE target_type = 'post' AND target_id = h.id)::int AS reaction_count,
  (SELECT count(*) FROM comments  WHERE target_type = 'post' AND target_id = h.id)::int AS comment_count
`;
const POST_FROM = `
  FROM hits h
  JOIN users u ON u.id = h.author_id
  LEFT JOIN categories c ON c.id = h.category_id
`;

/** pg_bigm GIN 인덱스가 타는 lower()+LIKE 패턴용. 사용자 입력의 %/_/\는 리터럴로 만든다. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 검색 결과용 스니펫 — 첫 일치 지점 앞뒤를 잘라 보여준다. 본문 전체를
 * 클라이언트로 내려보내지 않기 위한 것이고, 일치 지점이 없으면(정렬용
 * 유사도만 걸린 경우) 앞부분을 쓴다.
 */
function searchSnippet(text: string, needle: string, maxLength = MAX_SNIPPET_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  if (flat.length <= maxLength) return flat;

  const index = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return truncatePreview(flat, maxLength);

  const before = Math.min(60, Math.floor(maxLength / 3));
  const start = Math.max(0, index - before);
  const end = Math.min(flat.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

function emptyGroup<T>(): SearchGroup<T> {
  return { items: [], hasMore: false, nextOffset: null };
}

function toGroup<T>(rows: T[], limit: number, offset: number): SearchGroup<T> {
  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

function toPostHit(row: SearchPostRow, t: (key: string) => string, needle: string): SearchPostHit {
  return {
    id: row.id,
    publicId: row.public_id,
    title: row.title,
    authorId: row.author_id,
    snippet: row.title_matched ? truncatePreview(row.body.replace(/\s+/g, ' ').trim(), MAX_SNIPPET_LENGTH) : searchSnippet(row.body, needle),
    categoryName: row.category_name_key ? t(row.category_name_key) : '',
    categorySlug: row.category_slug ?? '',
    authorUsername: row.author_username,
    authorNickname: row.author_nickname,
    authorAvatarUrl: row.author_avatar_url,
    createdAt: row.created_at,
    reactionCount: row.reaction_count,
    commentCount: row.comment_count,
  };
}

/**
 * 제목과 본문을 한 번에 검색해 글 목록 하나로 돌려준다. 제목/본문 어느 쪽이든
 * 맞으면 한 번만 포함되므로 같은 글이 중복되지 않는다. 제목 일치를 먼저,
 * 그다음 본문 일치를 정렬한다.
 */
export async function searchAll(
  userId: string | null,
  query: string,
  opts: { limit: number; offset: number; categorySlug?: string },
): Promise<SearchResults> {
  const needle = query.trim();
  if (needle.length < MIN_SEARCH_LENGTH) {
    return { query: needle, posts: emptyGroup() };
  }

  const { t } = await import('./i18n/ko.ts');
  const lowerNeedle = needle.toLowerCase();
  const pattern = `%${escapeLike(lowerNeedle)}%`;
  const prefixPattern = `${escapeLike(lowerNeedle)}%`;
  const limitPlusOne = opts.limit + 1;
  const category = opts.categorySlug ?? null;
  const params = [pattern, limitPlusOne, opts.offset, category, needle, prefixPattern];

  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<SearchPostRow>(
      `WITH hits AS MATERIALIZED (
         SELECT p.id, p.public_id, p.title, p.body, p.author_id, p.category_id, p.created_at,
                (lower(p.title) LIKE $1 ESCAPE '\\') AS title_matched,
                (lower(p.title) = lower($5)) AS title_exact,
                (lower(p.title) LIKE $6 ESCAPE '\\') AS title_prefix,
                CASE WHEN lower(p.title) LIKE $1 ESCAPE '\\'
                     THEN bigm_similarity(lower(p.title), lower($5)) ELSE 0 END AS title_score,
                (lower(p.body) = lower($5)) AS body_exact,
                (lower(p.body) LIKE $6 ESCAPE '\\') AS body_prefix,
                CASE WHEN lower(p.body) LIKE $1 ESCAPE '\\'
                     THEN bigm_similarity(lower(p.body), lower($5)) ELSE 0 END AS body_score
         FROM posts p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.deleted_at IS NULL
           AND ${HOME_GATE}
           AND (lower(p.title) LIKE $1 ESCAPE '\\' OR lower(p.body) LIKE $1 ESCAPE '\\')
           AND ($4::text IS NULL OR c.slug = $4)
         ORDER BY
           title_matched DESC, title_exact DESC, title_prefix DESC, title_score DESC,
           body_exact DESC, body_prefix DESC, body_score DESC,
           p.created_at DESC, p.id DESC
         LIMIT $2 OFFSET $3
       )
       SELECT ${POST_FIELDS} ${POST_FROM}
       ORDER BY
         h.title_matched DESC, h.title_exact DESC, h.title_prefix DESC, h.title_score DESC,
         h.body_exact DESC, h.body_prefix DESC, h.body_score DESC,
         h.created_at DESC, h.id DESC`,
      params,
    ),
  );

  return {
    query: needle,
    posts: toGroup(rows.rows.map((r) => toPostHit(r, t, needle)), opts.limit, opts.offset),
  };
}
