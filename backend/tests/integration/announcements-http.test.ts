/**
 * 유저용 공지사항 조회 HTTP 라우트 — src/announcements-http.ts. 이슈 #10.
 * 함수 자체(fetchActiveAnnouncements 등)는 tests/guards/announcements.test.ts가
 * 검증한다 — 여긴 라우팅 배선(세션 체크, 상태 코드)만 확인한다(categories-http.test.ts와 같은 원칙).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleAnnouncementsRoutes } from '../../src/announcements-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string;
let aliceToken: string;
let announcementId: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleAnnouncementsRoutes(req, res)) return;
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
  await owner.query(`DELETE FROM announcements WHERE title LIKE 'ANNHTTP::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'annhttp_%'`);

  const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('annhttp_alice') RETURNING id`);
  alice = u.rows[0].id;
  aliceToken = (await createSession(alice)).token;

  const a = await owner.query<{ id: string }>(
    `INSERT INTO announcements (title, body, created_by) VALUES ('ANNHTTP::공지', '본문', $1) RETURNING id`,
    [alice],
  );
  announcementId = a.rows[0].id;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await owner?.query(`DELETE FROM announcements WHERE title LIKE 'ANNHTTP::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'annhttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/announcements/active', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/announcements/active`);
    expect(res.status).toBe(401);
  });

  it('로그인 상태면 활성 공지 목록을 준다', async () => {
    const res = await fetch(`${baseUrl}/api/announcements/active`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { announcements: { id: string; title: string }[] };
    expect(body.announcements.some((a) => a.id === announcementId)).toBe(true);
  });
});
