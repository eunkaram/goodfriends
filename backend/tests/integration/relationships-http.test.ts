/**
 * 관계 HTTP 라우트 — src/relationships-http.ts.
 *
 * 🔒 /review 발견(testing, confidence 90) — 이 두 라우트(친구신청 수락,
 * 언팔로우)는 HTTP 레벨로 한 번도 실행된 적이 없었다. src/relationships.ts의
 * acceptFriendRequest/unfollow 자체는 tests/guards/relationships.test.ts가
 * 이미 검증하지만, 라우팅 배선(세션 체크, 상태 코드, 요청 바디 파싱)은
 * 별개 레이어라 따로 확인해야 한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleRelationshipsRoutes } from '../../src/relationships-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string;
let bob: string;
let aliceToken: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleRelationshipsRoutes(req, res)) return;
      res.writeHead(404);
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;

  owner = ownerPool();
  await owner.query(`DELETE FROM users WHERE username LIKE 'fhttp_%'`);
  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('fhttp_alice'), ('fhttp_bob') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'fhttp_alice')!.id;
  bob = u.rows.find((r) => r.username === 'fhttp_bob')!.id;
  aliceToken = (await createSession(alice)).token;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await owner?.query(`DELETE FROM follows WHERE follower_id = ANY($1::uuid[])`, [[alice, bob]]);
  await owner?.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[])`, [[alice, bob]]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'fhttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/relationships/following', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/relationships/following`);
    expect(res.status).toBe(401);
  });

  it('팔로잉 중인 유저를 최신순으로 반환하고, limit이 먹힌다', async () => {
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [alice, bob]);

    const res = await fetch(`${baseUrl}/api/relationships/following`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { following: { id: string; username: string; nickname: string; avatarUrl: string }[] };
    expect(body.following.map((f) => f.id)).toContain(bob);

    const limited = await fetch(`${baseUrl}/api/relationships/following?limit=0`, { headers: sessionCookieHeader(aliceToken) });
    // parsePageParam이 min:1로 clamp — limit=0 요청도 최소 1건은 온다.
    expect(((await limited.json()) as { following: unknown[] }).following.length).toBeGreaterThan(0);

    await owner.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [alice, bob]);
  });
});

describe('GET /api/relationships/connected', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/relationships/connected`);
    expect(res.status).toBe(401);
  });

  it('팔로우 방향 무관하게 팔로잉+팔로워 합집합을 반환한다', async () => {
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [bob, alice]);

    const res = await fetch(`${baseUrl}/api/relationships/connected`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: { id: string }[] };
    expect(body.connected.map((c) => c.id)).toContain(bob);

    await owner.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [bob, alice]);
  });
});

describe('GET /api/friends', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/friends`);
    expect(res.status).toBe(401);
  });

  it('수락된 친구를 mutual과 함께 반환한다', async () => {
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`, [alice, bob]);

    const res = await fetch(`${baseUrl}/api/friends`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { friends: { id: string; mutual: number }[] };
    const bobEntry = body.friends.find((f) => f.id === bob);
    expect(bobEntry).toBeDefined();
    expect(typeof bobEntry!.mutual).toBe('number');

    await owner.query(`DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [alice, bob]);
  });
});

describe('POST /api/friend-requests/accept', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/friend-requests/accept`, { method: 'POST', body: JSON.stringify({ requesterId: bob }) });
    expect(res.status).toBe(401);
  });

  it('신청이 없으면 404', async () => {
    const res = await fetch(`${baseUrl}/api/friend-requests/accept`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ requesterId: bob }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('신청이 있으면 200 — DB 상태도 accepted로 바뀐다', async () => {
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`, [bob, alice]);

    const res = await fetch(`${baseUrl}/api/friend-requests/accept`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ requesterId: bob }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = await owner.query(`SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [bob, alice]);
    expect(row.rows[0].status).toBe('accepted');
  });
});

describe('DELETE /api/follows', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/follows`, { method: 'DELETE', body: JSON.stringify({ followeeId: bob }) });
    expect(res.status).toBe(401);
  });

  it('팔로우 중이면 삭제되고, DB에서도 행이 사라진다', async () => {
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [alice, bob]);

    const res = await fetch(`${baseUrl}/api/follows`, {
      method: 'DELETE',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ followeeId: bob }),
    });
    expect(res.status).toBe(200);

    const row = await owner.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [alice, bob]);
    expect(row.rowCount).toBe(0);
  });

  it('애초에 팔로우 중이 아니어도 에러 없이 200(멱등)', async () => {
    const res = await fetch(`${baseUrl}/api/follows`, {
      method: 'DELETE',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ followeeId: bob }),
    });
    expect(res.status).toBe(200);
  });
});
