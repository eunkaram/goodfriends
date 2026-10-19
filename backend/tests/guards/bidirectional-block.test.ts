/**
 * 양방향 차단 (PRD §4.2, P10 — 0004 마이그레이션에서 수정)
 *
 * 검증: A가 B를 차단하면, A는 B의 글을 못 보고 — 동시에 — B도 A의 글을
 * 못 봐야 한다. §4.2는 "차단" 행에 방향 구분이 없다.
 *
 * 이 결함은 posts_select_exists의 차단 체크가 단방향(내가 차단한 사람만
 * 걸러냄)이라 발생했다. 차단한 쪽 화면은 정상으로 보인다 — 정확히 그래서
 * 놓치기 쉽다. 차단당한 쪽이 여전히 상대를 볼 수 있는 상태가 진짜 결함이다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;
let alice: string;
let bob: string;
let alicePostId: string;
let bobPostId: string;

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('exists');

  await owner.query(`DELETE FROM posts WHERE title LIKE 'BLOCK::%'`);
  await owner.query(`DELETE FROM blocks WHERE blocker_id IN (SELECT id FROM users WHERE username LIKE 'block_%')`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'block_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('block_alice'), ('block_bob') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'block_alice')!.id;
  bob = u.rows.find((r) => r.username === 'block_bob')!.id;

  // 🔒 /review에서 posts.category_id에 FK가 추가됨(0018) — 임의 uuid 대신 실제 카테고리를 쓴다.
  const category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;
  const ap = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'BLOCK::alice post', 'public') RETURNING id`,
    [alice, category],
  );
  alicePostId = ap.rows[0].id;
  const bp = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'BLOCK::bob post', 'public') RETURNING id`,
    [bob, category],
  );
  bobPostId = bp.rows[0].id;

  // alice가 bob을 차단
  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [alice, bob]);
});

afterAll(async () => {
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'BLOCK::%'`);
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1`, [alice]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'block_%'`);
  await app?.end();
  await owner?.end();
});

describe('P10 — 양방향 차단', () => {
  it('차단한 쪽(alice)은 차단당한 사람(bob)의 글을 못 본다', async () => {
    const seen = await withRelationCtx(app, { userId: alice }, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'BLOCK::%'`);
      return r.rows.map((x) => x.id);
    });
    expect(seen).not.toContain(bobPostId);
    expect(seen).toContain(alicePostId);
  });

  it('🔒 차단당한 쪽(bob)도 차단한 사람(alice)의 글을 못 본다', async () => {
    const seen = await withRelationCtx(app, { userId: bob }, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'BLOCK::%'`);
      return r.rows.map((x) => x.id);
    });
    expect(seen).not.toContain(alicePostId);
    expect(seen).toContain(bobPostId);
  });
});
