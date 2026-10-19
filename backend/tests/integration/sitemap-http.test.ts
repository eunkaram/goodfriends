/**
 * 사이트맵 데이터 라우트 — src/sitemap-http.ts. 이슈 #6.
 * app/sitemap.ts(web)가 fetch할 공개 GET — 인증 불필요, Set-Cookie 금지(불변식 1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleSitemapRoutes } from '../../src/sitemap-http.ts';
import { ownerPool } from '../../src/db.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let categorySlug: string;
let postId: string;
let publicId: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (await handleSitemapRoutes(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;

  owner = ownerPool();
  await owner.query(`DELETE FROM users WHERE username LIKE 'smhttp_%'`);
  const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('smhttp_alice') RETURNING id`);
  const authorId = u.rows[0].id;

  const cat = await owner.query<{ id: string; slug: string }>(`SELECT id, slug FROM categories WHERE type = 'community' LIMIT 1`);
  categorySlug = cat.rows[0].slug;

  const p = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'SITEMAP::entry', 'public') RETURNING id, public_id`,
    [authorId, cat.rows[0].id],
  );
  postId = p.rows[0].id;
  publicId = p.rows[0].public_id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM posts WHERE id = $1`, [postId]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'smhttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/sitemap-data', () => {
  it('세션 없이도 200 — 커뮤니티 글 목록을 반환한다', async () => {
    const res = await fetch(`${baseUrl}/api/sitemap-data`);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull(); // 불변식 1
    const body = (await res.json()) as { entries: { publicId: string; categorySlug: string; createdAt: string; updatedAt: string }[] };
    const entry = body.entries.find((e) => e.publicId === publicId);
    expect(entry).toBeDefined();
    expect(entry!.categorySlug).toBe(categorySlug);
    expect(typeof entry!.createdAt).toBe('string');
    expect(typeof entry!.updatedAt).toBe('string');
  });

  // 🔒 REGRESSION(이슈 #11) — updated_at이 없던 시절엔 lastModified가
  // created_at 고정이라 글을 수정해도 크롤러 재수집 신호가 안 바뀌었다.
  it('🔒 글을 수정하면 updatedAt이 createdAt보다 나중으로 갱신된다', async () => {
    await owner.query(`UPDATE posts SET title = 'SITEMAP::entry(수정됨)', updated_at = now() WHERE id = $1`, [postId]);
    const res = await fetch(`${baseUrl}/api/sitemap-data`);
    const body = (await res.json()) as { entries: { publicId: string; createdAt: string; updatedAt: string }[] };
    const entry = body.entries.find((e) => e.publicId === publicId);
    expect(entry).toBeDefined();
    expect(new Date(entry!.updatedAt).getTime()).toBeGreaterThan(new Date(entry!.createdAt).getTime());
  });
});
