import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoodfriendsClient, fetchCategories, deriveUsername, type FetchLike } from './goodfriends-client.js';
import { openDatabase } from '../db/database.js';
import type { AgentPersona } from '../types.js';

const BASE = 'http://gf.test';

function makePersona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: 'agent-1',
    name: '테스트',
    nickname: '테스트닉',
    email: 'Test.User@goodfriends.local',
    password: 'password-1234',
    birthdate: '1990-01-01',
    country: 'KR',
    postalCode: '04524',
    bio: '',
    interests: [],
    preferredCategories: [],
    tone: '',
    systemPrompt: '',
    postProb: 0,
    commentProb: 0,
    reactionProb: 0,
    externalSearchProb: 0,
    minIntervalMinutes: 1,
    maxIntervalMinutes: 2,
    ...overrides,
  } as AgentPersona;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
type Route = { status: number; body?: unknown; text?: string };

/** 호출 순서대로 응답을 소비하는 fetch 목. 응답이 모자라면 테스트가 실패하도록 500을 돌려준다. */
function mockFetch(routes: Route[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...routes];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = queue.shift() ?? { status: 599, body: { error: 'UNEXPECTED_CALL' } };
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status });
  };
  return { fetch: fetchImpl, calls };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-client-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeClient(routes: Route[], persona = makePersona(), seedToken?: string) {
  if (seedToken) {
    const db = openDatabase(tmpDir);
    db.prepare('INSERT INTO sessions (agent_id, session_token) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET session_token = excluded.session_token').run(persona.id, seedToken);
    db.close();
  }
  const m = mockFetch(routes);
  const client = new GoodfriendsClient(persona, BASE + '/', tmpDir, m.fetch);
  return { client, ...m };
}

const LOGIN_OK: Route = { status: 200, body: { userId: 'u1', token: 'tok-login' } };

describe('deriveUsername', () => {
  it('서버 규칙: 소문자, [a-z0-9_]만, 20자', () => {
    expect(deriveUsername('Test.User@x.com')).toBe('testuser');
    expect(deriveUsername('a'.repeat(30) + '@x.com')).toBe('a'.repeat(20));
    expect(deriveUsername('..@x.com')).toBe('user');
  });
});

describe('login / signup', () => {
  it('login 성공: 바디 token을 저장하고 SQLite sessions에 영속화한다', async () => {
    const { client, calls } = makeClient([LOGIN_OK]);
    expect(await client.login()).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ url: `${BASE}/api/auth/login`, method: 'POST', body: { email: 'Test.User@goodfriends.local', password: 'password-1234' } });
    const db = openDatabase(tmpDir);
    const row = db.prepare('SELECT session_token FROM sessions WHERE agent_id = ?').get('agent-1') as any;
    db.close();
    expect(row.session_token).toBe('tok-login');
  });

  it('login 401 INVALID_CREDENTIALS → 에러코드를 그대로 돌려준다', async () => {
    const { client } = makeClient([{ status: 401, body: { error: 'INVALID_CREDENTIALS' } }]);
    expect(await client.login()).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' });
  });

  it('login 429 RATE_LIMITED', async () => {
    const { client } = makeClient([{ status: 429, body: { error: 'RATE_LIMITED' } }]);
    expect(await client.login()).toEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('JSON이 아닌 에러 응답은 HTTP 상태로 보고한다', async () => {
    const { client } = makeClient([{ status: 502, text: '<html>bad gateway</html>' }]);
    expect(await client.login()).toEqual({ ok: false, error: 'HTTP 502' });
  });

  it('signup 201: 페르소나 값을 보내고 token을 저장한다. 비어 있는 선택 필드는 보내지 않는다', async () => {
    const { client, calls } = makeClient(
      [{ status: 201, body: { userId: 'u1', token: 'tok-signup' } }],
      makePersona({ country: '', postalCode: '', birthdate: '' })
    );
    expect(await client.signup()).toEqual({ ok: true });
    expect(calls[0].url).toBe(`${BASE}/api/auth/signup`);
    expect(calls[0].body).toEqual({ email: 'Test.User@goodfriends.local', password: 'password-1234', nickname: '테스트닉' });
  });

  it('signup 409 EMAIL_TAKEN / 400 INVALID_INPUT', async () => {
    const a = makeClient([{ status: 409, body: { error: 'EMAIL_TAKEN' } }]);
    expect(await a.client.signup()).toEqual({ ok: false, error: 'EMAIL_TAKEN' });
    const b = makeClient([{ status: 400, body: { error: 'INVALID_INPUT' } }]);
    expect(await b.client.signup()).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('네트워크 예외는 error 메시지로 변환된다', async () => {
    const throwing: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const client = new GoodfriendsClient(makePersona(), BASE, tmpDir, throwing);
    expect(await client.login()).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });
});

describe('ensureAuthenticated 폴백 순서', () => {
  it('저장된 세션이 유효하면(GET /api/auth/session 200) 로그인 없이 통과 — Bearer 헤더 사용', async () => {
    const { client, calls } = makeClient([{ status: 200, body: { userId: 'u1', emailVerified: true } }], makePersona(), 'saved-tok');
    expect(await client.ensureAuthenticated()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/auth/session`);
    expect(calls[0].headers.Authorization).toBe('Bearer saved-tok');
  });

  it('세션 401 → 로그인 성공', async () => {
    const { client, calls } = makeClient([{ status: 401, body: { error: 'NOT_AUTHENTICATED' } }, LOGIN_OK], makePersona(), 'stale');
    expect(await client.ensureAuthenticated()).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/api/auth/session`, `${BASE}/api/auth/login`]);
  });

  it('세션 없음 → 로그인 실패(INVALID_CREDENTIALS) → 가입 성공', async () => {
    const { client, calls } = makeClient([
      { status: 401, body: { error: 'INVALID_CREDENTIALS' } },
      { status: 201, body: { userId: 'u1', token: 'tok-new' } },
    ]);
    expect(await client.ensureAuthenticated()).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/api/auth/login`, `${BASE}/api/auth/signup`]);
  });

  it('로그인 실패 → 가입 EMAIL_TAKEN → 재로그인 성공', async () => {
    const { client, calls } = makeClient([
      { status: 401, body: { error: 'INVALID_CREDENTIALS' } },
      { status: 409, body: { error: 'EMAIL_TAKEN' } },
      LOGIN_OK,
    ]);
    expect(await client.ensureAuthenticated()).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/api/auth/login`, `${BASE}/api/auth/signup`, `${BASE}/api/auth/login`]);
  });

  it('전부 실패하면 false 를 돌려주고 원인을 로그에 남긴다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeClient([
      { status: 401, body: { error: 'INVALID_CREDENTIALS' } },
      { status: 400, body: { error: 'INVALID_INPUT' } },
    ]);
    expect(await client.ensureAuthenticated()).toBe(false);
    expect(String(err.mock.calls[0][0])).toContain('login(INVALID_CREDENTIALS), signup(INVALID_INPUT)');
  });

  it('가입이 EMAIL_TAKEN이 아니면 재로그인하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = makeClient([
      { status: 401, body: { error: 'INVALID_CREDENTIALS' } },
      { status: 429, body: { error: 'RATE_LIMITED' } },
    ]);
    expect(await client.ensureAuthenticated()).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('피드 / 댓글 조회', () => {
  const FEED_ROW = {
    id: 'uuid-1',
    publicId: 'abc123',
    title: '제목',
    bodyPreview: '미리보기',
    authorId: 'u9',
    authorUsername: 'someone',
    authorNickname: '누군가',
    authorAvatarUrl: '',
    authorIsAgent: false,
    categoryName: '자유게시판',
    categorySlug: 'free',
    createdAt: '2026-11-01T00:00:00Z',
    reactionCount: 3,
    commentCount: 2,
    deletedAt: null,
  };

  it('getFeed: 쿼리 파라미터를 만들고 publicId를 id로 매핑한다', async () => {
    const { client, calls } = makeClient([{ status: 200, body: { posts: [FEED_ROW] } }], makePersona(), 'tok');
    const posts = await client.getFeed({ categorySlug: 'free', sort: 'popular', limit: 5 });
    expect(calls[0].url).toBe(`${BASE}/api/feed?category=free&sort=popular&limit=5`);
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: 'abc123', internalId: 'uuid-1', authorNickname: '누군가', categorySlug: 'free', reactionCount: 3, commentCount: 2, authorIsAgent: false });
    expect(posts[0].authorAvatarUrl).toBeUndefined();
  });

  it('getFeed 기본값 sort=latest limit=20, 세션 없으면 Authorization 생략', async () => {
    const { client, calls } = makeClient([{ status: 200, body: { posts: [] } }]);
    await client.getFeed();
    expect(calls[0].url).toBe(`${BASE}/api/feed?sort=latest&limit=20`);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('getFeed 404(없는 카테고리)·네트워크 오류는 빈 배열', async () => {
    const a = makeClient([{ status: 404, body: { error: 'NOT_FOUND' } }]);
    expect(await a.client.getFeed({ categorySlug: 'nope' })).toEqual([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing: FetchLike = async () => {
      throw new Error('down');
    };
    expect(await new GoodfriendsClient(makePersona(), BASE, tmpDir, throwing).getFeed()).toEqual([]);
  });

  it('getComments: GET /api/posts/:publicId 의 comments를 매핑한다', async () => {
    const { client, calls } = makeClient([
      {
        status: 200,
        body: {
          post: { id: 'uuid-1', publicId: 'abc123' },
          comments: [
            { id: 'c1', authorId: 'u2', authorUsername: 'x', authorNickname: '엑스', body: '댓글', createdAt: 't', reactionCount: 1, myReaction: true, parentCommentId: null },
            { id: 'c2', authorId: 'u3', authorUsername: 'y', authorNickname: '와이', body: '답글', createdAt: 't', reactionCount: 0, myReaction: false, parentCommentId: 'c1' },
          ],
        },
      },
    ]);
    const comments = await client.getComments('abc123');
    expect(calls[0].url).toBe(`${BASE}/api/posts/abc123`);
    expect(comments.map((c) => [c.id, c.postId, c.parentCommentId, c.myReaction])).toEqual([
      ['c1', 'abc123', null, true],
      ['c2', 'abc123', 'c1', false],
    ]);
  });

  it('getComments 404 → 빈 배열', async () => {
    const { client } = makeClient([{ status: 404, body: { error: 'NOT_FOUND' } }]);
    expect(await client.getComments('zzz')).toEqual([]);
  });

  it('getPostDetail: post + comments, 404면 null', async () => {
    const a = makeClient([{ status: 200, body: { post: { publicId: 'abc', body: '전체 본문' }, comments: [] } }]);
    expect((await a.client.getPostDetail('abc'))?.post.body).toBe('전체 본문');
    const b = makeClient([{ status: 404, body: { error: 'NOT_FOUND' } }]);
    expect(await b.client.getPostDetail('abc')).toBeNull();
  });
});

describe('카테고리', () => {
  const CATS = {
    categories: [
      { id: 'c-news', slug: 'ai-news', name: 'News' },
      { id: 'c-free', slug: 'free', name: '자유게시판' },
      { id: 'c-qna', slug: 'qna', name: 'Q&A' },
    ],
  };

  it('fetchCategories: {id,slug,name}만 매핑, 실패하면 []', async () => {
    const ok = mockFetch([{ status: 200, body: CATS }]);
    expect(await fetchCategories(BASE, ok.fetch)).toHaveLength(3);
    expect(ok.calls[0].url).toBe(`${BASE}/api/categories`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fetchCategories(BASE, mockFetch([{ status: 500, body: { error: 'INTERNAL_ERROR' } }]).fetch)).toEqual([]);
  });

  it('getCategories는 한 번만 조회하고 캐시한다 / slug → id 해석', async () => {
    const { client, calls } = makeClient([{ status: 200, body: CATS }]);
    expect((await client.getCategoryBySlug('qna'))?.id).toBe('c-qna');
    expect(await client.getCategoryBySlug('nope')).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('getRandomCategory: 선호 slug 우선, News 전용은 제외, 선호가 없으면 전체에서', async () => {
    const { client } = makeClient([{ status: 200, body: CATS }]);
    for (let i = 0; i < 20; i++) {
      expect((await client.getRandomCategory(['qna']))?.slug).toBe('qna');
      expect((await client.getRandomCategory(['ai-news']))?.slug).not.toBe('ai-news');
      expect((await client.getRandomCategory(['없는slug']))?.slug).not.toBe('ai-news');
    }
  });

  it('카테고리를 못 가져오면 null (캐시하지 않음)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = makeClient([{ status: 500, body: {} }, { status: 200, body: CATS }]);
    expect(await client.getRandomCategory()).toBeNull();
    expect((await client.getRandomCategory())?.slug).toBeTruthy();
    expect(calls).toHaveLength(2);
  });
});

describe('createPost', () => {
  const authed = (extra: Route[]) => makeClient([{ status: 200, body: { userId: 'u1' } }, ...extra], makePersona(), 'tok');

  it('201: categoryId/title/body 전송, publicId를 id로 반환', async () => {
    const { client, calls } = authed([{ status: 201, body: { id: 'uuid-9', publicId: 'pub9' } }]);
    const res = await client.createPost({ categoryId: 'cat-uuid', title: '제목', body: '문단1\n\n문단2' });
    expect(res).toEqual({ ok: true, id: 'pub9' });
    expect(calls[1]).toMatchObject({ url: `${BASE}/api/posts`, method: 'POST', body: { categoryId: 'cat-uuid', title: '제목', body: '문단1\n\n문단2' } });
    expect(calls[1].headers.Authorization).toBe('Bearer tok');
  });

  it('401 NOT_AUTHENTICATED', async () => {
    const { client } = authed([{ status: 401, body: { error: 'NOT_AUTHENTICATED' } }]);
    expect(await client.createPost({ categoryId: 'c', title: 't', body: 'b' })).toEqual({ ok: false, error: 'NOT_AUTHENTICATED' });
  });

  it('403 EMAIL_NOT_VERIFIED → 에러코드 + 로그에 is_agent 안내', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = authed([{ status: 403, body: { error: 'EMAIL_NOT_VERIFIED' } }]);
    expect(await client.createPost({ categoryId: 'c', title: 't', body: 'b' })).toEqual({ ok: false, error: 'EMAIL_NOT_VERIFIED' });
    const logged = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('EMAIL_NOT_VERIFIED');
    expect(logged).toContain('is_agent');
  });

  it('403 FORBIDDEN(News 전용) / 400 INVALID_INPUT', async () => {
    const a = authed([{ status: 403, body: { error: 'FORBIDDEN' } }]);
    expect((await a.client.createPost({ categoryId: 'c', title: 't', body: 'b' })).error).toBe('FORBIDDEN');
    const b = authed([{ status: 400, body: { error: 'INVALID_INPUT' } }]);
    expect((await b.client.createPost({ categoryId: 'c', title: 't', body: 'b' })).error).toBe('INVALID_INPUT');
  });

  it('인증 실패면 글쓰기 요청을 보내지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = makeClient([
      { status: 401, body: { error: 'INVALID_CREDENTIALS' } },
      { status: 400, body: { error: 'INVALID_INPUT' } },
    ]);
    expect(await client.createPost({ categoryId: 'c', title: 't', body: 'b' })).toEqual({ ok: false, error: 'Authentication failed' });
    expect(calls.some((c) => c.url.endsWith('/api/posts'))).toBe(false);
  });
});

describe('deletePost', () => {
  const authed = (extra: Route[]) => makeClient([{ status: 200, body: { userId: 'u1' } }, ...extra], makePersona(), 'tok');
  it('200 ok', async () => {
    const { client, calls } = authed([{ status: 200, body: { ok: true } }]);
    expect(await client.deletePost('pub9')).toEqual({ ok: true });
    expect(calls[1]).toMatchObject({ url: `${BASE}/api/posts/pub9`, method: 'DELETE' });
  });
  it('404 NOT_FOUND(남의 글/없는 글) · 401', async () => {
    expect((await authed([{ status: 404, body: { error: 'NOT_FOUND' } }]).client.deletePost('x')).error).toBe('NOT_FOUND');
    expect((await authed([{ status: 401, body: { error: 'NOT_AUTHENTICATED' } }]).client.deletePost('x')).error).toBe('NOT_AUTHENTICATED');
  });
});

describe('createComment', () => {
  const authed = (extra: Route[]) => makeClient([{ status: 200, body: { userId: 'u1' } }, ...extra], makePersona(), 'tok');

  it('201: 댓글 (parentCommentId null)', async () => {
    const { client, calls } = authed([{ status: 201, body: { id: 'cm1' } }]);
    expect(await client.createComment({ postId: 'pub9', body: '안녕' })).toEqual({ ok: true, id: 'cm1' });
    expect(calls[1]).toMatchObject({ url: `${BASE}/api/comments`, method: 'POST', body: { postId: 'pub9', body: '안녕', parentCommentId: null } });
  });

  it('201: 답글은 parentCommentId를 보낸다', async () => {
    const { client, calls } = authed([{ status: 201, body: { id: 'cm2' } }]);
    await client.createComment({ postId: 'pub9', body: '답글', parentCommentId: 'cm1' });
    expect(calls[1].body.parentCommentId).toBe('cm1');
  });

  it.each([
    [429, 'RATE_LIMITED'],
    [404, 'NOT_FOUND'],
    [400, 'INVALID_INPUT'],
    [401, 'NOT_AUTHENTICATED'],
  ])('%i %s 를 에러코드로 돌려준다', async (status, code) => {
    const { client } = authed([{ status, body: { error: code } }]);
    expect(await client.createComment({ postId: 'p', body: 'b' })).toEqual({ ok: false, error: code });
  });

  it('403 EMAIL_NOT_VERIFIED 는 로그에 명확히 남는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = authed([{ status: 403, body: { error: 'EMAIL_NOT_VERIFIED' } }]);
    expect((await client.createComment({ postId: 'p', body: 'b' })).error).toBe('EMAIL_NOT_VERIFIED');
    expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toContain('댓글 작성 거부: EMAIL_NOT_VERIFIED');
  });
});

describe('공감', () => {
  const authed = (extra: Route[]) => makeClient([{ status: 200, body: { userId: 'u1' } }, ...extra], makePersona(), 'tok');

  it('글 공감 executed: intent.execute 계약대로 보내고 reaction을 돌려준다', async () => {
    const { client, calls } = authed([{ status: 200, body: { status: 'executed', reaction: 'empathy' } }]);
    expect(await client.toggleReaction('pub9')).toEqual({ ok: true, reaction: 'empathy' });
    expect(calls[1]).toMatchObject({
      url: `${BASE}/api/intent/execute`,
      method: 'POST',
      body: { intent: { action: 'reaction', targetId: 'pub9', returnTo: '/', emoticonType: 'empathy' }, confirmed: true },
    });
  });

  it('토글 해제 → reaction null', async () => {
    const { client } = authed([{ status: 200, body: { status: 'executed', reaction: null } }]);
    expect(await client.toggleReaction('pub9')).toEqual({ ok: true, reaction: null });
  });

  it('HTTP 200 + status=email_not_verified → EMAIL_NOT_VERIFIED 에러, 로그 남김', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = authed([{ status: 200, body: { status: 'email_not_verified' } }]);
    expect(await client.toggleReaction('pub9')).toEqual({ ok: false, error: 'EMAIL_NOT_VERIFIED' });
    expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toContain('공감 거부: EMAIL_NOT_VERIFIED');
  });

  it('HTTP 200 + status=blocked → status를 에러에 담는다', async () => {
    const { client } = authed([{ status: 200, body: { status: 'blocked' } }]);
    const res = await client.toggleReaction('pub9');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('status=blocked');
  });

  it('401 / 400', async () => {
    const a = await authed([{ status: 401, body: { error: 'NOT_AUTHENTICATED' } }]).client.toggleReaction('p');
    expect(a.ok).toBe(false);
    expect(a.error).toContain('NOT_AUTHENTICATED');
    const b = await authed([{ status: 400, body: { error: 'INVALID_INPUT' } }]).client.toggleReaction('nope');
    expect(b.error).toContain('INVALID_INPUT');
  });

  it('댓글 공감 200 {reacted}', async () => {
    const { client, calls } = authed([{ status: 200, body: { reacted: true } }]);
    expect(await client.toggleCommentReaction('cm1')).toEqual({ ok: true, reacted: true });
    expect(calls[1]).toMatchObject({ url: `${BASE}/api/comments/cm1/reaction`, method: 'POST' });
  });

  it('댓글 공감 404 NOT_FOUND / 403 EMAIL_NOT_VERIFIED / 400', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await authed([{ status: 404, body: { error: 'NOT_FOUND' } }]).client.toggleCommentReaction('c')).error).toBe('NOT_FOUND');
    expect((await authed([{ status: 403, body: { error: 'EMAIL_NOT_VERIFIED' } }]).client.toggleCommentReaction('c')).error).toBe('EMAIL_NOT_VERIFIED');
    expect((await authed([{ status: 400, body: { error: 'INVALID_INPUT' } }]).client.toggleCommentReaction('c')).error).toBe('INVALID_INPUT');
  });
});

describe('프로필', () => {
  const authed = (extra: Route[], persona = makePersona()) => makeClient([{ status: 200, body: { userId: 'u1' } }, ...extra], persona, 'tok');

  it('getProfile 200 → 응답 객체, 401 → null', async () => {
    const a = authed([{ status: 200, body: { username: 'abc', nickname: '닉', intro: '', visibility: 'public' } }]);
    expect((await a.client.getProfile())?.username).toBe('abc');
    expect(a.calls[1].url).toBe(`${BASE}/api/profile`);
    expect(await authed([{ status: 401, body: { error: 'NOT_AUTHENTICATED' } }]).client.getProfile()).toBeNull();
  });

  it('updateProfile: 바꿀 필드만 PATCH 로 보낸다(부분 patch)', async () => {
    const { client, calls } = authed([{ status: 200, body: { ok: true } }]);
    expect(await client.updateProfile({ nickname: '새닉', username: 'new_name' })).toEqual({ ok: true });
    expect(calls[1]).toMatchObject({ url: `${BASE}/api/profile`, method: 'PATCH', body: { nickname: '새닉', username: 'new_name' } });
    expect(Object.keys(calls[1].body).sort()).toEqual(['nickname', 'username']);
  });

  it('updateProfile 409 USERNAME_TAKEN / 400 INVALID_INPUT', async () => {
    expect((await authed([{ status: 409, body: { error: 'USERNAME_TAKEN' } }]).client.updateProfile({ username: 'x_y' })).error).toBe('USERNAME_TAKEN');
    expect((await authed([{ status: 400, body: { error: 'INVALID_INPUT' } }]).client.updateProfile({ nickname: '' })).error).toBe('INVALID_INPUT');
  });

  it('currentUsername: 저장된 값 우선, 없으면 이메일에서 유도', () => {
    expect(makeClient([], makePersona({ username: 'renamed' })).client.currentUsername).toBe('renamed');
    expect(makeClient([], makePersona()).client.currentUsername).toBe('testuser');
  });
});
