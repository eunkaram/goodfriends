/**
 * 프로필 조회 HTTP 라우트(GitHub #3) — src/user-log-http.ts의
 * GET /api/profile, GET /api/profile/:username.
 *
 * 🔒 구현 중 발견 — 이슈 승인기준 2번("비로그인 요청도 공개 프로필은 200")은
 * 실제 RLS와 충돌한다. `app_can_view_tier()`(0005_userlog_album_photo.sql)가
 * `app_current_user_id() IS NOT NULL`을 첫 조건으로 걸어서, §4.3("로그 홈·
 * 앨범·프로필·친구 목록은 비로그인 전면 차단 — 전체공개여도 예외 없음")대로
 * visibility가 public이어도 비로그인이면 무조건 0행이다. 사용자 확인 후
 * §4.3을 그대로 유지하기로 결정 — 아래 "비로그인은 공개 프로필도 404" 테스트가
 * 그 결정을 고정한다(웹과 동일한 동작, 회귀 아님).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import { handleUserLogRoutes } from '../../src/user-log-http.ts';
import { createDefaultUserLog, updateProfile } from '../../src/user-log.ts';
import { makeImageMarker } from '../../src/link-detect.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let alice: string; // 공개 프로필
let bob: string; // 비공개(private) 프로필
let carol: string; // bob과 무관계
let aliceToken: string;
let bobToken: string;
let carolToken: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleUserLogRoutes(req, res)) return;
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
  await owner.query(`DELETE FROM users WHERE username LIKE 'ulhttp_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('ulhttp_alice'), ('ulhttp_bob'), ('ulhttp_carol') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'ulhttp_alice')!.id;
  bob = u.rows.find((r) => r.username === 'ulhttp_bob')!.id;
  carol = u.rows.find((r) => r.username === 'ulhttp_carol')!.id;

  await createDefaultUserLog(alice);
  await createDefaultUserLog(bob);
  await createDefaultUserLog(carol);
  await updateProfile(bob, { visibility: 'private' });

  aliceToken = (await createSession(alice)).token;
  bobToken = (await createSession(bob)).token;
  carolToken = (await createSession(carol)).token;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await destroySession(bobToken);
  await destroySession(carolToken);
  await owner?.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'ULHTTP::%')`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'ULHTTP::%'`);
  await owner?.query(`DELETE FROM follows WHERE follower_id = ANY($1::uuid[]) OR followee_id = ANY($1::uuid[])`, [[alice, bob, carol]]);
  await owner?.query(`DELETE FROM user_logs WHERE user_id = ANY($1::uuid[])`, [[alice, bob, carol]]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'ulhttp_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/profile/:username', () => {
  it('로그인 상태면 공개(public) 프로필을 볼 수 있다 — UserLogProfile 형태 그대로', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      userId: alice,
      username: 'ulhttp_alice',
      visibility: 'public',
    });
    expect(typeof body.postCount).toBe('number');
    expect(typeof body.followerCount).toBe('number');
    expect(Array.isArray(body.profileLinks)).toBe(true);
  });

  // 🔒 §4.3 — 위 파일 헤더 주석 참고. 이슈 원안의 "비로그인도 공개 프로필은 200"
  // 전제를 뒤집는 실측 — 사용자 확인 후 기존 §4.3(웹과 동일)을 그대로 유지.
  it('비로그인은 공개(public) 프로필이어도 404 (§4.3, 웹과 동일 동작)', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('존재하지 않는 username은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/no_such_user_xyz`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('비공개(private) 프로필은 무관계 뷰어에게 404 — 본인은 200', async () => {
    const asCarol = await fetch(`${baseUrl}/api/profile/ulhttp_bob`, { headers: sessionCookieHeader(carolToken) });
    expect(asCarol.status).toBe(404);

    const asSelf = await fetch(`${baseUrl}/api/profile/ulhttp_bob`, { headers: sessionCookieHeader(bobToken) });
    expect(asSelf.status).toBe(200);
    expect((await asSelf.json()).visibility).toBe('private');
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  it('Authorization: Bearer 헤더로도 동일하게 동작', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice`, { headers: { Authorization: `Bearer ${carolToken}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).username).toBe('ulhttp_alice');
  });
});

describe('GET /api/profile (내 프로필)', () => {
  it('세션 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/profile`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'NOT_AUTHENTICATED' });
  });

  it('로그인 상태면 본인 프로필을 username 없이도 바로 받는다', async () => {
    const res = await fetch(`${baseUrl}/api/profile`, { headers: sessionCookieHeader(aliceToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(alice);
    expect(body.username).toBe('ulhttp_alice');
  });

  it('비공개(private) 계정 본인도 /api/profile로 자기 프로필을 그대로 받는다', async () => {
    const res = await fetch(`${baseUrl}/api/profile`, { headers: sessionCookieHeader(bobToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(bob);
    expect(body.visibility).toBe('private');
  });

  // §26(모바일)
  it('Authorization: Bearer 헤더로도 동일하게 동작', async () => {
    const res = await fetch(`${baseUrl}/api/profile`, { headers: { Authorization: `Bearer ${aliceToken}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).userId).toBe(alice);
  });
});

/**
 * GitHub #4 — ProfileTabs.tsx의 Post/Replies/Media/Follower 4탭 HTTP 노출.
 * 서버 함수 자체(fetchLogPosts 등)의 로직은 posts-and-feed.test.ts /
 * tests/guards/relationships.test.ts가 이미 검증한다 — 여기선 라우팅
 * 배선(인증 패턴, limit/offset, 404)만 확인한다.
 */
describe('GET /api/profile/:username/posts', () => {
  it('공개(public) 로그 글 목록을 FeedPost 형태로 받는다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, body, visibility) VALUES ($1, $1, 'ULHTTP::posts one', '본문', 'public') RETURNING id`,
      [alice],
    );
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/posts`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.posts.some((p: { id: string }) => p.id === post.rows[0].id)).toBe(true);
  });

  it('비로그인은 404 (§4.3, 웹과 동일 동작)', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/posts`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('존재하지 않는 username은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/no_such_user_xyz/posts`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('limit/offset이 /api/feed와 동일하게 적용된다', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/posts?limit=1&offset=0`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.length).toBeLessThanOrEqual(1);
  });

  it('limit이 범위를 벗어나면 50으로 clamp된다(400이 아니다)', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/posts?limit=9999`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/profile/:username/replies', () => {
  it('본인이 댓글 단 글 + 본인 댓글 목록을 받는다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, body, visibility) VALUES ($1, $1, 'ULHTTP::replies target', '본문', 'public') RETURNING id`,
      [bob],
    );
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'ULHTTP:: 댓글')`, [
      post.rows[0].id,
      alice,
    ]);
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/replies`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const match = body.items.find((it: { post: { id: string } }) => it.post.id === post.rows[0].id);
    expect(match).toBeTruthy();
    expect(match.comments.some((c: { body: string }) => c.body === 'ULHTTP:: 댓글')).toBe(true);
  });

  it('비로그인은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/replies`);
    expect(res.status).toBe(404);
  });

  it('존재하지 않는 username은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/no_such_user_xyz/replies`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });
});

describe('GET /api/profile/:username/media', () => {
  it('본문에 미디어가 있는 글만 받는다', async () => {
    const withImage = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, body, visibility) VALUES ($1, $1, 'ULHTTP::media image', $2, 'public') RETURNING id`,
      [alice, `사진${makeImageMarker('https://example.com/ulhttp.png')}`],
    );
    const textOnly = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, body, visibility) VALUES ($1, $1, 'ULHTTP::media text only', '그냥 텍스트', 'public') RETURNING id`,
      [alice],
    );
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/media`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.some((p: { id: string }) => p.id === withImage.rows[0].id)).toBe(true);
    expect(body.posts.some((p: { id: string }) => p.id === textOnly.rows[0].id)).toBe(false);
  });

  it('비로그인은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/media`);
    expect(res.status).toBe(404);
  });

  it('존재하지 않는 username은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/no_such_user_xyz/media`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });
});

describe('GET /api/profile/:username/followers', () => {
  it('팔로워 목록을 isFollowedByViewer와 함께 받는다', async () => {
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [carol, alice]);
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [bob, carol]);

    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/followers`, { headers: sessionCookieHeader(bobToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.followers)).toBe(true);
    const carolEntry = body.followers.find((f: { id: string }) => f.id === carol);
    expect(carolEntry).toBeTruthy();
    expect(carolEntry.isFollowedByViewer).toBe(true); // bob이 carol을 팔로우 중

    await owner.query(`DELETE FROM follows WHERE follower_id = ANY($1::uuid[])`, [[carol, bob]]);
  });

  it('비로그인은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/ulhttp_alice/followers`);
    expect(res.status).toBe(404);
  });

  it('존재하지 않는 username은 404', async () => {
    const res = await fetch(`${baseUrl}/api/profile/no_such_user_xyz/followers`, { headers: sessionCookieHeader(carolToken) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });
});
