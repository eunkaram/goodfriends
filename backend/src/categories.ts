/**
 * 카테고리 데이터 접근 — §13 Category, §3.1, §12.1 롤아웃 게이트.
 *
 * categories 자체는 RLS가 없다(GRANT SELECT뿐 — 사용자별 분기가 없어서다).
 * subscriptions는 RLS가 있으므로(0016) 그쪽 쿼리만 withRelationCtx로 감싼다.
 */
import { appPool, withRelationCtx, queryRaw } from './db.ts';
import { t } from './i18n/ko.ts';

export type Category = {
  id: string;
  parentId: string | null;
  nameKey: string;
  name: string;
  slug: string;
  type: 'community' | 'market';
  sort: number;
};

export type CategoryGroup = Category & { children: Category[] };

const pool = appPool('exists');

function toCategory(row: { id: string; parent_id?: string | null; name_key: string; slug: string; type: string; sort: number }): Category {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    nameKey: row.name_key,
    name: t(row.name_key),
    slug: row.slug,
    type: row.type as Category['type'],
    sort: row.sort,
  };
}

/**
 * §11.8 메가메뉴용 — 공개된 카테고리 전부를 대분류로 묶어서 준다.
 * "대분류는 공개된 하위가 1개 이상일 때만 표시"(§11.8) — 하위가 없는 그룹은 여기서 걸러진다.
 */
export async function fetchCategoryTree(): Promise<CategoryGroup[]> {
  const parents = await queryRaw<{ id: string; name_key: string; slug: string; type: string; sort: number }>(
    pool,
    `SELECT id, name_key, slug, type, sort FROM categories WHERE parent_id IS NULL ORDER BY sort`,
  );
  const children = await queryRaw<{ id: string; parent_id: string; name_key: string; slug: string; type: string; sort: number }>(
    pool,
    `SELECT id, parent_id, name_key, slug, type, sort FROM categories WHERE parent_id IS NOT NULL AND is_public = true ORDER BY sort`,
  );
  return parents.rows
    .map((p) => ({
      ...toCategory(p),
      children: children.rows.filter((c) => c.parent_id === p.id).map(toCategory),
    }))
    .filter((group) => group.children.length > 0);
}

/**
 * 좌내비(비로그인) "인기 카테고리"(§11.7.2) — 최근 7일 유저활동(글+공감+댓글
 * 수) 기준 상위 N개. 🔒 사용자 지시(2026-08-22) 전엔 sort 순 상위 N이었다
 * (실사용 랭킹 없음) — popularity.ts computePopularity()의 "공감+댓글×2"
 * 가중치와 달리 여기선 카테고리 단위라 셋을 동등하게 더한다(개별 글의 시간
 * 감쇠도 적용 안 함 — "이번 주 활발한 카테고리"면 충분하고, 글 하나가
 * 몰표를 받아 카테고리 랭킹을 흔드는 걸 피하려면 오히려 카운트가 낫다).
 * 활동이 없는 카테고리도 0으로 포함해 목록이 비지 않게 하고, 동점은 기존
 * sort로 정렬한다.
 */
export async function fetchPopularCategories(limit = 5): Promise<Category[]> {
  const r = await queryRaw<{ id: string; name_key: string; slug: string; type: string; sort: number }>(
    pool,
    `SELECT c.id, c.name_key, c.slug, c.type, c.sort
     FROM categories c
     LEFT JOIN (
       SELECT p.category_id, COUNT(DISTINCT p.id) + COUNT(DISTINCT r.id) + COUNT(DISTINCT cm.id) AS activity
       FROM posts p
       LEFT JOIN reactions r ON r.target_type = 'post' AND r.target_id = p.id
       LEFT JOIN comments cm ON cm.target_type = 'post' AND cm.target_id = p.id
       WHERE p.deleted_at IS NULL AND p.category_id IS NOT NULL AND p.created_at > now() - interval '7 days'
       GROUP BY p.category_id
     ) a ON a.category_id = c.id
     WHERE c.parent_id IS NOT NULL AND c.is_public = true AND c.type = 'community'
     ORDER BY COALESCE(a.activity, 0) DESC, c.sort ASC
     LIMIT $1`,
    [limit],
  );
  return r.rows.map(toCategory);
}

/** 좌내비(로그인) "구독 중인 것만"(§11.8) */
export async function fetchSubscribedCategories(userId: string): Promise<Category[]> {
  const r = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; name_key: string; slug: string; type: string; sort: number }>(
      `SELECT c.id, c.name_key, c.slug, c.type, c.sort
       FROM subscriptions s JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = $1
       ORDER BY c.sort`,
      [userId],
    ),
  );
  return r.rows.map(toCategory);
}

/** 로그인 사용자의 구독 category_id — §5.1 랭킹 가중치 쿼리에 그대로 넣는다. */
export async function fetchSubscribedCategoryIds(userId: string): Promise<string[]> {
  const r = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ category_id: string }>(`SELECT category_id FROM subscriptions WHERE user_id = $1`, [userId]),
  );
  return r.rows.map((row) => row.category_id);
}

/** 구독은 최대 10개까지만(사용자 지시, 2026-08) — §5.1 랭킹 가중치가 구독 수만큼 쿼리 비용을
 * 늘리는 건 아니지만, 좌 사이드바 "구독 중" 목록이 무한정 길어지는 걸 막는 UX 상한이다. */
export const SUBSCRIPTION_LIMIT = 10;

export type SubscribeResult = { ok: true } | { ok: false; error: 'LIMIT_REACHED' };

export async function subscribe(userId: string, categoryId: string): Promise<SubscribeResult> {
  return withRelationCtx(pool, { userId }, async (client) => {
    // 이미 구독 중이면 그대로 성공(멱등) — 한도를 다 채운 상태에서 같은 카테고리를
    // 다시 구독해도(중복 클릭 등) 새 행이 느는 게 아니므로 한도 대상이 아니다.
    const existing = await client.query(`SELECT 1 FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [userId, categoryId]);
    if ((existing.rowCount ?? 0) > 0) return { ok: true } as const;

    const count = await client.query<{ count: string }>(`SELECT count(*) FROM subscriptions WHERE user_id = $1`, [userId]);
    if (Number(count.rows[0].count) >= SUBSCRIPTION_LIMIT) {
      return { ok: false, error: 'LIMIT_REACHED' } as const;
    }

    await client.query(`INSERT INTO subscriptions (user_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, categoryId]);
    return { ok: true } as const;
  });
}

export async function unsubscribe(userId: string, categoryId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`DELETE FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [userId, categoryId]),
  );
}

export async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  const r = await queryRaw<{ id: string; parent_id: string | null; name_key: string; slug: string; type: string; sort: number }>(
    pool,
    `SELECT id, parent_id, name_key, slug, type, sort FROM categories WHERE slug = $1 AND is_public = true`,
    [slug],
  );
  return r.rows[0] ? toCategory(r.rows[0]) : null;
}

/** §11.7.3 좌내비 "형제 카테고리만" — 현재 카테고리와 같은 대분류의 다른 공개 하위들(본인 제외). */
export async function fetchSiblingCategories(category: Category): Promise<Category[]> {
  if (!category.parentId) return [];
  const r = await queryRaw<{ id: string; parent_id: string | null; name_key: string; slug: string; type: string; sort: number }>(
    pool,
    `SELECT id, parent_id, name_key, slug, type, sort FROM categories WHERE parent_id = $1 AND is_public = true AND id <> $2 ORDER BY sort`,
    [category.parentId, category.id],
  );
  return r.rows.map(toCategory);
}

export async function isSubscribed(userId: string, categoryId: string): Promise<boolean> {
  const r = await withRelationCtx(pool, { userId }, (client) =>
    client.query(`SELECT 1 FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [userId, categoryId]),
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * GitHub #2 — 모바일 피드 필터·글쓰기 카테고리 선택·구독 관리용 평평한 목록.
 * fetchPopularCategories()와 같은 WHERE(leaf·공개·커뮤니티만) — 대분류는
 * 메가메뉴 전용 그룹 라벨일 뿐 그 자체로 구독·글쓰기 대상이 아니고, 마켓
 * 카테고리는 이 세 화면(피드 필터/글쓰기/구독) 전부 커뮤니티 전용이라 범위 밖.
 */
export async function fetchAllCategories(): Promise<Category[]> {
  const r = await queryRaw<{ id: string; name_key: string; slug: string; type: string; sort: number }>(
    pool,
    `SELECT id, name_key, slug, type, sort FROM categories
     WHERE parent_id IS NOT NULL AND is_public = true AND type = 'community'
     ORDER BY sort`,
  );
  return r.rows.map(toCategory);
}
