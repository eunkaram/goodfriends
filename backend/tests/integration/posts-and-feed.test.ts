/**
 * 글쓰기 · 홈 피드 통합 테스트 — §6.2, §5.1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handlePostsRoutes } from '../../src/posts-http.ts';
import { fetchHomeFeed, fetchForYouFeed, fetchCategoryFeed, fetchSavedPosts, unsavePost, fetchPostsCommentedByUser, fetchMediaPostsForLog, fetchHomeFeedForLog } from '../../src/feed.ts';
import { makeImageMarker } from '../../src/link-detect.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';
import type pg from 'pg';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string;
let bob: string; // alice가 팔로우
let carol: string; // 무관계
let moderator: string; // is_moderator=true — News 작성 허용 대상
let agent: string; // is_agent=true(뉴스봇 등 시스템 계정) — News 작성 허용 대상
let dailyChatId: string;
let advicetId: string;
let newsId: string;
let aliceToken: string;
let bobToken: string;
let carolToken: string;
let moderatorToken: string;
let agentToken: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handlePostsRoutes(req, res)) return;
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
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'FEED::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'FEED::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'feedtest_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('feedtest_alice'), ('feedtest_bob'), ('feedtest_carol') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'feedtest_alice')!.id;
  bob = u.rows.find((r) => r.username === 'feedtest_bob')!.id;
  carol = u.rows.find((r) => r.username === 'feedtest_carol')!.id;

  const roleUsers = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username, is_moderator, is_agent) VALUES
       ('feedtest_mod', true, false),
       ('feedtest_agent', false, true)
     RETURNING id, username`,
  );
  moderator = roleUsers.rows.find((r) => r.username === 'feedtest_mod')!.id;
  agent = roleUsers.rows.find((r) => r.username === 'feedtest_agent')!.id;

  const cats = await owner.query<{ id: string; slug: string }>(`SELECT id, slug FROM categories WHERE slug IN ('free', 'qna', 'news')`);
  dailyChatId = cats.rows.find((r) => r.slug === 'free')!.id;
  advicetId = cats.rows.find((r) => r.slug === 'qna')!.id;
  newsId = cats.rows.find((r) => r.slug === 'news')!.id;

  await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [alice, bob]);

  aliceToken = (await createSession(alice)).token;
  bobToken = (await createSession(bob)).token;
  carolToken = (await createSession(carol)).token;
  moderatorToken = (await createSession(moderator)).token;
  agentToken = (await createSession(agent)).token;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await destroySession(bobToken);
  await destroySession(carolToken);
  await destroySession(moderatorToken);
  await destroySession(agentToken);
  await owner?.query(`DELETE FROM follows WHERE follower_id = $1`, [alice]);
  await owner?.query(`DELETE FROM reactions WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'FEED::%')`);
  await owner?.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'FEED::%')`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'FEED::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'feedtest_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/posts — 커뮤니티 글 작성 (§6.2)', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::no session', body: '본문' }),
    });
    expect(res.status).toBe(401);
  });

  it('로그인 상태면 글이 만들어지고 visibility가 public으로 강제된다(§5.2)', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::alice post', body: '본문 내용' }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = await owner.query(`SELECT visibility, author_id FROM posts WHERE id = $1`, [id]);
    expect(row.rows[0].visibility).toBe('public');
    expect(row.rows[0].author_id).toBe(alice);
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  it('Authorization: Bearer 헤더만으로도(쿠키 없이) 글이 만들어진다', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::alice post via bearer', body: '본문 내용' }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = await owner.query(`SELECT author_id FROM posts WHERE id = $1`, [id]);
    expect(row.rows[0].author_id).toBe(alice);
  });

  it('제목이 없으면 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: '', body: '본문' }),
    });
    expect(res.status).toBe(400);
  });

  // 🔒 사용자 발견(2026-08, "글쓰기시에 내용을 줄바꿈만 넣어도 저장이 돼.
  // 글자수를 체크하는 로직을 추가해") — 줄바꿈만 있는 본문은 trim()으로
  // 빈 문자열이 된다.
  it('본문이 줄바꿈만 있으면 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::empty body', body: '\n\n\n' }),
    });
    expect(res.status).toBe(400);
  });

  // 🔒 사용자 지시(2026-10, "news메뉴는 시스템또는 어드민만 올릴수 있게...
  // 일반 유저는 읽기/댓글만") — moderation.ts isModeratorOrAgent().
  it('News 카테고리는 일반 유저가 쓰면 403', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: newsId, title: 'FEED::news by regular user', body: '본문' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('News 카테고리는 모더레이터가 쓸 수 있다', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(moderatorToken),
      body: JSON.stringify({ categoryId: newsId, title: 'FEED::news by moderator', body: '본문' }),
    });
    expect(res.status).toBe(201);
  });

  it('News 카테고리는 시스템 계정(is_agent)이 쓸 수 있다 — 뉴스봇과 같은 권한', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(agentToken),
      body: JSON.stringify({ categoryId: newsId, title: 'FEED::news by agent', body: '본문' }),
    });
    expect(res.status).toBe(201);
  });
});

// 🔒 모바일 API 레퍼런스 작성 중 발견한 공백(2026-08-29) — 웹은 이 화면을
// app/[category]/[publicId]/page.tsx의 SSR로 메우고 있어서, JSON으로 글
// 상세+댓글을 돌려주는 엔드포인트가 지금까지 아예 없었다.
describe('GET /api/posts/:publicId — 글 상세 + 댓글 (신규, 모바일용)', () => {
  let publicId: string;

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::detail target', body: '상세 조회 대상' }),
    });
    ({ publicId } = await res.json());
    await fetch(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: sessionCookieHeader(bobToken),
      body: JSON.stringify({ postId: publicId, body: 'FEED::detail comment' }),
    });
  });

  it('존재하는 글이면 post+comments를 함께 돌려준다', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${publicId}`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.publicId).toBe(publicId);
    expect(body.post.title).toBe('FEED::detail target');
    // 🔒 news 제외 카테고리는 ai_bot이 첫 댓글을 자동으로 단다(post-bot-comment.ts,
    // 2026-10-26) — 'free' 카테고리라 여기도 해당. bob의 댓글 하나 + 봇 댓글 하나.
    expect(body.comments).toHaveLength(2);
    expect(body.comments.map((c: { body: string }) => c.body)).toContain('FEED::detail comment');
  });

  it('존재하지 않는 publicId는 404', async () => {
    const res = await fetch(`${baseUrl}/api/posts/does-not-exist`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(404);
  });

  it('비로그인도 공개 글은 볼 수 있다(§4.3) — myReaction은 null', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${publicId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.myReaction).toBeNull();
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  it('Authorization: Bearer 헤더로도 동일하게 동작', async () => {
    const res = await fetch(`${baseUrl}/api/posts/${publicId}`, { headers: { Authorization: `Bearer ${aliceToken}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.publicId).toBe(publicId);
  });
});

// 🔒 사용자 지시(2026-08, "Post Option을 넣어야 할것 같아... 내로그에만 쓴
// 글일경우 읽기 권한을 전체, follower 설정") — categoryId가 없으면 로그
// 전용 글. 🔒 실전 버그(curl E2E 중 발견) — user_logs는 id 컬럼이 없는
// 테이블이라(user_id가 PK 자체) `SELECT id FROM user_logs`가 매번
// 42703(column "id" does not exist)로 500을 냈다 — log_id는 그냥 userId
// 그 자체다(albums.ts와 같은 패턴). 아래 테스트가 이 회귀를 고정한다.
describe('POST /api/posts — 로그 전용 글 작성 (categoryId 없음)', () => {
  it('category_id는 NULL, log_id는 작성자 본인, visibility는 지정한 값 그대로 저장된다', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ title: 'FEED::log only followers', body: '팔로워 전용', visibility: 'followers' }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = await owner.query(`SELECT category_id, log_id, visibility, author_id FROM posts WHERE id = $1`, [id]);
    expect(row.rows[0].category_id).toBeNull();
    expect(row.rows[0].log_id).toBe(alice);
    expect(row.rows[0].visibility).toBe('followers');
    expect(row.rows[0].author_id).toBe(alice);
  });

  it('visibility가 public/followers가 아니면 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ title: 'FEED::log bad visibility', body: '본문', visibility: 'friends' }),
    });
    expect(res.status).toBe(400);
  });

  // 🔒 사용자 발견(2026-08, "글쓰기시에 내용을 줄바꿈만 넣어도 저장이 돼.
  // 글자수를 체크하는 로직을 추가해") — 로그 전용 글도 게시판 글과 같은
  // 본문 필수 체크를 받는다.
  it('본문이 줄바꿈만 있으면 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ title: 'FEED::log empty body', body: '\n\n\n', visibility: 'public' }),
    });
    expect(res.status).toBe(400);
  });

  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      body: JSON.stringify({ title: 'FEED::log no session', body: '본문', visibility: 'public' }),
    });
    expect(res.status).toBe(401);
  });
});

// 🔒 §11.9.2와 같은 원칙 — 0029 마이그레이션의 `app_is_followed_by()` RLS 분기가
// 실제로 걸리는지. beforeAll에서 alice가 bob을 팔로우해뒀다(alice→bob).
describe('followers 공개범위 RLS — fetchHomeFeedForLog (0029)', () => {
  it('팔로워는 볼 수 있고, 무관계인 사람은 못 본다, 작성자 본인은 항상 본다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, body, visibility) VALUES ($1, $1, 'FEED::followers only', '본문', 'followers') RETURNING id`,
      [bob],
    );
    const postId = post.rows[0].id;

    // alice는 bob을 팔로우한다 — 보여야 한다
    const asFollower = await fetchHomeFeedForLog(alice, bob, 20, 0);
    expect(asFollower.some((p) => p.id === postId)).toBe(true);

    // carol은 bob과 무관계 — 안 보여야 한다
    const asStranger = await fetchHomeFeedForLog(carol, bob, 20, 0);
    expect(asStranger.some((p) => p.id === postId)).toBe(false);

    // bob 본인은 항상 본다
    const asAuthor = await fetchHomeFeedForLog(bob, bob, 20, 0);
    expect(asAuthor.some((p) => p.id === postId)).toBe(true);

    // 비로그인은 로그 전용 글 자체를 못 본다(§4.3, HOME_GATE와 별개로 이 함수도 RLS를 그대로 통과)
    const asAnon = await fetchHomeFeedForLog(null, bob, 20, 0);
    expect(asAnon.some((p) => p.id === postId)).toBe(false);
  });
});

// 🔒 사용자 발견(2026-08) — "내 글삭제는 어떻게해? 기능이 빠져있는것 같아"
describe('DELETE /api/posts/:id — 글 삭제', () => {
  it('세션 없이는 401', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::delete no session', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('형식이 깨진 id면 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts/not-a-uuid`, { method: 'DELETE', headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(400);
  });

  it('본인 글이 아니면 404 — RLS가 0행 삭제로 막고, 라우트는 사유를 구분해 알려주지 않는다(§10.2)', async () => {
    const carolPost = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::delete not owner', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${carolPost.rows[0].id}`, { method: 'DELETE', headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(404);
    const row = await owner.query(`SELECT id FROM posts WHERE id = $1`, [carolPost.rows[0].id]);
    expect(row.rows).toHaveLength(1); // 안 지워졌다
  });

  it('본인 글이면 삭제되고, 딸린 댓글·반응도 같이 지워진다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::delete own post', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const postId = post.rows[0].id;
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'nice')`, [postId, alice]);
    await owner.query(`INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('post', $1, $2, 'helpful')`, [
      postId,
      alice,
    ]);

    const res = await fetch(`${baseUrl}/api/posts/${postId}`, { method: 'DELETE', headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);

    const postRow = await owner.query(`SELECT id FROM posts WHERE id = $1`, [postId]);
    expect(postRow.rows).toHaveLength(0);
    const commentRow = await owner.query(`SELECT id FROM comments WHERE target_type = 'post' AND target_id = $1`, [postId]);
    expect(commentRow.rows).toHaveLength(0);
    const reactionRow = await owner.query(`SELECT id FROM reactions WHERE target_type = 'post' AND target_id = $1`, [postId]);
    expect(reactionRow.rows).toHaveLength(0);
  });

  it('존재하지 않는 글이면 404', async () => {
    const res = await fetch(`${baseUrl}/api/posts/00000000-0000-0000-0000-0000000000ff`, {
      method: 'DELETE',
      headers: sessionCookieHeader(aliceToken),
    });
    expect(res.status).toBe(404);
  });

  // 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을 처리하는데
  // 계속 에러가 뜬다") — 글 URL이 public_id(0038)로 바뀐 뒤로 외부 호출자가
  // 아는 유일한 글 식별자가 이것뿐이다. :id에 public_id를 넣어도 내부 id로
  // 해석돼 정상 동작해야 한다.
  it('경로 :id에 public_id를 넣어도 내부 id로 해석돼 삭제된다', async () => {
    const post = await owner.query<{ id: string; public_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::delete via public_id', 'public') RETURNING id, public_id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].public_id}`, { method: 'DELETE', headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const row = await owner.query(`SELECT id FROM posts WHERE id = $1`, [post.rows[0].id]);
    expect(row.rows).toHaveLength(0);
  });
});

// 🔒 사용자 발견(2026-08) — "내글에 대해 수정기능이 없어. 수정할수 있게 만들어줘"
describe('PATCH /api/posts/:id — 글 수정', () => {
  it('세션 없이는 401', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::update no session', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: dailyChatId, title: '수정 시도', body: '' }),
    });
    expect(res.status).toBe(401);
  });

  it('형식이 깨진 id면 400', async () => {
    const res = await fetch(`${baseUrl}/api/posts/not-a-uuid`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: '수정', body: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('categoryId 형식이 깨지면 400(불변식 19)', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::update bad category', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: 'not-a-uuid', title: '수정', body: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('본인 글이 아니면 404 — RLS가 0행 갱신으로 막고, 라우트는 사유를 구분해 알려주지 않는다(§10.2)', async () => {
    const carolPost = await owner.query<{ id: string; title: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::update not owner', 'public') RETURNING id, title`,
      [carol, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${carolPost.rows[0].id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::hijacked', body: '탈취 시도' }),
    });
    expect(res.status).toBe(404);
    const row = await owner.query(`SELECT title FROM posts WHERE id = $1`, [carolPost.rows[0].id]);
    expect(row.rows[0].title).toBe(carolPost.rows[0].title); // 안 바뀌었다
  });

  it('본인 글이면 제목·본문·카테고리가 갱신된다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::update own post', '원본 본문', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const postId = post.rows[0].id;

    const res = await fetch(`${baseUrl}/api/posts/${postId}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: advicetId, title: 'FEED::update own post 수정됨', body: '수정된 본문' }),
    });
    expect(res.status).toBe(200);

    const row = await owner.query(`SELECT title, body, category_id FROM posts WHERE id = $1`, [postId]);
    expect(row.rows[0].title).toBe('FEED::update own post 수정됨');
    expect(row.rows[0].body).toBe('수정된 본문');
    expect(row.rows[0].category_id).toBe(advicetId);
  });

  it('마켓 카테고리로는 바꿀 수 없다(createCommunityPost와 같은 카테고리 타입 검증)', async () => {
    const marketCat = await owner.query<{ id: string }>(`SELECT id FROM categories WHERE type = 'market' LIMIT 1`);
    const post = await owner.query<{ id: string; category_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::update to market', 'public') RETURNING id, category_id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: marketCat.rows[0].id, title: '수정', body: '' }),
    });
    expect(res.status).toBe(400);
    const row = await owner.query(`SELECT category_id FROM posts WHERE id = $1`, [post.rows[0].id]);
    expect(row.rows[0].category_id).toBe(post.rows[0].category_id); // 안 바뀌었다
  });

  // 🔒 사용자 지시(2026-10, "news메뉴는 시스템또는 어드민만") — 생성뿐
  // 아니라 "이미 쓴 글을 수정해서 News로 옮기는" 우회도 같은 validateCommunityCategory가 막는다.
  it('News 카테고리로는 일반 유저가 옮길 수 없다 — 403', async () => {
    const post = await owner.query<{ id: string; category_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::update to news', 'public') RETURNING id, category_id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: newsId, title: '수정', body: '본문' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    const row = await owner.query(`SELECT category_id FROM posts WHERE id = $1`, [post.rows[0].id]);
    expect(row.rows[0].category_id).toBe(post.rows[0].category_id); // 안 바뀌었다
  });

  it('존재하지 않는 글이면 404', async () => {
    const res = await fetch(`${baseUrl}/api/posts/00000000-0000-0000-0000-0000000000ff`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: '수정', body: '본문' }),
    });
    expect(res.status).toBe(404);
  });

  // 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을 처리하는데
  // 계속 에러가 뜬다") — DELETE와 같은 이유(public_id 해석).
  it('경로 :id에 public_id를 넣어도 내부 id로 해석돼 수정된다', async () => {
    const post = await owner.query<{ id: string; public_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::update via public_id', '원본', 'public') RETURNING id, public_id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].public_id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::update via public_id 수정됨', body: '수정됨' }),
    });
    expect(res.status).toBe(200);
    const row = await owner.query(`SELECT title FROM posts WHERE id = $1`, [post.rows[0].id]);
    expect(row.rows[0].title).toBe('FEED::update via public_id 수정됨');
  });

  // 🔒 사용자 발견(2026-08, "글쓰기시에 내용을 줄바꿈만 넣어도 저장이 돼.
  // 글자수를 체크하는 로직을 추가해") — 103번째 줄 "제목이 없으면 400"과
  // 같은 자리에서 본문도 필수인지 확인한다.
  it('본문이 없으면 400', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::update empty body', '원본 본문', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: '수정', body: '\n\n\n' }),
    });
    expect(res.status).toBe(400);
    const row = await owner.query(`SELECT body FROM posts WHERE id = $1`, [post.rows[0].id]);
    expect(row.rows[0].body).toBe('원본 본문'); // 안 바뀌었다
  });
});

// 🔒 사용자 지시(2026-08, "글 수정도 똑같이 기능이 구현되어야해") — 게시판↔로그
// 전용 사이의 재분류를 이 함수 하나로 처리한다(막을 이유가 없어 허용).
describe('PATCH /api/posts/:id — 게시판↔로그 전용 재분류', () => {
  it('게시판 글을 로그 전용(visibility만 지정)으로 바꾸면 category_id가 NULL이 되고 log_id가 채워진다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::board to log', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const postId = post.rows[0].id;

    const res = await fetch(`${baseUrl}/api/posts/${postId}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ title: 'FEED::board to log 변경됨', body: '로그로', visibility: 'followers' }),
    });
    expect(res.status).toBe(200);

    const row = await owner.query(`SELECT category_id, log_id, visibility FROM posts WHERE id = $1`, [postId]);
    expect(row.rows[0].category_id).toBeNull();
    expect(row.rows[0].log_id).toBe(alice);
    expect(row.rows[0].visibility).toBe('followers');
  });

  it('로그 전용 글을 게시판(categoryId 지정)으로 바꾸면 log_id가 NULL이 되고 visibility가 public으로 강제된다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, $1, 'FEED::log to board', 'followers') RETURNING id`,
      [alice],
    );
    const postId = post.rows[0].id;

    const res = await fetch(`${baseUrl}/api/posts/${postId}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ categoryId: dailyChatId, title: 'FEED::log to board 변경됨', body: '게시판으로' }),
    });
    expect(res.status).toBe(200);

    const row = await owner.query(`SELECT category_id, log_id, visibility FROM posts WHERE id = $1`, [postId]);
    expect(row.rows[0].category_id).toBe(dailyChatId);
    expect(row.rows[0].log_id).toBeNull();
    expect(row.rows[0].visibility).toBe('public');
  });

  it('로그 전용 글 수정 시 visibility가 public/followers가 아니면 400', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, $1, 'FEED::log bad visibility update', 'public') RETURNING id`,
      [alice],
    );
    const res = await fetch(`${baseUrl}/api/posts/${post.rows[0].id}`, {
      method: 'PATCH',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ title: '수정', body: '', visibility: 'private' }),
    });
    expect(res.status).toBe(400);
  });
});

// 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을 처리하는데
// 계속 에러가 뜬다") — 위 DELETE/PATCH /api/posts/:id와 같은 이유(public_id
// 해석). 댓글 작성 body의 postId도 URL에서 그대로 가져온 public_id일 수 있다.
describe('POST /api/comments — body의 postId가 public_id여도 동작한다', () => {
  it('postId에 public_id를 넣어도 내부 id로 해석돼 댓글이 생성된다', async () => {
    const post = await owner.query<{ id: string; public_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::comment via public_id', 'public') RETURNING id, public_id`,
      [alice, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ postId: post.rows[0].public_id, body: '댓글입니다' }),
    });
    expect(res.status).toBe(201);
    const row = await owner.query(`SELECT body FROM comments WHERE target_type = 'post' AND target_id = $1`, [post.rows[0].id]);
    expect(row.rows[0]?.body).toBe('댓글입니다');
  });

  it('존재하지 않는 public_id는 400', async () => {
    const res = await fetch(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: sessionCookieHeader(aliceToken),
      body: JSON.stringify({ postId: 'doesNotExist', body: '댓글입니다' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/feed — 홈 피드 (§5, §5.1)', () => {
  it('비로그인도 커뮤니티 글을 읽을 수 있다(§4.3)', async () => {
    await owner.query(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::public readable', 'public')`,
      [carol, dailyChatId],
    );
    const res = await fetch(`${baseUrl}/api/feed?sort=latest&limit=50`);
    expect(res.status).toBe(200);
    const { posts } = await res.json();
    expect(posts.some((p: { title: string }) => p.title === 'FEED::public readable')).toBe(true);
  });

  it('🔒 같은 시간 버킷 안에서 팔로잉 작성자 글이 위로 온다(§5.1 2차 정렬)', async () => {
    // bob(팔로잉 대상)과 carol(무관계)의 글을 같은 트랜잭션으로 넣어 같은 시간 버킷을 보장한다
    const rows = await owner.query<{ id: string; author_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility)
       VALUES ($1, $2, 'FEED::bob weighted', 'public'), ($3, $2, 'FEED::carol unweighted', 'public')
       RETURNING id, author_id`,
      [bob, advicetId, carol],
    );
    const bobPostId = rows.rows.find((r) => r.author_id === bob)!.id;
    const carolPostId = rows.rows.find((r) => r.author_id === carol)!.id;

    const feed = await fetchHomeFeed(alice, { sort: 'latest', limit: 50, offset: 0 });
    const bobIdx = feed.findIndex((p) => p.id === bobPostId);
    const carolIdx = feed.findIndex((p) => p.id === carolPostId);
    expect(bobIdx).toBeGreaterThanOrEqual(0);
    expect(carolIdx).toBeGreaterThanOrEqual(0);
    expect(bobIdx).toBeLessThan(carolIdx); // 팔로잉 가중 — bob이 먼저 나온다
  });

  it('🔒 비로그인은 로그 글을 아예 못 본다(§4.3) — show_on_home이어도 RLS가 막는다', async () => {
    const logPost = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility, show_on_home)
       VALUES ($1, gen_random_uuid(), 'FEED::log anon blocked', 'public', true) RETURNING id`,
      [alice],
    );
    const feed = await fetchHomeFeed(null, { sort: 'latest', limit: 100, offset: 0 });
    expect(feed.some((p) => p.id === logPost.rows[0].id)).toBe(false);
  });

  it('로그인 사용자에게도 로그 전용 글은 홈노출 미체크면 피드에서 빠진다(§5 홈 게이트)', async () => {
    const logPost = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility, show_on_home)
       VALUES ($1, gen_random_uuid(), 'FEED::log not on home', 'public', false) RETURNING id`,
      [alice],
    );
    const feed = await fetchHomeFeed(carol, { sort: 'latest', limit: 100, offset: 0 });
    expect(feed.some((p) => p.id === logPost.rows[0].id)).toBe(false);
  });

  it('홈노출 체크된 전체공개 로그 글은 로그인 사용자 피드에 포함된다(§5 홈 게이트)', async () => {
    const logPost = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility, show_on_home)
       VALUES ($1, gen_random_uuid(), 'FEED::log on home', 'public', true) RETURNING id`,
      [alice],
    );
    const feed = await fetchHomeFeed(carol, { sort: 'latest', limit: 100, offset: 0 });
    expect(feed.some((p) => p.id === logPost.rows[0].id)).toBe(true);
  });
});

describe('fetchForYouFeed — GitHub #9 "For You" 가중 정렬', () => {
  it('팔로잉 작성자 글이 최신순보다 위로 온다', async () => {
    const rows = await owner.query<{ id: string; author_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility)
       VALUES ($1, $2, 'FEED::foryou bob follow', 'public'), ($3, $2, 'FEED::foryou carol nosignal', 'public')
       RETURNING id, author_id`,
      [bob, advicetId, carol],
    );
    const bobPostId = rows.rows.find((r) => r.author_id === bob)!.id;
    const carolPostId = rows.rows.find((r) => r.author_id === carol)!.id;

    const feed = await fetchForYouFeed(alice, 50, 0);
    const bobIdx = feed.findIndex((p) => p.id === bobPostId);
    const carolIdx = feed.findIndex((p) => p.id === carolPostId);
    expect(bobIdx).toBeGreaterThanOrEqual(0);
    expect(carolIdx).toBeGreaterThanOrEqual(0);
    expect(bobIdx).toBeLessThan(carolIdx);
  });

  it('구독한 카테고리의 글이 무관한 글보다 위로 온다', async () => {
    await owner.query(`INSERT INTO subscriptions (user_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [alice, advicetId]);
    const rows = await owner.query<{ id: string; category_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility)
       VALUES ($1, $2, 'FEED::foryou subscribed', 'public'), ($1, $3, 'FEED::foryou unsubscribed', 'public')
       RETURNING id, category_id`,
      [carol, advicetId, dailyChatId],
    );
    const subscribedId = rows.rows.find((r) => r.category_id === advicetId)!.id;
    const unsubscribedId = rows.rows.find((r) => r.category_id === dailyChatId)!.id;

    try {
      const feed = await fetchForYouFeed(alice, 50, 0);
      const subIdx = feed.findIndex((p) => p.id === subscribedId);
      const unsubIdx = feed.findIndex((p) => p.id === unsubscribedId);
      expect(subIdx).toBeGreaterThanOrEqual(0);
      expect(unsubIdx).toBeGreaterThanOrEqual(0);
      expect(subIdx).toBeLessThan(unsubIdx);
    } finally {
      await owner.query(`DELETE FROM subscriptions WHERE user_id = $1 AND category_id = $2`, [alice, advicetId]);
    }
  });

  it('팔로잉 대상이 반응·댓글을 남긴 글도 무관한 글보다 위로 온다', async () => {
    const rows = await owner.query<{ id: string; title: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility)
       VALUES ($1, $2, 'FEED::foryou bob reacted', 'public'), ($1, $2, 'FEED::foryou bob commented', 'public'), ($1, $2, 'FEED::foryou nosignal', 'public')
       RETURNING id, title`,
      [carol, advicetId],
    );
    const reactedId = rows.rows.find((r) => r.title === 'FEED::foryou bob reacted')!.id;
    const commentedId = rows.rows.find((r) => r.title === 'FEED::foryou bob commented')!.id;
    const noSignalId = rows.rows.find((r) => r.title === 'FEED::foryou nosignal')!.id;
    await owner.query(
      `INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('post', $1, $2, 'empathy')`,
      [reactedId, bob],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'bob의 댓글')`, [
      commentedId,
      bob,
    ]);

    const feed = await fetchForYouFeed(alice, 50, 0);
    const reactedIdx = feed.findIndex((p) => p.id === reactedId);
    const commentedIdx = feed.findIndex((p) => p.id === commentedId);
    const noSignalIdx = feed.findIndex((p) => p.id === noSignalId);
    expect(reactedIdx).toBeLessThan(noSignalIdx);
    expect(commentedIdx).toBeLessThan(noSignalIdx);
  });

  it('신호가 전혀 없으면 최신순으로 폴백한다', async () => {
    const feed = await fetchForYouFeed(carol, 200, 0);
    const createdAts = feed.map((p) => new Date(p.createdAt).getTime());
    const sorted = [...createdAts].sort((a, b) => b - a);
    expect(createdAts).toEqual(sorted);
  });
});

describe('GET /api/feed?category — 카테고리 피드 (§11.7.3)', () => {
  it('해당 카테고리 글만 반환하고, 다른 카테고리 글은 섞이지 않는다', async () => {
    const inCategory = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::in free', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    const otherCategory = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::in advice', 'public') RETURNING id`,
      [carol, advicetId],
    );
    const feed = await fetchCategoryFeed(null, dailyChatId, { sort: 'latest', limit: 100, offset: 0 });
    expect(feed.some((p) => p.id === inCategory.rows[0].id)).toBe(true);
    expect(feed.some((p) => p.id === otherCategory.rows[0].id)).toBe(false);
  });
});

describe('fetchSavedPosts / unsavePost — §11.7.7 "저장한 글"(신규)', () => {
  it('본인이 저장한 글만 최신 저장순으로 반환한다 — 남이 저장한 글은 안 섞인다', async () => {
    const target = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::save target', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    const other = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::not saved by alice', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)`, [alice, target.rows[0].id]);
    await owner.query(`INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)`, [bob, other.rows[0].id]); // bob이 저장 — alice 목록엔 안 나와야 함

    const saved = await fetchSavedPosts(alice, 100, 0);
    expect(saved.some((p) => p.id === target.rows[0].id)).toBe(true);
    expect(saved.some((p) => p.id === other.rows[0].id)).toBe(false);
  });

  it('삭제된 글은 saved_posts에 행이 남아있어도 목록에서 빠진다(posts RLS가 이중으로 걸러줌)', async () => {
    const target = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::save then delete', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)`, [alice, target.rows[0].id]);
    await owner.query(`DELETE FROM posts WHERE id = $1`, [target.rows[0].id]);

    const saved = await fetchSavedPosts(alice, 100, 0);
    expect(saved.some((p) => p.id === target.rows[0].id)).toBe(false);
  });

  it('unsavePost는 본인의 저장만 지운다', async () => {
    const target = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::unsave target', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)`, [alice, target.rows[0].id]);
    expect((await fetchSavedPosts(alice, 100, 0)).some((p) => p.id === target.rows[0].id)).toBe(true);

    await unsavePost(alice, target.rows[0].id);
    expect((await fetchSavedPosts(alice, 100, 0)).some((p) => p.id === target.rows[0].id)).toBe(false);
  });

  it('존재하지 않는 저장 행에 unsavePost를 호출해도 에러 없이 끝난다(멱등)', async () => {
    const target = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::never saved', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await expect(unsavePost(alice, target.rows[0].id)).resolves.not.toThrow();
  });
});

describe('fetchPostsCommentedByUser — 프로필 "Replies" 탭(신규)', () => {
  it('내가 댓글을 쓴 글만 포함하고, 안 쓴 글은 안 섞인다', async () => {
    const commented = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::replies commented', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    const notCommented = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::replies not commented', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '반가워요')`, [
      commented.rows[0].id,
      alice,
    ]);

    const replies = await fetchPostsCommentedByUser(alice, alice, 100, 0);
    expect(replies.some((r) => r.post.id === commented.rows[0].id)).toBe(true);
    expect(replies.some((r) => r.post.id === notCommented.rows[0].id)).toBe(false);
  });

  it('한 글에 여러 사람이 댓글을 달아도, 그 글 항목엔 내 댓글만 담긴다("원글 + 내 댓글 그룹만")', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::replies mixed comments', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '내 댓글')`, [post.rows[0].id, alice]);
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '남의 댓글')`, [post.rows[0].id, bob]);

    const replies = await fetchPostsCommentedByUser(alice, alice, 100, 0);
    const item = replies.find((r) => r.post.id === post.rows[0].id);
    expect(item).toBeDefined();
    expect(item!.comments.map((c) => c.body)).toEqual(['내 댓글']);
  });

  it('삭제된 글은 댓글을 남겼어도 목록에서 빠진다(posts RLS가 재조회에서 걸러줌)', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::replies deleted', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '삭제 전 댓글')`, [
      post.rows[0].id,
      alice,
    ]);
    await owner.query(`DELETE FROM posts WHERE id = $1`, [post.rows[0].id]);

    const replies = await fetchPostsCommentedByUser(alice, alice, 100, 0);
    expect(replies.some((r) => r.post.id === post.rows[0].id)).toBe(false);
  });

  it('타인 시점으로 조회해도(viewerId만 다름) 같은 대상의 댓글 그룹이 그대로 나온다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::replies viewer differs', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '공개 댓글')`, [
      post.rows[0].id,
      alice,
    ]);

    const replies = await fetchPostsCommentedByUser(bob, alice, 100, 0);
    expect(replies.some((r) => r.post.id === post.rows[0].id)).toBe(true);
  });

  // 🔒 사용자 지시(2026-08, "좋아요, 댓글 아이콘등이 빠졌어. 댓글 디자인을
  // 똑같이 구현해야해") — Replies 탭 하트를 실제로 토글 가능하게 하려면
  // reactionCount/myReaction이 정확해야 한다. myReaction은 "프로필 주인"이
  // 아니라 "지금 조회하는 사람"(viewerId) 기준이어야 한다.
  it('reactionCount·myReaction이 뷰어(viewerId) 기준으로 정확히 채워진다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'FEED::replies reaction', 'public') RETURNING id`,
      [carol, dailyChatId],
    );
    const comment = await owner.query<{ id: string }>(
      `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, '반응 테스트') RETURNING id`,
      [post.rows[0].id, alice],
    );
    await owner.query(`INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('comment', $1, $2, 'empathy')`, [
      comment.rows[0].id,
      bob,
    ]);

    const asBob = await fetchPostsCommentedByUser(bob, alice, 100, 0);
    const itemAsBob = asBob.find((r) => r.post.id === post.rows[0].id);
    expect(itemAsBob!.comments[0].reactionCount).toBe(1);
    expect(itemAsBob!.comments[0].myReaction).toBe(true);

    const asCarol = await fetchPostsCommentedByUser(carol, alice, 100, 0);
    const itemAsCarol = asCarol.find((r) => r.post.id === post.rows[0].id);
    expect(itemAsCarol!.comments[0].reactionCount).toBe(1);
    expect(itemAsCarol!.comments[0].myReaction).toBe(false);
  });
});

describe('fetchMediaPostsForLog — 프로필 "Media" 탭(신규)', () => {
  it('본문에 이미지 마커가 있는 글만 포함하고, 순수 텍스트 글은 빠진다', async () => {
    const withImage = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media image marker', $3, 'public') RETURNING id`,
      [alice, dailyChatId, `사진 보여줄게${makeImageMarker('https://example.com/a.png')}`],
    );
    const textOnly = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media text only', '그냥 텍스트', 'public') RETURNING id`,
      [alice, dailyChatId],
    );

    const media = await fetchMediaPostsForLog(alice, alice, 100, 0);
    expect(media.some((p) => p.id === withImage.rows[0].id)).toBe(true);
    expect(media.some((p) => p.id === textOnly.rows[0].id)).toBe(false);
  });

  it('직접 이미지/동영상 URL이나 유튜브 링크가 본문에 있으면 포함된다', async () => {
    const directImage = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media direct image url', 'https://example.com/photo.jpg', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const directVideo = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media direct video url', 'https://example.com/clip.mp4', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const youtube = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'public') RETURNING id`,
      [alice, dailyChatId],
    );
    const plainLink = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media plain link', 'https://example.com/article', 'public') RETURNING id`,
      [alice, dailyChatId],
    );

    const media = await fetchMediaPostsForLog(alice, alice, 100, 0);
    expect(media.some((p) => p.id === directImage.rows[0].id)).toBe(true);
    expect(media.some((p) => p.id === directVideo.rows[0].id)).toBe(true);
    expect(media.some((p) => p.id === youtube.rows[0].id)).toBe(true);
    expect(media.some((p) => p.id === plainLink.rows[0].id)).toBe(false);
  });

  it('다른 사용자의 미디어 글은 안 섞인다', async () => {
    const bobsMedia = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'FEED::media bobs image', 'https://example.com/bob.png', 'public') RETURNING id`,
      [bob, dailyChatId],
    );
    const media = await fetchMediaPostsForLog(alice, alice, 100, 0);
    expect(media.some((p) => p.id === bobsMedia.rows[0].id)).toBe(false);
  });
});
