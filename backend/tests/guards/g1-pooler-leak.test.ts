/**
 * G1 — 풀러 컨텍스트 누수 (PRD §10.1-bis)
 *
 * 검증: 트랜잭션이 끝난 뒤 세션 변수가 커넥션에 남아 있지 않은가.
 *
 * 이 결함은 화면상 정상으로 보인다. 내 데이터는 잘 보이기 때문이다.
 * 남의 권한을 물려받은 쪽에서만 티가 나며, 그것도 "왜 이게 보이지" 수준이라
 * 기능 테스트로는 절대 잡히지 않는다.
 *
 * 🔒 반드시 PgBouncer(트랜잭션 모드)를 통과해야 재현된다.
 *    Postgres 직결로 돌리면 커넥션이 1:1이라 누수가 드러나지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, queryRaw, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;

let alice: string;   // 관측자
let bob: string;     // alice 의 친구
let carol: string;   // 무관계 제3자
let bobFriendsPostId: string;

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('arrays');   // PgBouncer 경유가 기본값

  await owner.query(`DELETE FROM posts WHERE title LIKE 'G1::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'g1_%'`);

  const users = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('g1_alice'), ('g1_bob'), ('g1_carol')
     RETURNING id, username`,
  );
  alice = users.rows.find((r) => r.username === 'g1_alice')!.id;
  bob = users.rows.find((r) => r.username === 'g1_bob')!.id;
  carol = users.rows.find((r) => r.username === 'g1_carol')!.id;

  await owner.query(
    `INSERT INTO friendships (requester_id, addressee_id, status)
     VALUES ($1, $2, 'accepted')`,
    [alice, bob],
  );

  const posts = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, log_id, title, visibility)
     VALUES ($1, gen_random_uuid(), 'G1::bob friends-only', 'friends')
     RETURNING id`,
    [bob],
  );
  bobFriendsPostId = posts.rows[0].id;

  await owner.query(
    `INSERT INTO posts (author_id, log_id, title, visibility)
     VALUES ($1, gen_random_uuid(), 'G1::carol public', 'public')`,
    [carol],
  );
});

afterAll(async () => {
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'G1::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'g1_%'`);
  await app?.end();
  await owner?.end();
});

describe('G1 — 풀러 컨텍스트 누수', () => {
  it('컨텍스트를 주입하면 친구공개 글이 보인다 (양성 대조군)', async () => {
    const seen = await withRelationCtx(app, { userId: alice, friendIds: [bob], blockedIds: [] }, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'G1::%'`);
      return r.rows.map((x) => x.id);
    });
    expect(seen).toContain(bobFriendsPostId);
  });

  it('트랜잭션 종료 후 세션 변수가 남지 않는다', async () => {
    await withRelationCtx(app, { userId: alice, friendIds: [bob], blockedIds: [] }, async (c) => {
      const inside = await c.query<{ v: string | null }>(
        `SELECT current_setting('app.user_id', true) AS v`,
      );
      expect(inside.rows[0].v).toBe(alice);
      return null;
    });

    // 같은 풀에서 새 쿼리 — 커넥션이 재사용될 수 있다
    const after = await queryRaw<{ v: string | null }>(
      app,
      `SELECT current_setting('app.user_id', true) AS v`,
    );
    // SET LOCAL 이면 COMMIT 에서 소멸한다. SET 이었다면 alice 가 그대로 남는다.
    expect(after.rows[0].v ?? '').toBe('');
  });

  it('🔒 컨텍스트 없는 조회는 친구공개 글을 절대 보지 못한다 (반복 재사용)', async () => {
    // 커넥션 재사용을 강제하기 위해 여러 번 왕복한다.
    // PgBouncer DEFAULT_POOL_SIZE=3 이므로 금방 같은 커넥션으로 돌아온다.
    for (let i = 0; i < 25; i++) {
      await withRelationCtx(app, { userId: alice, friendIds: [bob], blockedIds: [] }, async (c) => {
        await c.query(`SELECT id FROM posts WHERE title LIKE 'G1::%'`);
        return null;
      });

      const leaked = await queryRaw<{ id: string }>(
        app,
        `SELECT id FROM posts WHERE title LIKE 'G1::%'`,
      );
      const ids = leaked.rows.map((r) => r.id);

      expect(
        ids,
        `iteration ${i}: 앞 트랜잭션의 관계 컨텍스트가 누수됐다`,
      ).not.toContain(bobFriendsPostId);
    }
  });

  it('🔒 사용자 A → B 순서로 조회해도 B가 A의 행을 보지 않는다', async () => {
    for (let i = 0; i < 15; i++) {
      // A: alice (bob 과 친구)
      const aSeen = await withRelationCtx(app, { userId: alice, friendIds: [bob], blockedIds: [] }, async (c) => {
        const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'G1::%'`);
        return r.rows.map((x) => x.id);
      });
      expect(aSeen).toContain(bobFriendsPostId);

      // B: carol (친구 없음) — 같은 커넥션을 물려받을 수 있다
      const bSeen = await withRelationCtx(app, { userId: carol, friendIds: [], blockedIds: [] }, async (c) => {
        const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'G1::%'`);
        return r.rows.map((x) => x.id);
      });
      expect(
        bSeen,
        `iteration ${i}: carol 이 alice 의 친구 컨텍스트를 물려받았다`,
      ).not.toContain(bobFriendsPostId);
    }
  });
});
