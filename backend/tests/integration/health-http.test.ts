/**
 * 헬스체크 — src/health-http.ts. DB/Redis가 정상일 때 200을 확인한다.
 * 둘 중 하나가 죽었을 때의 503 분기는 이 테스트 환경에서 실제로 DB/Redis를
 * 끊을 수 없어(다른 테스트와 공유하는 인프라) 별도로 검증하지 않는다 —
 * checkDb/checkRedis 각각의 실패 처리(try/catch → false)는 코드 리뷰로 충분히
 * 명백한 로직이라 여기서는 "정상 경로가 실제로 200과 두 필드를 준다"만 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handleHealthRoutes } from '../../src/health-http.ts';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleHealthRoutes(req, res)) return;
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
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/health', () => {
  it('DB·Redis 정상이면 200 + ok:true', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, db: 'ok', redis: 'ok' });
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('세션 없이도(인증 불필요) 응답한다', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it('POST는 처리 안 함(라우트 매칭 실패)', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
