/**
 * 인기글 HTTP 라우트 — src/popularity-http.ts.
 *
 * 랭킹 공식·캐시·차단 필터링 자체는 tests/integration/popularity.test.ts가
 * 이미 검증한다. 여기선 라우팅 배선(쿼리 파싱, 상태 코드, 응답 형태)만 본다.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handlePopularityRoutes } from '../../src/popularity-http.ts';
import { ownerPool } from '../../src/db.ts';
import { closeRedis, redis } from '../../src/redis.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;
let CATEGORY: string;
let author: string;
let post: string;

async function cleanupTestData() {
  await owner.query(`DELETE FROM reactions WHERE target_id = ANY(SELECT id FROM posts WHERE title LIKE 'POPHTTP::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'POPHTTP::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'pophttp_%'`);
  const keys = await redis().keys(`popular:${CATEGORY}:*`);
  if (keys.length) await redis().del(...keys);
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handlePopularityRoutes(req, res)) return;
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
  // 🔒 'free'를 쓰면 tests/integration/popularity.test.ts와 같은 popular:{카테고리}:*
  // Redis 캐시 키를 공유해 vitest 병렬 워커에서 레이스가 난다(실측) — 다른
  // 카테고리를 써서 캐시 키 자체를 분리한다.
  CATEGORY = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'qna'`)).rows[0].id;
  await cleanupTestData();

  author = (await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('pophttp_author') RETURNING id`)).rows[0].id;
  post = (
    await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility, created_at) VALUES ($1, $2, 'POPHTTP::post', 'public', now()) RETURNING id`,
      [author, CATEGORY],
    )
  ).rows[0].id;
});

afterEach(async () => {
  const keys = await redis().keys(`popular:${CATEGORY}:*`);
  if (keys.length) await redis().del(...keys);
});

afterAll(async () => {
  await cleanupTestData();
  await owner?.end();
  await closeRedis();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/popularity', () => {
  it('세션 없이도 200 — 공개 랭킹, 콜드 스타트라도 즉시 계산해 응답한다', async () => {
    const res = await fetch(`${baseUrl}/api/popularity?categoryId=${CATEGORY}&window=7d&limit=5`);
    expect(res.status).toBe(200);
    const { posts } = await res.json();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.map((p: { id: string }) => p.id)).toContain(post);
  });

  it('categoryId 없이 호출하면 전역 랭킹', async () => {
    const res = await fetch(`${baseUrl}/api/popularity?window=7d`);
    expect(res.status).toBe(200);
    const { posts } = await res.json();
    expect(Array.isArray(posts)).toBe(true);
  });

  it('categoryId가 uuid 형식이 아니면 400', async () => {
    const res = await fetch(`${baseUrl}/api/popularity?categoryId=not-a-uuid`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });

  it('Set-Cookie가 없다 — 공개 GET, CDN 캐싱 전제(불변식 1)', async () => {
    const res = await fetch(`${baseUrl}/api/popularity`);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
