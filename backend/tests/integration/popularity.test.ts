/**
 * T21 — 인기순 캐시 (§5.1.1)
 *
 * P1: 캐시가 사용자 간에 누출되지 않는가 — 같은 캐시를 봐도 차단 여부에
 *     따라 결과가 달라져야 한다.
 * P2: 차단으로 생긴 구멍을 오버페치가 채우는가.
 * 그 외: 시간 감가 순위, 댓글 가중치 2배, 7일 창 배제.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { closeRedis, redis } from '../../src/redis.ts';
import {
  cachePopularity,
  computePopularity,
  fetchPopularPosts,
  getOrComputePopularity,
  getPopularity,
  overFetchCount,
} from '../../src/popularity.ts';
import { startPopularityRefreshJob } from '../../src/popularity-refresh-job.ts';

let owner: pg.Pool;
let CATEGORY: string;

async function seedPost(opts: {
  title: string;
  authorId: string;
  ageHours: number;
  reactions?: number;
  comments?: number;
}) {
  const p = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility, created_at)
     VALUES ($1, $2, $3, 'public', now() - ($4 || ' hours')::interval)
     RETURNING id`,
    [opts.authorId, CATEGORY, opts.title, opts.ageHours],
  );
  const postId = p.rows[0].id;
  for (let i = 0; i < (opts.reactions ?? 0); i++) {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (username) VALUES ($1) RETURNING id`,
      [`pop_reactor_${postId.slice(0, 8)}_${i}`],
    );
    await owner.query(
      `INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('post', $1, $2, 'helpful')`,
      [postId, u.rows[0].id],
    );
  }
  for (let i = 0; i < (opts.comments ?? 0); i++) {
    await owner.query(
      `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'nice')`,
      [postId, opts.authorId],
    );
  }
  return postId;
}

async function cleanupTestData() {
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'POP::%')`);
  await owner.query(`DELETE FROM reactions WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'POP::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'POP::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'pop_%'`);
  const keys = await redis().keys(`popular:${CATEGORY}:*`);
  if (keys.length) await redis().del(...keys);
}

beforeAll(async () => {
  owner = ownerPool();
  // 🔒 /review에서 posts.category_id에 FK가 추가됨(0018) — 임의 uuid 대신 실제 카테고리를 쓴다.
  CATEGORY = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;
  await cleanupTestData();
});

afterEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await owner?.end();
  await closeRedis();
});

describe('T21 — 인기순 랭킹 공식', () => {
  it('시간 감가 — 반응이 적어도 최신 글이 오래된 글보다 위로 올 수 있다', async () => {
    const alice = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_alice') RETURNING id`)).rows[0].id;
    // 오래된 글: 반응 10개, 120시간 전
    const old = await seedPost({ title: 'POP::old-popular', authorId: alice, ageHours: 120, reactions: 10 });
    // 새 글: 반응 2개, 1시간 전
    const fresh = await seedPost({ title: 'POP::fresh', authorId: alice, ageHours: 1, reactions: 2 });

    const ranked = await computePopularity(owner, CATEGORY, '7d');
    expect(ranked.indexOf(fresh)).toBeLessThan(ranked.indexOf(old));
  });

  it('댓글은 반응보다 2배 무겁다', async () => {
    const alice = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_bob') RETURNING id`)).rows[0].id;
    // 같은 나이, 반응만 2개 vs 댓글만 1개(=반응 2개와 동점이어야 함)
    const reactionHeavy = await seedPost({ title: 'POP::reactions', authorId: alice, ageHours: 3, reactions: 2 });
    const commentHeavy = await seedPost({ title: 'POP::comments', authorId: alice, ageHours: 3, comments: 1 });

    const ranked = await computePopularity(owner, CATEGORY, '7d');
    // 정확히 동점이면 순서는 created_at으로 갈리므로, 점수만 직접 비교한다
    const r = await owner.query<{ id: string; score: string }>(
      `SELECT p.id,
              ((COUNT(DISTINCT r.id) + COUNT(DISTINCT c.id) * 2)
                / POWER(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600 + 2, 1.5))::text AS score
       FROM posts p
       LEFT JOIN reactions r ON r.target_type='post' AND r.target_id = p.id
       LEFT JOIN comments c ON c.target_type='post' AND c.target_id = p.id
       WHERE p.id = ANY($1) GROUP BY p.id`,
      [[reactionHeavy, commentHeavy]],
    );
    const scores = Object.fromEntries(r.rows.map((row) => [row.id, Number(row.score)]));
    expect(scores[reactionHeavy]).toBeCloseTo(scores[commentHeavy], 5);
    expect(ranked).toContain(reactionHeavy);
    expect(ranked).toContain(commentHeavy);
  });

  it('7일 창 — 8일 전 글은 순위에서 빠진다', async () => {
    const alice = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_carol') RETURNING id`)).rows[0].id;
    const tooOld = await seedPost({ title: 'POP::too-old', authorId: alice, ageHours: 24 * 8, reactions: 50 });

    const ranked7d = await computePopularity(owner, CATEGORY, '7d');
    expect(ranked7d).not.toContain(tooOld);
  });
});

describe('T21 — P1: 캐시는 사용자 무관, 필터링은 조회 시점', () => {
  it('🔒 같은 캐시된 ID 목록을 봐도 차단 여부에 따라 결과가 다르다', async () => {
    const author = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_author') RETURNING id`)).rows[0].id;
    const blocker = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_blocker') RETURNING id`)).rows[0].id;
    const bystander = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_bystander') RETURNING id`)).rows[0].id;

    const post = await seedPost({ title: 'POP::blockable', authorId: author, ageHours: 1, reactions: 5 });
    await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [blocker, author]);

    const ranked = await computePopularity(owner, CATEGORY, '7d');
    await cachePopularity(CATEGORY, '7d', ranked);

    // 🔒 캐시 자체는 하나 — 두 사용자가 정확히 같은 ID 목록을 읽는다
    const cachedForBlocker = await getPopularity(CATEGORY, '7d');
    const cachedForBystander = await getPopularity(CATEGORY, '7d');
    expect(cachedForBlocker).toEqual(cachedForBystander);

    const blockerSees = await fetchPopularPosts(blocker, cachedForBlocker!, 20);
    const bystanderSees = await fetchPopularPosts(bystander, cachedForBystander!, 20);

    expect(blockerSees.map((p) => p.id)).not.toContain(post);
    expect(bystanderSees.map((p) => p.id)).toContain(post);

    await owner.query(`DELETE FROM blocks WHERE blocker_id = $1`, [blocker]);
  });

  it('🔒 P2 — 차단으로 빠진 자리를 오버페치가 채운다', async () => {
    const blocked = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_blocked_author') RETURNING id`)).rows[0].id;
    const other = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_other_author') RETURNING id`)).rows[0].id;
    const blocker = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_blocker2') RETURNING id`)).rows[0].id;

    // 🔒 실측 발견(2026-08-21, dev 서버 CI에서 재현) — 이 테스트는 실제
    // 트래픽이 있는 'free' 카테고리에서 돈다. 로컬처럼 거의 빈 DB에선
    // 문제없지만, 실제 글이 쌓인 서버에서는 second(reactions:5, score≈0.96)
    // 보다 점수가 높은 진짜 글이 상위 4위(overFetchCount(2)) 안에 끼어들어
    // second를 밀어냈다 — 코드 버그가 아니라 픽스처 점수가 실데이터와
    // 경쟁 가능한 수준이었던 게 문제(dev 서버에서 직접 조회한 현재
    // 7일 창 최고 실점수는 2.53). seedPost의 reactions는 매번 실제 유저
    // 행까지 새로 만들어 비용이 있어(무한정 키울 수 없다) 과하지 않으면서
    // 최고 실점수 대비 5~15배 여유를 두는 선으로 올렸다 — 비율(4:2:1)과
    // top > second > third 순서는 원래 그대로.
    // 차단 대상 글이 1위, 그다음 2건이 뒤따른다
    const top = await seedPost({ title: 'POP::top-blocked', authorId: blocked, ageHours: 1, reactions: 200 });
    const second = await seedPost({ title: 'POP::second', authorId: other, ageHours: 1, reactions: 100 });
    const third = await seedPost({ title: 'POP::third', authorId: other, ageHours: 2, reactions: 50 });

    await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [blocker, blocked]);

    const ranked = await computePopularity(owner, CATEGORY, '7d');
    expect(ranked[0]).toBe(top); // 차단 전 원본 순위에서는 1위가 맞다

    const limit = 2;
    const rankedForOverfetch = ranked.slice(0, overFetchCount(limit));
    const page = await fetchPopularPosts(blocker, rankedForOverfetch, limit);

    // 1위(top)는 빠졌지만, 오버페치 덕에 여전히 2건이 채워진다
    expect(page).toHaveLength(2);
    expect(page.map((p) => p.id)).toEqual(expect.arrayContaining([second, third]));

    await owner.query(`DELETE FROM blocks WHERE blocker_id = $1`, [blocker]);
  });
});

describe('T21 — 콜드 스타트', () => {
  it('캐시가 없으면 null — 호출부가 최신순으로 폴백한다', async () => {
    const missing = await getPopularity('00000000-0000-0000-0000-0000000000ff', '7d');
    expect(missing).toBeNull();
  });
});

describe('T28 — 캐시 스탬피드 방지 (백그라운드 갱신 잡)', () => {
  it('잡이 돌면 캐시가 선제적으로 채워진다 — 요청이 계산을 트리거하지 않는다', async () => {
    const alice = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_job_alice') RETURNING id`)).rows[0].id;
    await seedPost({ title: 'POP::job-seed', authorId: alice, ageHours: 1, reactions: 3 });

    expect(await getPopularity(CATEGORY, '7d')).toBeNull(); // 시작 전엔 비어 있다

    const stop = startPopularityRefreshJob(owner, [CATEGORY], { intervalMs: 50, jitterMs: 5 });
    try {
      await new Promise((r) => setTimeout(r, 150)); // 지터 최대 5ms + 최초 tick까지 충분히 기다린다
      const ids = await getPopularity(CATEGORY, '7d');
      expect(ids).not.toBeNull();
      expect(ids!.length).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });
});

describe('getOrComputePopularity — 캐시 미스면 계산 후 캐시에 넣는다', () => {
  it('첫 호출 뒤 캐시가 채워지고, 같은 결과를 돌려준다', async () => {
    const alice = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pop_miss_alice') RETURNING id`)).rows[0].id;
    await seedPost({ title: 'POP::miss-seed', authorId: alice, ageHours: 1, reactions: 2 });

    expect(await getPopularity(CATEGORY, '24h')).toBeNull();
    const ids = await getOrComputePopularity(owner, CATEGORY, '24h');
    expect(ids.length).toBeGreaterThan(0);
    expect(await getPopularity(CATEGORY, '24h')).toEqual(ids);
  });
});
