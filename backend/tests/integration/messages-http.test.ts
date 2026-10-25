/**
 * 메시징 HTTP 라우트 — src/messages-http.ts. GET /api/messages/unread 검증.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleMessagesRoutes } from '../../src/messages-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string;
let bob: string;
let aliceToken: string;
let threadId: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleMessagesRoutes(req, res)) return;
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
  await owner.query(
    `DELETE FROM message_threads WHERE id IN (
       SELECT DISTINCT p.thread_id FROM participants p
       JOIN users u ON u.id = p.user_id
       WHERE u.username LIKE 'mhttp\\_%' ESCAPE '\\'
     )`,
  );
  await owner.query(`DELETE FROM users WHERE username LIKE 'mhttp_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('mhttp_alice'), ('mhttp_bob') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'mhttp_alice')!.id;
  bob = u.rows.find((r) => r.username === 'mhttp_bob')!.id;
  aliceToken = (await createSession(alice)).token;

  const t = await owner.query<{ id: string }>(`INSERT INTO message_threads DEFAULT VALUES RETURNING id`);
  threadId = t.rows[0].id;
  await owner.query(`INSERT INTO participants (thread_id, user_id) VALUES ($1, $2), ($1, $3)`, [threadId, alice, bob]);
});

afterAll(async () => {
  await destroySession(aliceToken);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'mhttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/messages/unread', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/messages/unread`);
    expect(res.status).toBe(401);
  });

  it('안 읽은 메시지가 없으면 false', async () => {
    const res = await fetch(`${baseUrl}/api/messages/unread`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasUnread: false });
  });

  it('상대가 보낸 새 메시지가 있으면 true', async () => {
    await owner.query(`INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, 'hi')`, [threadId, bob]);

    const res = await fetch(`${baseUrl}/api/messages/unread`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasUnread: true });
  });

  it('읽음 처리 후엔 다시 false', async () => {
    await owner.query(`UPDATE participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2`, [threadId, alice]);

    const res = await fetch(`${baseUrl}/api/messages/unread`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasUnread: false });
  });
});
