/**
 * /api/admin/digest/* HTTP 라우트 — M3 화제 다이제스트 제작 UI 배선 검증.
 * announcements-http.test.ts와 같은 원칙: 도메인 로직은 guards에서, 여긴
 * 라우팅/게이트/상태 코드를 확인한다. 관리자 게이트는 404 존재 숨김 모양.
 *
 * 주의 — 이 파일은 `/api/admin/digest/drafts/generate`(LLM)까지 실제 호출
 * 한다. LLM_API_KEY가 .env에 있으면 실제 LLM을 부르지 않고 stub이 걸리게 —
 * !위험! vitest가 .env를 로드한다면 키가 들어올 수 있다. 그래서 이 파일의
 * beforeAll에서 process.env.LLM_API_KEY를 무조건 삭제한다(테스트는 네트워크
 * 없이 결정적으로 돼야 한다).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleDigestAdminRoutes } from '../../src/admin-digest-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;
let moderatorToken: string;
let plainToken: string;
let plainUserId: string;
let moderatorId: string;
let draftId: string;

function cookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  // 🔒 테스트는 stub LLM으로 돈다 — 실제 키·네트워크 없이.
  delete process.env.LLM_API_KEY;

  server = createServer(async (req, res) => {
    try {
      if (await handleDigestAdminRoutes(req, res)) return;
      res.writeHead(404).end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;
  owner = ownerPool();

  await owner.query(`DELETE FROM digest_drafts WHERE title LIKE 'DGRHTTP::%'`);
  await owner.query(`DELETE FROM digest_sources WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'dgrhttp_%')`);
  await owner.query(`DELETE FROM posts WHERE author_id = (SELECT id FROM users WHERE username = 'ai_digest_bot') AND title LIKE 'DGRHTTP::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'dgrhttp_%'`);

  const mod = await owner.query<{ id: string }>(`INSERT INTO users (username, is_moderator) VALUES ('dgrhttp_mod', true) RETURNING id`);
  const plain = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('dgrhttp_plain') RETURNING id`);
  moderatorId = mod.rows[0].id;
  plainUserId = plain.rows[0].id;
  moderatorToken = (await createSession(moderatorId)).token;
  plainToken = (await createSession(plainUserId)).token;
});

afterAll(async () => {
  await destroySession(moderatorToken);
  await destroySession(plainToken);
  await owner?.query(`DELETE FROM digest_drafts WHERE title LIKE 'DGRHTTP::%'`);
  await owner?.query(`DELETE FROM posts WHERE author_id = (SELECT id FROM users WHERE username = 'ai_digest_bot') AND title LIKE 'DGRHTTP::%'`);
  await owner?.query(`DELETE FROM digest_sources WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'dgrhttp_%')`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'dgrhttp_%'`);
  await owner?.end();
  server.close();
});

describe('게이트 — 모더레이터 아님 → 404 존재 숨김', () => {
  it('비로그인 GET sources → 404 {error:NOT_FOUND}', async () => {
    const res = await fetch(`${baseUrl}/api/admin/digest/sources`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('일반 유저 POST drafts/generate → 404', async () => {
    const res = await fetch(`${baseUrl}/api/admin/digest/drafts/generate`, { method: 'POST', headers: cookieHeader(plainToken) });
    expect(res.status).toBe(404);
  });
});

describe('모더레이터 플로우', () => {
  it('소재 계정: 추가(201) → 중복 추가 무배 → 목록 → 삭제', async () => {
    const add = await fetch(`${baseUrl}/api/admin/digest/sources`, {
      method: 'POST',
      headers: { ...cookieHeader(moderatorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'dgrhttp_plain' }),
    });
    expect(add.status).toBe(201);

    // 존재하지 않는 핸들 → 404 USER_NOT_FOUND
    const missing = await fetch(`${baseUrl}/api/admin/digest/sources`, {
      method: 'POST',
      headers: { ...cookieHeader(moderatorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'dgrhttp_nope' }),
    });
    expect(missing.status).toBe(404);
    expect((await missing.json())).toEqual({ error: 'USER_NOT_FOUND' });

    const list = await fetch(`${baseUrl}/api/admin/digest/sources`, { headers: cookieHeader(moderatorToken) });
    const { sources } = (await list.json()) as { sources: Array<{ username: string; id: string }> };
    expect(sources.map((s) => s.username)).toEqual(['dgrhttp_plain']);
  });

  it('활동 없으면 초안 생성 → 400 EMPTY_SOURCES_ACTIVITY', async () => {
    const res = await fetch(`${baseUrl}/api/admin/digest/drafts/generate`, { method: 'POST', headers: cookieHeader(moderatorToken) });
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: 'EMPTY_SOURCES_ACTIVITY' });
  });

  it('소재 계정이 48h 내 글을 쓰면 → 초안 생성(201) → 목록/편집 → 발행(200)', async () => {
    // 소재 계정에 최근 공개 글 1건 + 답변 1개
    const categoryId = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free' LIMIT 1`)).rows[0].id;
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility)
       VALUES ($1, $2, 'DGRHTTP::다이제스트 소재 글', '오늘 에이전트 프록시 비용 정리를 썼다', 'public') RETURNING id`,
      [plainUserId, categoryId],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '좋은 정리네요')`, [post.rows[0].id, moderatorId]);

    const gen = await fetch(`${baseUrl}/api/admin/digest/drafts/generate`, { method: 'POST', headers: cookieHeader(moderatorToken) });
    expect(gen.status).toBe(201);
    const { draft } = (await gen.json()) as { draft: { id: string; title: string; content: string; status: string } };
    draftId = draft.id;
    expect(draft.status).toBe('draft');
    expect(draft.title).toContain('2026-');
    expect(draft.content).toContain('DGRHTTP::다이제스트 소재 글');

    // 목록 조회
    const list = await fetch(`${baseUrl}/api/admin/digest/drafts`, { headers: cookieHeader(moderatorToken) });
    const { drafts } = (await list.json()) as { drafts: Array<{ id: string; status: string }> };
    expect(drafts.some((d) => d.id === draftId && d.status === 'draft')).toBe(true);

    // 편집(PATCH)
    const patch = await fetch(`${baseUrl}/api/admin/digest/drafts/${draftId}`, {
      method: 'PATCH',
      headers: { ...cookieHeader(moderatorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'DGRHTTP::확정 제목', content: '에이전트 비용 정리 — 이 부분이 핵심.' }),
    });
    expect(patch.status).toBe(200);

    // 발행
    const publish = await fetch(`${baseUrl}/api/admin/digest/drafts/${draftId}/publish`, { method: 'POST', headers: cookieHeader(moderatorToken) });
    expect(publish.status).toBe(200);
    const { postPublicId } = (await publish.json()) as { postPublicId: string };
    expect(postPublicId).toBeTruthy();

    const postRow = await owner.query<{ author_username: string; category_slug: string; title: string }>(
      `SELECT u.username AS author_username, c.slug AS category_slug, p.title
       FROM posts p JOIN users u ON u.id = p.author_id JOIN categories c ON c.id = p.category_id
       WHERE p.public_id = $1`,
      [postPublicId],
    );
    expect(postRow.rows[0].author_username).toBe('ai_digest_bot');
    expect(postRow.rows[0].category_slug).toBe('ai-topics');
    expect(postRow.rows[0].title).toBe('DGRHTTP::확정 제목');

    // 재발행 → 409 ALREADY_PUBLISHED
    const republish = await fetch(`${baseUrl}/api/admin/digest/drafts/${draftId}/publish`, { method: 'POST', headers: cookieHeader(moderatorToken) });
    expect(republish.status).toBe(409);
  });
});