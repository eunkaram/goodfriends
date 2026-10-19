/**
 * 인기순 캐시 (PRD §5.1.1, T21)
 *
 * 🔒 캐시에는 전역 순위 ID 배열만 담는다. 사용자 식별자를 절대 넣지 않는다.
 * 필터링(차단 등)은 ID로 본문을 가져오는 RLS 쿼리에서 처리한다 — 권한 로직이
 * 두 곳으로 갈라지지 않는다(§4.5 2계층 유지). 이게 P1 게이트다.
 */
import type pg from 'pg';
import { redis } from './redis.ts';
import { appPool } from './db.ts';

// 🔒 성능 점검 발견(2026-08-22) — fetchPopularPosts()가 호출될 때마다
// appPool('exists')를 새로 불러 매번 새 pg.Pool(최대 4커넥션)을 만들고
// 절대 안 닫았다(불변식 20 위반) — 홈/카테고리/글상세 등 거의 모든 페이지가
// 이 함수를 부르니 페이지 로드마다 커넥션이 샜다. 다른 src/*.ts 파일들과
// 같은 패턴으로 모듈 스코프에서 한 번만 만든다.
const pool = appPool('exists');

export type PopularityWindow = '7d' | '24h';

const WINDOW_HOURS: Record<PopularityWindow, number> = { '7d': 24 * 7, '24h': 24 };
const RANKING_SIZE = 100; // 캐시에 담아두는 순위 길이 — 여유분 오버페치가 여기서 소비된다
const SAFETY_TTL_SECONDS = 20 * 60; // 갱신 잡이 멎어도 20분 뒤엔 스스로 사라져 콜드스타트 폴백으로 넘어간다

function cacheKey(categoryId: string | null, window: PopularityWindow) {
  return `popular:${categoryId ?? 'all'}:${window}`;
}

/**
 * 전역 집계 — 사용자 컨텍스트 없이 돈다. 커뮤니티 글은 §5.2로 전체공개
 * 고정이라 순위 자체가 진짜 전역이다(§5.1.1 "전제"). 이 전제가 깨지면
 * (비공개 커뮤니티 글이 생기면) 이 함수부터 다시 봐야 한다.
 */
export async function computePopularity(
  pool: pg.Pool,
  categoryId: string | null,
  window: PopularityWindow,
): Promise<string[]> {
  const hours = WINDOW_HOURS[window];
  const r = await pool.query<{ id: string }>(
    `
    SELECT p.id,
           (COUNT(DISTINCT r.id) + COUNT(DISTINCT c.id) * 2)
             / POWER(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600 + 2, 1.5) AS score
    FROM posts p
    LEFT JOIN reactions r ON r.target_type = 'post' AND r.target_id = p.id
    LEFT JOIN comments  c ON c.target_type = 'post' AND c.target_id = p.id
    WHERE p.deleted_at IS NULL
      AND p.category_id IS NOT NULL  -- 커뮤니티 글만 — §5.1.1 전제
      AND ($1::uuid IS NULL OR p.category_id = $1)
      AND p.created_at > now() - ($2 || ' hours')::interval
    GROUP BY p.id, p.created_at
    ORDER BY score DESC, p.created_at DESC
    LIMIT ${RANKING_SIZE}
    `,
    [categoryId, hours],
  );
  return r.rows.map((row) => row.id);
}

export async function cachePopularity(categoryId: string | null, window: PopularityWindow, ids: string[]) {
  const key = cacheKey(categoryId, window);
  await redis().set(key, JSON.stringify({ ids, computedAt: Date.now() }), 'EX', SAFETY_TTL_SECONDS);
}

/** null 반환 = 콜드 스타트. 호출부가 최신순으로 폴백한다(§5.1.1 콜드 스타트 행). */
export async function getPopularity(categoryId: string | null, window: PopularityWindow): Promise<string[] | null> {
  const raw = await redis().get(cacheKey(categoryId, window));
  if (!raw) return null;
  return (JSON.parse(raw) as { ids: string[] }).ids;
}

/**
 * 순위 ID를 실제 본문으로 바꾼다. 여기서 RLS가 걸린다 — 차단·삭제된 글이
 * 자연스럽게 빠지고, 오버페치가 그 구멍을 메운다.
 *
 * 🔒 P1: 이 함수는 캐시를 안 만진다 — 사용자별 필터링은 오직 여기, 쿼리
 *    시점에서만 일어난다. 두 사용자가 같은 rankedIds를 받아도 결과는
 *    각자의 RLS로 다르게 걸러진다.
 * 🔒 P2: rankedIds가 이미 limit*2 이상을 담고 있어야 over-fetch가 성립한다.
 *    호출부가 이를 보장한다(§5.1.1 "여유분").
 */
/**
 * 🔒 사용자 지시(2026-08-21, "URL이 너무 길어서 줄이고 싶어") — 인기 글
 * 위젯(HomeSidebars.tsx)이 지금까지 `/post/{id}`(카테고리 없는 폴백)만
 * 썼는데, 인기 글은 커뮤니티 글만이라(§5.1.1 전제, 위 주석) 항상 진짜
 * 카테고리가 있다 — categorySlug를 같이 내려줘 폴백이 아니라 정식
 * `/{slug}/{publicId}` 링크를 만들 수 있게 한다.
 */
export async function fetchPopularPosts(
  userId: string | null,
  rankedIds: string[],
  limit: number,
): Promise<Array<{ id: string; publicId: string; title: string; categorySlug: string | null }>> {
  if (rankedIds.length === 0) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId ?? '']);
    const r = await client.query<{ id: string; public_id: string; title: string; category_slug: string | null }>(
      `
      SELECT p.id, p.public_id, p.title, c.slug AS category_slug
      FROM posts p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], p.id)
      LIMIT $2
      `,
      [rankedIds, limit],
    );
    await client.query('COMMIT');
    return r.rows.map((row) => ({ id: row.id, publicId: row.public_id, title: row.title, categorySlug: row.category_slug }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** limit 요청에 대해 몇 건을 오버페치할지 — §5.1.1 "20건 요청 시 40건". */
export function overFetchCount(limit: number): number {
  return Math.min(limit * 2, RANKING_SIZE);
}
