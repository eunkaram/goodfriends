/**
 * Category · Subscription (§13, §12.1 롤아웃 게이트, §5 랭킹 가중치)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import {
  fetchCategoryTree,
  fetchPopularCategories,
  fetchSubscribedCategories,
  fetchSubscribedCategoryIds,
  fetchCategoryBySlug,
  fetchSiblingCategories,
  isSubscribed,
  subscribe,
  unsubscribe,
  SUBSCRIPTION_LIMIT,
} from '../../src/categories.ts';

let owner: pg.Pool;
let user: string;
let chatId: string;
// 🔒 사용자 지시(2026-08, "커뮤니티 카테고리를 정리를 하고 싶어") — 0033이
// 커뮤니티 카테고리를 전부 공개로 정리하면서, "비공개 카테고리" 게이트를
// 검증할 자연 발생 예시가 taxonomy에서 사라졌다. 이 describe 블록 전용으로
// 비공개 테스트 카테고리를 하나 만들어 쓰고 끝나면 지운다 — 어떤 taxonomy가
// 와도 이 테스트가 흔들리지 않는다.
let hiddenId: string;
let buildGroupId: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM users WHERE username LIKE 'cat_test_%'`);
  const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('cat_test_user') RETURNING id`);
  user = u.rows[0].id;
  const c = await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`);
  chatId = c.rows[0].id;

  const buildGroup = await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'build'`);
  buildGroupId = buildGroup.rows[0].id; // sibling 테스트용(하위 4개 공개)
  const hidden = await owner.query<{ id: string }>(
    `INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public) VALUES ($1, 'category.cat_test_hidden', 'cat-test-hidden', 'community', 99, false) RETURNING id`,
    [buildGroupId],
  );
  hiddenId = hidden.rows[0].id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM subscriptions WHERE user_id = $1`, [user]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'cat_test_%'`);
  await owner?.query(`DELETE FROM categories WHERE id = $1`, [hiddenId]);
  await owner?.end();
});

describe('카테고리 트리 (§11.8 메가메뉴)', () => {
  it('공개된 하위가 있는 대분류만 포함한다(§11.8 — 빈 대분류 헤더 금지)', async () => {
    const tree = await fetchCategoryTree();
    // 0049 — 배우고·만들고·나누는 3그룹(기획 기준 ai-board-phase1.pdf §2).
    expect(tree.map((g) => g.slug).sort()).toEqual(['build', 'learn', 'share']);
    const learn = tree.find((g) => g.slug === 'learn')!;
    expect(learn.name).toBe('배우고');
    expect(learn.children.map((c) => c.slug)).toContain('ai-news');
    expect(learn.children.map((c) => c.slug)).not.toContain('cat-test-hidden'); // is_public=false
  });

  it('인기 카테고리 5개를 반환한다(§11.7.2)', async () => {
    const popular = await fetchPopularCategories(5);
    expect(popular).toHaveLength(5);
    expect(popular.every((c) => c.name.length > 0)).toBe(true);
  });

  it('🔒 사용자 지시(2026-08-22) — 최근 7일 활동(글+공감+댓글)이 많은 카테고리가 활동 없는 카테고리보다 상위에 온다', async () => {
    // 🔒 이 카테고리 2개는 이 테스트 안에서만 살아있다(beforeAll이 아니라
    // 테스트 본문에서 만들고 finally에서 지운다) — "카테고리 트리"/"형제
    // 카테고리만 반환한다" 테스트가 talk 그룹의 공개 하위 목록을 정확한
    // 개수로 단언해서, 다른 테스트가 실행되는 동안엔 이 픽스처가 존재하면 안 된다.
    const active = await owner.query<{ id: string }>(
      `INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public) VALUES ($1, 'category.cat_test_active', 'cat-test-active', 'community', 99, true) RETURNING id`,
      [buildGroupId],
    );
    const activeCatId = active.rows[0].id;
    const quiet = await owner.query<{ id: string }>(
      `INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public) VALUES ($1, 'category.cat_test_quiet', 'cat-test-quiet', 'community', 99, true) RETURNING id`,
      [buildGroupId],
    );
    const quietCatId = quiet.rows[0].id;

    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility, created_at) VALUES ($1, $2, 'CATPOP::활동테스트', 'public', now()) RETURNING id`,
      [user, activeCatId],
    );
    const postId = post.rows[0].id;
    const reactor = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('cat_test_reactor') RETURNING id`);
    await owner.query(`INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('post', $1, $2, 'helpful')`, [
      postId,
      reactor.rows[0].id,
    ]);
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'nice')`, [postId, user]);

    try {
      // 전체를 다 받아서(카테고리 수가 적어 넉넉히) 두 임시 카테고리의 상대 순위만 비교한다 —
      // 실제 프로덕션 카테고리들의 활동량은 테스트가 통제할 수 없다.
      const popular = await fetchPopularCategories(50);
      const rankedIds = popular.map((c) => c.id);
      expect(rankedIds.indexOf(activeCatId)).toBeGreaterThanOrEqual(0);
      expect(rankedIds.indexOf(quietCatId)).toBeGreaterThanOrEqual(0);
      expect(rankedIds.indexOf(activeCatId)).toBeLessThan(rankedIds.indexOf(quietCatId));
    } finally {
      await owner.query(`DELETE FROM comments WHERE target_id = $1`, [postId]);
      await owner.query(`DELETE FROM reactions WHERE target_id = $1`, [postId]);
      await owner.query(`DELETE FROM posts WHERE id = $1`, [postId]);
      await owner.query(`DELETE FROM users WHERE username = 'cat_test_reactor'`);
      await owner.query(`DELETE FROM categories WHERE id IN ($1, $2)`, [activeCatId, quietCatId]);
    }
  });

  it('슬러그로 공개 카테고리를 조회한다', async () => {
    const cat = await fetchCategoryBySlug('free');
    expect(cat?.name).toBe('자유게시판');
  });

  it('비공개 카테고리는 슬러그로도 안 나온다(§12.1 롤아웃 게이트)', async () => {
    const cat = await fetchCategoryBySlug('cat-test-hidden');
    expect(cat).toBeNull();
  });

  it('형제 카테고리만 반환한다(§11.7.3 — 전체 트리 아님, 본인 제외)', async () => {
    const tips = await fetchCategoryBySlug('ai-tips');
    const siblings = await fetchSiblingCategories(tips!);
    const slugs = siblings.map((c) => c.slug).sort();
    expect(slugs).toEqual(['ai-news', 'ai-topics', 'qna']); // 배우고의 공개 하위 중 ai-tips 제외(research은 비공개라 안 보임)
    expect(slugs).not.toContain('ai-tips');
    expect(slugs).not.toContain('dev-log'); // 다른 대분류(만들고)는 형제가 아니다
  });

  it('대분류(부모)는 형제가 없다', async () => {
    const learn = (await fetchCategoryTree()).find((g) => g.slug === 'learn')!;
    expect(await fetchSiblingCategories(learn)).toEqual([]);
  });
});

describe('구독 (§5 랭킹 가중치, §11.8 좌내비)', () => {
  it('구독 전에는 빈 목록', async () => {
    expect(await fetchSubscribedCategories(user)).toEqual([]);
  });

  it('구독하면 목록·ID 둘 다 반영된다', async () => {
    expect(await isSubscribed(user, chatId)).toBe(false);
    await subscribe(user, chatId);
    const list = await fetchSubscribedCategories(user);
    expect(list.map((c) => c.slug)).toEqual(['free']);
    expect(await fetchSubscribedCategoryIds(user)).toEqual([chatId]);
    expect(await isSubscribed(user, chatId)).toBe(true);
  });

  it('중복 구독해도 에러 없이 멱등하다', async () => {
    await subscribe(user, chatId);
    expect(await fetchSubscribedCategoryIds(user)).toEqual([chatId]);
  });

  it('구독 취소하면 목록에서 빠진다', async () => {
    await unsubscribe(user, chatId);
    expect(await fetchSubscribedCategories(user)).toEqual([]);
  });
});

describe('구독 한도 (사용자 지시 2026-08 — "최대 10개까지만")', () => {
  // 🔒 0049 — 1차 taxonomy엔 공개 커뮤니티 leaf가 9개뿐이다. 한도(+1이
  // 필요한) 테스트가 taxonomy 개수에 흔들리지 않게, 부족한 만큼 이 테스트
  // 전용 공개 카테고리를 만들어 쓰고 끝나면 지운다("cat-test-sub" 접두사).
  let extraIds: string[] = [];
  beforeAll(async () => {
    const leafCount = await owner.query<{ count: string }>(
      `SELECT count(*) FROM categories WHERE type = 'community' AND parent_id IS NOT NULL AND is_public = true`,
    );
    const missing = SUBSCRIPTION_LIMIT + 1 - Number(leafCount.rows[0].count);
    console.log('[dbg] leafCount=', leafCount.rows[0].count, 'missing=', missing);
    if (missing > 0) {
      const ids: string[] = [];
      // 이전 실패한 런의 잔재 제거(name_key·slug 유니크 충돌 방지)
      await owner.query(`DELETE FROM categories WHERE slug LIKE 'cat-test-sub-%'`);
      for (let i = 0; i < missing; i++) {
        const r = await owner.query<{ id: string }>(
          `INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
           VALUES ((SELECT id FROM categories WHERE name_key = 'category.build'), 'category.cat_test_sub_' || $1, 'cat-test-sub-' || $1, 'community', 98, true)
           RETURNING id`,
          [`${i}`.padStart(2, '0')],
        );
        console.log('[dbg] inserted', r.rows[0].id);
      }
      extraIds = ids;
    }
  });
  afterAll(async () => {
    if (extraIds.length > 0) {
      await owner.query(`DELETE FROM categories WHERE id = ANY($1::uuid[])`, [extraIds]);
    }
  });

  it(`${SUBSCRIPTION_LIMIT + 1}번째 구독은 LIMIT_REACHED로 거부되고, 이미 채운 ${SUBSCRIPTION_LIMIT}개는 그대로 남는다`, async () => {
    const rows = await owner.query<{ id: string }>(
      `SELECT id FROM categories WHERE type = 'community' AND parent_id IS NOT NULL AND is_public = true ORDER BY sort LIMIT $1`,
      [SUBSCRIPTION_LIMIT + 1],
    );
    // 이 테스트가 유효하려면 공개 커뮤니티 카테고리가 한도+1개 이상 있어야 한다.
    expect(rows.rows.length).toBe(SUBSCRIPTION_LIMIT + 1);
    const ids = rows.rows.map((r) => r.id);

    for (const id of ids.slice(0, SUBSCRIPTION_LIMIT)) {
      expect(await subscribe(user, id)).toEqual({ ok: true });
    }
    expect(await fetchSubscribedCategoryIds(user)).toHaveLength(SUBSCRIPTION_LIMIT);

    const overflowId = ids[SUBSCRIPTION_LIMIT];
    expect(await subscribe(user, overflowId)).toEqual({ ok: false, error: 'LIMIT_REACHED' });
    expect(await fetchSubscribedCategoryIds(user)).toHaveLength(SUBSCRIPTION_LIMIT); // 11번째는 안 들어갔다
    expect(await isSubscribed(user, overflowId)).toBe(false);

    for (const id of ids.slice(0, SUBSCRIPTION_LIMIT)) {
      await unsubscribe(user, id);
    }
    expect(await fetchSubscribedCategories(user)).toEqual([]);
  });

  it('한도를 채운 상태에서 이미 구독 중인 카테고리를 다시 구독해도 성공한다(멱등 — 한도 대상 아님)', async () => {
    const rows = await owner.query<{ id: string }>(
      `SELECT id FROM categories WHERE type = 'community' AND parent_id IS NOT NULL AND is_public = true ORDER BY sort LIMIT $1`,
      [SUBSCRIPTION_LIMIT],
    );
    const ids = rows.rows.map((r) => r.id);
    for (const id of ids) {
      await subscribe(user, id);
    }

    expect(await subscribe(user, ids[0])).toEqual({ ok: true }); // 이미 구독 중인 첫 카테고리 재구독
    expect(await fetchSubscribedCategoryIds(user)).toHaveLength(SUBSCRIPTION_LIMIT);

    for (const id of ids) {
      await unsubscribe(user, id);
    }
    expect(await fetchSubscribedCategories(user)).toEqual([]);
  });
});
