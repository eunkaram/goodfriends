/**
 * 이미지 업로드 HTTP 라우트 — src/media-http.ts. 2026-10 버그 수정(프론트는
 * POST /api/media/upload를 부르는데 받는 백엔드가 없었다) — announcements-http.test.ts와
 * 같은 "라우팅 배선 + 왕복"만 확인하는 원칙.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleMediaRoutes } from '../../src/media-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';
import { MAX_UPLOAD_BYTES, saveUpload } from '../../src/media.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string;
let aliceToken: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

// 1x1 PNG(투명 픽셀) — 실제 이미지 바이트로 왕복을 검증한다.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleMediaRoutes(req, res)) return;
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
  await owner.query(`DELETE FROM users WHERE username LIKE 'mediahttp_%'`);
  const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('mediahttp_alice') RETURNING id`);
  alice = u.rows[0].id;
  aliceToken = (await createSession(alice)).token;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await owner?.query(`DELETE FROM media WHERE owner_id = $1`, [alice]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'mediahttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/media/upload', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: TINY_PNG,
    });
    expect(res.status).toBe(401);
  });

  it('업로드 성공 후 반환된 URL로 같은 바이트를 그대로 다시 받는다', async () => {
    const res = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', ...sessionCookieHeader(aliceToken) },
      body: TINY_PNG,
    });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\/media\/[0-9a-f-]{36}\.png$/);

    // 반환된 URL이 이 테스트 서버의 origin을 그대로 썼으니 경로만 바꿔 다시 요청한다.
    const path = new URL(url).pathname;
    const getRes = await fetch(`${baseUrl}${path}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('image/png');
    const roundTripped = Buffer.from(await getRes.arrayBuffer());
    expect(roundTripped.equals(TINY_PNG)).toBe(true);
  });

  it('허용되지 않은 mime 타입은 400', async () => {
    const res = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', ...sessionCookieHeader(aliceToken) },
      body: Buffer.from('not an image'),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_MIME' });
  });

  // 🔒 req.destroy()로 상한을 넘는 순간 소켓을 끊는 readBodyBuffer의 동작은
  // 실제 fetch 클라이언트 입장에선 "서버가 중간에 연결을 끊음"으로 보여
  // 깨끗한 413 응답 대신 네트워크 에러로 나타난다(undici가 그 차이를
  // 구분 안 함) — 라우트 배선이 아니라 saveUpload()의 경계값 자체를
  // 직접 호출해 확인한다(readBodyBuffer 쪽 끊기 동작은 별도 관심사).
  it('saveUpload — MAX_UPLOAD_BYTES를 넘는 버퍼는 TOO_LARGE', async () => {
    const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1);
    const result = await saveUpload(alice, 'image/png', tooBig, baseUrl);
    expect(result).toEqual({ ok: false, error: 'TOO_LARGE' });
  });
});

describe('GET /media/:key', () => {
  it('형식에 안 맞는 key(경로 조작 시도 포함)는 404', async () => {
    const res = await fetch(`${baseUrl}/media/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(404);
  });

  it('존재하지 않는 정상 형식 key도 404', async () => {
    const res = await fetch(`${baseUrl}/media/00000000-0000-0000-0000-000000000000.png`);
    expect(res.status).toBe(404);
  });
});
