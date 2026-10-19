/**
 * 엔트리포인트 자체 라우팅(CORS·404) — src/server.ts. 이슈 없음, 실전 발견
 * (2026-09-04, 프론트/백엔드 분리 후 CORS 미설정으로 브라우저 크로스오리진
 * 요청이 막히는 문제) 회귀 검증.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handleRequest } from '../../src/server.ts';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('CORS', () => {
  it('허용된 오리진(APP_BASE_URL)에서 온 요청엔 Access-Control-Allow-Origin/Credentials가 붙는다', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { headers: { Origin: process.env.APP_BASE_URL! } });
    expect(res.headers.get('access-control-allow-origin')).toBe(process.env.APP_BASE_URL);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('허용되지 않은 오리진에서 온 요청엔 CORS 헤더가 안 붙는다', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('OPTIONS 프리플라이트는 204 + 허용 메서드/헤더로 응답한다', async () => {
    const res = await fetch(`${baseUrl}/api/messages/unread`, {
      method: 'OPTIONS',
      headers: { Origin: process.env.APP_BASE_URL!, 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(process.env.APP_BASE_URL);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });
});

describe('404 폴백', () => {
  it('아무 라우트도 못 잡은 요청은 JSON 404를 낸다', async () => {
    const res = await fetch(`${baseUrl}/api/definitely-not-a-real-route`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });
});
