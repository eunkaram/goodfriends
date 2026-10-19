/**
 * 구독 HTTP 라우트 — src/categories-http.ts.
 *
 * 🔒 /review 발견(testing) — src/categories.ts의 subscribe/unsubscribe 자체는
 * tests/guards/categories.test.ts가 이미 검증하지만, 라우팅 배선(세션 체크,
 * 상태 코드, 요청 바디 파싱)은 별개 레이어라 따로 확인해야 한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleCategoriesRoutes } from '../../src/categories-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string;
let aliceToken: string;
let categoryId: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleCategoriesRoutes(req, res)) return;
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
  await owner.query(`DELETE FROM users WHERE username LIKE 'subhttp_%'`);

  const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('subhttp_alice') RETURNING id`);
  alice = u.rows[0].id;
  aliceToken = (await createSession(alice)).token;

  const cat = await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`);
  categoryId = cat.rows[0].id;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await owner?.query(`DELETE FROM subscriptions WHERE user_id = $1`, [alice]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'subhttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/subscriptions', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, { method: 'POST', body: JSON.stringify({ categoryId }) });
    expect(res.status).toBe(401);
  });

  it('세션 있으면 200 — DB에도 구독 행이 생긴다', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = await owner.query(`SELECT 1 FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [alice, categoryId]);
    expect(row.rowCount).toBe(1);
  });

  it('이미 구독 중이어도 에러 없이 200(멱등)', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId }),
    });
    expect(res.status).toBe(200);
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  it('Authorization: Bearer 헤더만으로도(쿠키 없이) 200 — DB에도 구독 행이 생긴다', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ categoryId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = await owner.query(`SELECT 1 FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [alice, categoryId]);
    expect(row.rowCount).toBe(1);
  });
});

describe('DELETE /api/subscriptions', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, { method: 'DELETE', body: JSON.stringify({ categoryId }) });
    expect(res.status).toBe(401);
  });

  it('구독 중이면 삭제되고 DB에서도 사라진다', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'DELETE',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId }),
    });
    expect(res.status).toBe(200);

    const row = await owner.query(`SELECT 1 FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [alice, categoryId]);
    expect(row.rowCount).toBe(0);
  });

  it('애초에 구독 중이 아니어도 에러 없이 200(멱등)', async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'DELETE',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId }),
    });
    expect(res.status).toBe(200);
  });
});

// GitHub #7 — 메가메뉴(계층형 트리)+비로그인 좌내비(인기 카테고리)가 SSR 직접 호출뿐이었다.
describe('GET /api/categories/tree', () => {
  it('비로그인도 200 — tree/popular 둘 다 온다', async () => {
    const res = await fetch(`${baseUrl}/api/categories/tree`);
    expect(res.status).toBe(200);
    const { tree, popular } = await res.json();
    expect(Array.isArray(tree)).toBe(true);
    expect(Array.isArray(popular)).toBe(true);
    expect(tree.length).toBeGreaterThan(0);
    const group = tree.find((g: { children: { slug: string }[] }) => g.children.some((c) => c.slug === 'free'));
    expect(group).toBeTruthy();
    expect(Array.isArray(group.children)).toBe(true);
  });

  it('popularLimit 쿼리로 개수가 제한된다', async () => {
    const res = await fetch(`${baseUrl}/api/categories/tree?popularLimit=1`);
    const { popular } = await res.json();
    expect(popular.length).toBe(1);
  });

  it('Set-Cookie가 없다 — 공개 GET, CDN 캐싱 전제(불변식 1)', async () => {
    const res = await fetch(`${baseUrl}/api/categories/tree`);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

// GitHub #2 — 모바일 피드 필터·글쓰기 카테고리 선택·구독 관리용 목록 API가 없었다.
describe('GET /api/categories', () => {
  it('비로그인도 200 — isSubscribed 필드 없이 카테고리 목록만', async () => {
    const res = await fetch(`${baseUrl}/api/categories`);
    expect(res.status).toBe(200);
    const { categories } = await res.json();
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBeGreaterThan(0);
    const chat = categories.find((c: { slug: string }) => c.slug === 'free');
    expect(chat).toMatchObject({ id: categoryId, slug: 'free' });
    expect(chat.name).toBeTruthy();
    expect(chat.isSubscribed).toBeUndefined();
  });

  it('로그인 상태면 isSubscribed가 실제 구독 여부를 정확히 반영한다', async () => {
    // 구독 전 — false
    const before = await fetch(`${baseUrl}/api/categories`, { headers: sessionCookieHeader(aliceToken) });
    const { categories: beforeList } = await before.json();
    expect(beforeList.find((c: { slug: string }) => c.slug === 'free').isSubscribed).toBe(false);

    await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId }),
    });

    // 구독 후 — true, 다른 카테고리는 여전히 false
    const after = await fetch(`${baseUrl}/api/categories`, { headers: sessionCookieHeader(aliceToken) });
    const { categories: afterList } = await after.json();
    const chat = afterList.find((c: { slug: string }) => c.slug === 'free');
    expect(chat.isSubscribed).toBe(true);
    const others = afterList.filter((c: { slug: string }) => c.slug !== 'free');
    expect(others.every((c: { isSubscribed: boolean }) => c.isSubscribed === false)).toBe(true);

    await fetch(`${baseUrl}/api/subscriptions`, {
      method: 'DELETE',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId }),
    });
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  it('Authorization: Bearer 헤더로도 동일하게 동작', async () => {
    const res = await fetch(`${baseUrl}/api/categories`, { headers: { Authorization: `Bearer ${aliceToken}` } });
    expect(res.status).toBe(200);
    const { categories } = await res.json();
    expect(categories.find((c: { slug: string }) => c.slug === 'free').isSubscribed).toBe(false);
  });
});
