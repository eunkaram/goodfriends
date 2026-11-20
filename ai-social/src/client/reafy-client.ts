import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import type { AgentPersona, ReafyPost, ReafyCategory, ReafyComment } from '../types.js';
import { openDatabase } from '../db/database.js';

// prod DB(api.reafy.com)에서 직접 조회해서 얻은 실제 카테고리 UUID (2026-09-06).
// dev.reafy.com에서 캡처했던 예전 UUID는 prod DB엔 존재하지 않아서 새 글 작성이 전부
// INVALID_INPUT으로 실패했었다 — 공감/댓글은 피드에서 실시간으로 가져온 postId를 쓰니
// 환경이 달라도 항상 유효했지만, 새 글은 이 하드코딩된 categoryId를 그대로 썼기 때문.
// Reafy에 카테고리 목록을 조회하는 공개 API가 없어서(확인 안 됨) 계속 하드코딩에 의존한다 —
// 나중에 다른 Reafy 인스턴스로 다시 옮기면 이 값도 다시 DB에서 확인해서 갱신해야 한다.
export const DEFAULT_CATEGORIES: ReafyCategory[] = [
  { id: '5db38378-8a37-4ed8-8d77-9ab431513708', name: '자유·일상', slug: 'chat' },
  { id: 'ec5b8750-9e06-448d-b251-c459c97b1275', name: '정치·이슈', slug: 'issue' },
  { id: 'b525b26c-2882-4291-9253-8a1065189e5b', name: '유머', slug: 'humor' },
  { id: 'a2eec545-7b34-46c7-acc0-88a6f0889d85', name: '건강·운동', slug: 'health' },
  { id: '2babd3ca-2c7e-4f50-b540-33c07487d280', name: '뷰티·패션', slug: 'shopping' },
  { id: '22decd29-421e-435e-aeb3-b019f058b904', name: '음식·요리', slug: 'cooking' },
  { id: 'f4af95f2-c4d7-4215-a64e-cdd23c0dc932', name: '반려동물', slug: 'pets' },
  { id: '0fed577a-4351-4f90-88e6-d12b974264cd', name: '연예·방송', slug: 'broadcast' },
  { id: 'd4df2c20-5b98-4ab6-a397-56de383bf0a4', name: '여행·레저', slug: 'travel' },
  { id: '687b6586-fbfd-4aaa-8180-8d8f2532d238', name: '테크·AI', slug: 'tech' },
  { id: 'b31981c2-2384-4d2b-ae0e-5927f0a86341', name: '게임·취미', slug: 'hobby' },
  { id: 'b26cea7f-e7bf-4959-bf37-560deae3dd86', name: '재테크·투자', slug: 'invest' },
  { id: '045491fa-696f-48aa-81dc-c8f2962f7959', name: '핫딜·쇼핑', slug: 'hotdeals' },
  { id: 'f9cb8df5-3c4a-44d8-9596-1ccb10b41e3b', name: '커리어', slug: 'careers' },
  { id: '843186ab-52f3-486a-bea1-b77a350e0460', name: '창업·N잡', slug: 'startup' },
];

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export class ReafyClient {
  private baseUrl: string;
  private sessionCookie: string | null = null;
  private persona: AgentPersona;
  private db: DatabaseSync;

  constructor(
    persona: AgentPersona,
    baseUrl: string = config.reafy.baseUrl,
    storageDir: string = path.resolve(process.cwd(), 'data')
  ) {
    this.persona = persona;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.db = openDatabase(storageDir);
    this.sessionCookie = this.loadSavedSession(persona.id);
  }

  private loadSavedSession(agentId: string): string | null {
    try {
      const row = this.db.prepare(`SELECT session_token FROM sessions WHERE agent_id = ?`).get(agentId) as
        | { session_token: string }
        | undefined;
      return row?.session_token ?? null;
    } catch {
      return null;
    }
  }

  private saveSession(agentId: string, sessionToken: string): void {
    try {
      this.db
        .prepare(`INSERT INTO sessions (agent_id, session_token) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET session_token = excluded.session_token`)
        .run(agentId, sessionToken);
    } catch (err) {
      console.error(`[ReafyClient] Failed to save session token:`, err);
    }
  }

  /**
   * 안정적인 HTTP/HTTPS 요청 헬퍼
   */
  private request(urlStr: string, options: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const postData = options.body;
      const headers: Record<string, any> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'application/json, text/plain, */*',
        ...options.headers,
      };

      if (postData) {
        headers['Content-Length'] = Buffer.byteLength(postData);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: options.method || 'GET',
          headers,
          timeout: 10000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 500, headers: res.headers, body }));
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout to ${urlStr}`));
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  private extractCookie(setCookieHeaders: string | string[] | undefined): string | null {
    if (!setCookieHeaders) return null;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of list) {
      const match = header.match(/reafy_session=([^;]+)/);
      if (match) return match[1];
    }
    return null;
  }

  public async signup(): Promise<{ ok: boolean; error?: string }> {
    try {
      const payload = JSON.stringify({
        email: this.persona.email,
        password: this.persona.password,
        nickname: this.persona.nickname,
        birthdate: this.persona.birthdate || '1995-05-15',
        country: this.persona.country || 'US',
        postalCode: this.persona.postalCode || '95008',
      });

      const res = await this.request(`${this.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const token = this.extractCookie(res.headers['set-cookie']);
      if (token) {
        this.sessionCookie = token;
        this.saveSession(this.persona.id, token);
      }

      if (res.status === 201 || res.status === 200) {
        return { ok: true };
      }

      const data = JSON.parse(res.body || '{}');
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async login(): Promise<{ ok: boolean; error?: string }> {
    try {
      const payload = JSON.stringify({
        email: this.persona.email,
        password: this.persona.password,
      });

      const res = await this.request(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const token = this.extractCookie(res.headers['set-cookie']);
      if (token) {
        this.sessionCookie = token;
        this.saveSession(this.persona.id, token);
      }

      if (res.status === 200) {
        return { ok: true };
      }

      const data = JSON.parse(res.body || '{}');
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async ensureAuthenticated(): Promise<boolean> {
    // 1. 저장된 세션이 있다면 세션 유효성 검사
    if (this.sessionCookie) {
      try {
        const sessionCheck = await this.request(`${this.baseUrl}/api/auth/session`, {
          headers: { Cookie: `reafy_session=${this.sessionCookie}` },
        });
        if (sessionCheck.status === 200) {
          return true;
        }
      } catch {}
    }

    // 2. 먼저 로그인 시도
    const loginRes = await this.login();
    if (loginRes.ok && this.sessionCookie) {
      return true;
    }

    // 3. 로그인이 안 된다면 가입 시도
    const signupRes = await this.signup();
    if (signupRes.ok && this.sessionCookie) {
      return true;
    }

    // 4. 가입에서 EMAIL_TAKEN이 떴다면 다시 로그인 재시도
    if (signupRes.error === 'EMAIL_TAKEN') {
      const retryLogin = await this.login();
      if (retryLogin.ok && this.sessionCookie) {
        return true;
      }
    }

    console.error(`[ReafyClient:${this.persona.nickname}] Auth failed: login(${loginRes.error}), signup(${signupRes.error})`);
    return false;
  }

  public async getFeed(options?: { categorySlug?: string; sort?: 'latest' | 'popular'; limit?: number }): Promise<ReafyPost[]> {
    try {
      const url = new URL(`${this.baseUrl}/api/feed`);
      if (options?.categorySlug) url.searchParams.set('category', options.categorySlug);
      url.searchParams.set('sort', options?.sort || 'latest');
      url.searchParams.set('limit', String(options?.limit || 20));

      const headers: Record<string, string> = {};
      if (this.sessionCookie) {
        headers['Cookie'] = `reafy_session=${this.sessionCookie}`;
      }

      const res = await this.request(url.toString(), { headers });
      if (res.status !== 200) return [];

      const data = JSON.parse(res.body) as { posts: ReafyPost[] };
      return data.posts || [];
    } catch (err) {
      console.error(`[ReafyClient] getFeed error:`, err);
      return [];
    }
  }

  /**
   * 글의 댓글 목록 조회 (대댓글/댓글 좋아요 대상 파악용).
   * 엔드포인트는 기존 API 패턴(POST /api/posts, /api/comments)에서 유추한 것 — 실제 서버에서
   * 다르면 여기만 고치면 됨. 실패 시 예외를 던지지 않고 빈 배열(getFeed와 동일 패턴).
   */
  public async getComments(postId: string): Promise<ReafyComment[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.sessionCookie) {
        headers['Cookie'] = `reafy_session=${this.sessionCookie}`;
      }

      const res = await this.request(`${this.baseUrl}/api/posts/${postId}/comments`, { headers });
      if (res.status !== 200) return [];

      const data = JSON.parse(res.body) as { comments: ReafyComment[] };
      return data.comments || [];
    } catch (err) {
      console.error(`[ReafyClient] getComments error:`, err);
      return [];
    }
  }

  public async createPost(params: {
    categoryId: string;
    title: string;
    body: string;
  }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) {
      return { ok: false, error: 'Authentication failed' };
    }

    try {
      const res = await this.request(`${this.baseUrl}/api/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `reafy_session=${this.sessionCookie}`,
        },
        body: JSON.stringify({
          categoryId: params.categoryId,
          title: params.title,
          body: params.body,
        }),
      });

      const data = JSON.parse(res.body || '{}');
      if (res.status === 201 && data.id) {
        return { ok: true, id: data.id };
      }
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** 브라우저에서 실제 "글 삭제" 버튼을 눌러 캡처한 요청(DELETE /api/posts/:id, 세션 쿠키만 필요)을 재현. */
  public async deletePost(postId: string): Promise<{ ok: boolean; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) {
      return { ok: false, error: 'Authentication failed' };
    }

    try {
      const res = await this.request(`${this.baseUrl}/api/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `reafy_session=${this.sessionCookie}`,
        },
      });

      if (res.status === 200) return { ok: true };
      return { ok: false, error: `HTTP ${res.status}: ${res.body}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * 프로필 아바타 URL 설정. 브라우저에서 실제 "프로필 편집" 폼을 채우고 저장하며 캡처한
   * PATCH /api/profile 요청(JSON, 파일 업로드 아님)을 재현 — avatarUrl은 외부 URL을 그대로
   * 줘도 그대로 반영됨(직접 curl로 검증함, R2 재업로드 불필요).
   * 이 엔드포인트는 부분 patch가 아니라 전체 프로필 객체를 기대해서, 우리가 확실히 아는
   * 값(닉네임/국가/우편번호)만 그대로 채우고 나머지(username)는 우리가 signup 시 이메일로
   * 만든 값과 일치하는 걸로 확인된 규칙(이메일 로컬파트에서 점 제거)으로 유도한다.
   */
  /** 페르소나의 현재 Reafy 유저네임. 개명됐으면 저장된 값, 아니면 가입 때와 같은 유도 규칙. */
  public get currentUsername(): string {
    return this.persona.username || this.persona.email.split('@')[0].replace(/\./g, '');
  }

  /**
   * 현재 프로필 조회. CLAUDE.md에는 404라고 적혀 있었지만 2026-09-14 확인 결과 401(=존재하되
   * 인증 필요)이라 세션 쿠키가 있으면 읽힌다. PATCH가 전체 객체를 요구하는데 우리가 모르는
   * 필드(intro 등)를 빈 값으로 덮어쓰지 않으려면 먼저 읽어야 해서 추가했다.
   * 서버가 또 바뀌어 못 읽게 되면 null을 주고, 호출부는 페르소나 값으로 폴백한다.
   */
  public async getProfile(): Promise<Record<string, any> | null> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return null;

    try {
      const res = await this.request(`${this.baseUrl}/api/profile`, {
        headers: { Cookie: `reafy_session=${this.sessionCookie}` },
      });
      if (res.status !== 200) return null;
      const data = JSON.parse(res.body);
      return data.profile ?? data.user ?? data;
    } catch {
      return null;
    }
  }

  public async updateProfile(params: {
    avatarUrl?: string;
    nickname?: string;
    username?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) {
      return { ok: false, error: 'Authentication failed' };
    }

    // 부분 patch가 아니라서 안 바꿀 필드도 현재 값 그대로 실어보내야 한다. 읽히면 서버 값을
    // 쓰고(intro 같은 걸 날리지 않게), 못 읽으면 예전처럼 페르소나 값으로 채운다.
    const current = (await this.getProfile()) ?? {};

    try {
      const res = await this.request(`${this.baseUrl}/api/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `reafy_session=${this.sessionCookie}`,
        },
        body: JSON.stringify({
          nickname: params.nickname ?? current.nickname ?? this.persona.nickname,
          intro: current.intro ?? '',
          visibility: current.visibility ?? 'public',
          username: params.username ?? this.currentUsername,
          country: current.country ?? this.persona.country,
          postalCode: current.postalCode ?? this.persona.postalCode,
          avatarUrl: params.avatarUrl ?? current.avatarUrl ?? this.persona.avatarUrl ?? '',
        }),
      });

      if (res.status === 200) return { ok: true };
      const data = JSON.parse(res.body || '{}');
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async createComment(params: {
    postId: string;
    body: string;
    parentCommentId?: string | null;
  }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) {
      return { ok: false, error: 'Authentication failed' };
    }

    try {
      const res = await this.request(`${this.baseUrl}/api/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `reafy_session=${this.sessionCookie}`,
        },
        body: JSON.stringify({
          postId: params.postId,
          body: params.body,
          parentCommentId: params.parentCommentId || null,
        }),
      });

      const data = JSON.parse(res.body || '{}');
      if (res.status === 201 && data.id) {
        return { ok: true, id: data.id };
      }
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async toggleReaction(
    postId: string,
    emoticonType = 'empathy'
  ): Promise<{ ok: boolean; reaction?: string | null; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) {
      return { ok: false, error: 'not authenticated' };
    }

    try {
      const res = await this.request(`${this.baseUrl}/api/intent/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `reafy_session=${this.sessionCookie}`,
        },
        body: JSON.stringify({
          intent: {
            action: 'reaction',
            targetId: postId,
            returnTo: '/',
            emoticonType,
          },
          confirmed: true,
        }),
      });

      if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}: ${res.body}` };
      const data = JSON.parse(res.body);
      if (data.status !== 'executed') {
        // HTTP 200이어도 실제 처리는 안 된 경우(이메일 미인증, 대상 글에 반응 불가 등) —
        // data.status를 그대로 안 남기면 "알 수 없는 오류"로만 찍혀서 원인 추적이 안 된다.
        return { ok: false, error: `status=${data.status ?? 'unknown'}: ${res.body}` };
      }
      return { ok: true, reaction: data.reaction };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async toggleCommentReaction(commentId: string): Promise<{ ok: boolean; reacted?: boolean; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'not authenticated' };

    try {
      const res = await this.request(`${this.baseUrl}/api/comments/${commentId}/reaction`, {
        method: 'POST',
        headers: {
          Cookie: `reafy_session=${this.sessionCookie}`,
        },
      });

      if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}: ${res.body}` };
      const data = JSON.parse(res.body);
      return { ok: true, reacted: data.reacted };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public getCategoryBySlug(slug: string): ReafyCategory | undefined {
    return DEFAULT_CATEGORIES.find((c) => c.slug === slug);
  }

  public getRandomCategory(preferredSlugs?: string[]): ReafyCategory {
    if (preferredSlugs && preferredSlugs.length > 0) {
      const preferred = DEFAULT_CATEGORIES.filter((c) => preferredSlugs.includes(c.slug));
      if (preferred.length > 0) {
        return preferred[Math.floor(Math.random() * preferred.length)];
      }
    }
    return DEFAULT_CATEGORIES[Math.floor(Math.random() * DEFAULT_CATEGORIES.length)];
  }
}
