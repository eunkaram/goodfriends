/**
 * M2 — 새 HTTP 라우트 통합 테스트: 공개 검색(/api/posts/search), Q&A 채택
 * (PATCH /api/posts/:public_id/adoption), 조회수(views), 시리즈(/api/series*).
 * posts-http + series-http를 그대로 감싼 최소 서버(posts-and-feed.test와 같은 패턴).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handlePostsRoutes } from '../../src/posts-http.ts';
import { handleSeriesRoutes } from '../../src/series-http.ts';
import { handleSearchRoutes } from '../../src/search-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';
import { closeRedis } from '../../src/redis.ts';
import type pg from 'pg';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let authorId: string;
let answererId: string;
let authorToken: string;

let qnaPostId: string;
let qnaPostPublicId: string;
let freePostPublicId: string;
let freePostId: string;
let answerCommentId: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleSearchRoutes(req, res)) return;
      if (await handlePostsRoutes(req, res)) return;
      if (await handleSeriesRoutes(req, res)) return;
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
  await owner.query(`DELETE FROM series WHERE owner_id IN (SELECT id FROM users WHERE username LIKE 'm2api_%')`);
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'M2API::%')`);
  await owner.query(`DELETE FROM reactions WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'M2API::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'M2API::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'm2api_%'`);

  const cats = await owner.query<{ id: string; slug: string }>(`SELECT id, slug FROM categories WHERE slug IN ('qna', 'free')`);
  const qnaCat = cats.rows.find((r) => r.slug === 'qna')!.id;
  const freeCat = cats.rows.find((r) => r.slug === 'free')!.id;

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('m2api_author'), ('m2api_answerer') RETURNING id, username`,
  );
  authorId = u.rows.find((r) => r.username === 'm2api_author')!.id;
  answererId = u.rows.find((r) => r.username === 'm2api_answerer')!.id;

  const p = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'M2API::타입스크립트 초보질문', 'public') RETURNING id, public_id`,
    [authorId, qnaCat],
  );
  qnaPostId = p.rows[0].id;
  qnaPostPublicId = p.rows[0].public_id;

  const p2 = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'M2API::자유글 대표예제', 'public') RETURNING id, public_id`,
    [authorId, freeCat],
  );
  freePostId = p2.rows[0].id;
  freePostPublicId = p2.rows[0].public_id;

  const c = await owner.query<{ id: string }>(
    `INSERT INTO comments (target_type, target_id, author_id, body, parent_comment_id) VALUES ('post', $1, $2, '답변입니다', NULL) RETURNING id`,
    [qnaPostId, answererId],
  );
  answerCommentId = c.rows[0].id;

  authorToken = (await createSession(authorId)).token;
});

afterAll(async () => {
  await destroySession(authorToken);
  await owner?.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'm2api_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'm2api_%')`,
  );
  await owner?.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'M2API::%')`);
  await owner?.query(`DELETE FROM series WHERE owner_id IN (SELECT id FROM users WHERE username LIKE 'm2api_%')`);
  await owner?.query(`DELETE FROM reactions WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'M2API::%')`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'M2API::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'm2api_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRedis();
});

describe('GET /api/posts/search — 공개 검색', () => {
  it('제목 prefix로 홈 게이트 내 공개 글을 찾는다', async () => {
    const res = await fetch(`${baseUrl}/api/posts/search?q=M2API::타입스크립트`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { publicId: string; title: string }[] };
    expect(body.posts.map((p) => p.publicId)).toContain(qnaPostPublicId);
    // needle이 빠져 있으면 안 찾는다(단순 문자열 prefix 검색)
    const none = await fetch(`${baseUrl}/api/posts/search?q=없는것`);
    expect(((await none.json()) as { posts: unknown[] }).posts).toHaveLength(0);
  });

  it('빈 검색어는 200 + 빈 배열(전체목록 노출 금지)', async () => {
    const res = await fetch(`${baseUrl}/api/posts/search?q=`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { posts: unknown[] }).posts).toHaveLength(0);
  });

  it('category로 한정 검색', async () => {
    const res = await fetch(`${baseUrl}/api/posts/search?q=M2API::자유&category=free`);
    expect(res.status).toBe(200);
    const posts = (await res.json()) as { posts: { publicId: string }[] };
    expect(posts.posts.map((p) => p.publicId)).toContain(freePostPublicId);
    expect(posts.posts.map((p) => p.publicId)).not.toContain(qnaPostPublicId);
  });
});

describe('GET /api/search — 제목/본문 통합 검색', () => {
  it('제목/본문 결과를 하나의 posts 목록으로 반환하고 댓글 필드는 없다', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=M2API`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      posts: { items: { publicId: string }[]; hasMore: boolean; nextOffset: number | null };
    };
    expect(body.posts.items.map((p) => p.publicId)).toEqual(expect.arrayContaining([qnaPostPublicId, freePostPublicId]));
    expect(body).not.toHaveProperty('title');
    expect(body).not.toHaveProperty('body');
    expect(body).not.toHaveProperty('comments');
  });

  it('2자 미만은 빈 목록을 200으로 돌려준다', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=M`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { items: unknown[] } };
    expect(body.posts.items).toHaveLength(0);
  });

  it('limit으로 hasMore를 계산한다', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=M2API&limit=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { items: unknown[]; hasMore: boolean; nextOffset: number | null } };
    expect(body.posts.items).toHaveLength(1);
    expect(body.posts.hasMore).toBe(true);
    expect(body.posts.nextOffset).toBe(1);
  });
});

describe('PATCH /api/posts/:id/adoption — Q&A 채택', () => {
  it('작성자가 자기 글 답변을 채택한다(외부 식별자 public_id 경유)', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${qnaPostPublicId}/adoption`, {
      method: 'PATCH',
      headers: sessionCookieHeader(authorToken),
      body: JSON.stringify({ commentId: answerCommentId }),
    });
    expect(res.status).toBe(200);
    const row = await owner.query(`SELECT adopted_comment_id FROM posts WHERE id = $1`, [qnaPostId]);
    expect(row.rows[0].adopted_comment_id).toBe(answerCommentId);
  });

  it('채택 해제 — commentId:null', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${qnaPostPublicId}/adoption`, {
      method: 'PATCH',
      headers: sessionCookieHeader(authorToken),
      body: JSON.stringify({ commentId: null }),
    });
    expect(res.status).toBe(200);
    const row = await owner.query(`SELECT adopted_comment_id FROM posts WHERE id = $1`, [qnaPostId]);
    expect(row.rows[0].adopted_comment_id).toBeNull();
  });

  it('로그인 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${qnaPostPublicId}/adoption`, {
      method: 'PATCH',
      body: JSON.stringify({ commentId: answerCommentId }),
    });
    expect(res.status).toBe(401);
  });

  it('🔒 자유게시판 글은 invalid — 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${freePostPublicId}/adoption`, {
      method: 'PATCH',
      headers: sessionCookieHeader(authorToken),
      body: JSON.stringify({ commentId: answerCommentId }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
  });
});

describe('조회수 — GET 상세에서 views 증가', () => {
  it('같은 세션은 24시간에 1번만 증가, 작성자 본인은 세지 않는다', async () => {
    const fresh = await owner.query(`UPDATE posts SET views = 0 WHERE id = $1 RETURNING views`, [qnaPostId]);
    expect(Number(fresh.rows[0].views)).toBe(0);

    // 던전: 작성자가 보면 안 는다
    const authorView = await fetch(`${baseUrl}/api/posts/${qnaPostPublicId}`, { headers: sessionCookieHeader(authorToken) });
    expect(authorView.status).toBe(200);
    let row = await owner.query(`SELECT views FROM posts WHERE id = $1`, [qnaPostId]);
    expect(Number(row.rows[0].views)).toBe(0);

    // 던전: 다른 사람(세션 없는 익명, 같은 IP) 서는 첫 조회에서 +1 — dedup 키는 per-IP이므로
    // 이 유닛에선 "증가"와 "멱등" 두 성질 중 증가를 확인한다(dedup은 Redis NX로 파일 전역 공유).
    const anonView = await fetch(`${baseUrl}/api/posts/${freePostPublicId}`);
    expect(anonView.status).toBe(200);
    const after = await fetch(`${baseUrl}/api/posts/${freePostPublicId}`);
    expect(after.status).toBe(200);
    row = await owner.query(`SELECT views FROM posts WHERE id = $1`, [freePostId]);
    // dedup이 잘 동작하면 1(같은 IP+24h내 2번째 GET) — Redis NX 특성상 1 초과하게 안 된다.
    expect(Number(row.rows[0].views)).toBe(1);
  });
});

describe('시리즈 HTTP 라우트', () => {
  it('생성 → 담기 → 공개 상세 조회', async () => {
    const create = await fetch(`${baseUrl}/api/series`, {
      method: 'POST',
      headers: sessionCookieHeader(authorToken),
      body: JSON.stringify({ title: '타입스크립트 하루카페 연재', description: '3부작 연재' }),
    });
    expect(create.status).toBe(201);
    const { series } = (await create.json()) as { series: { id: string } };

    const attach = await fetch(`${baseUrl}/api/series/${series.id}/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(authorToken),
      body: JSON.stringify({ postId: freePostPublicId }), // public_id도 resolve 한다
    });
    expect(attach.status).toBe(200);

    const detail = await fetch(`${baseUrl}/api/series/${series.id}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { series: { title: string; postCount: number }; posts: { id: string }[] };
    expect(body.series.title).toBe('타입스크립트 하루카페 연재');
    expect(body.series.postCount).toBe(1);
    expect(body.posts).toHaveLength(1);
  });

  it('username 없는 공개 목록 — 생성한 게 보인다', async () => {
    const res = await fetch(`${baseUrl}/api/series?username=m2api_author`);
    expect(res.status).toBe(200);
    const { series } = (await res.json()) as { series: { title: string }[] };
    expect(series.some((s) => s.title === '타입스크립트 하루카페 연재')).toBe(true);
  });

  it('로그인 없이 생성은 401', async () => {
    const res = await fetch(`${baseUrl}/api/series`, {
      method: 'POST',
      body: JSON.stringify({ title: '무단 연재' }),
    });
    expect(res.status).toBe(401);
  });
});
