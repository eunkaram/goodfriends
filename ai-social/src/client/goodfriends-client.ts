import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import type { AgentPersona, CommunityPost, CommunityCategory, CommunityComment } from '../types.js';
import { openDatabase } from '../db/database.js';

// goodfriends backend API 클라이언트. reafy-ai-social의 Reafy 클라이언트를 이식·교체한 것이다
// (원본 출처). 계약 근거는 README.md "goodfriends API 계약" 표(backend/src 파일:줄) 참고.
//
// 인증: POST /api/auth/signup·login 응답 바디의 token(= aic_session 쿠키 값과 같은 값)을
// `Authorization: Bearer <token>`으로 보낸다(backend/src/session.ts resolveSessionToken).
// 글·댓글 식별자: 피드의 publicId를 `CommunityPost.id`로 쓴다 — 글 상세 GET이 publicId만 받고,
// 댓글/공감/삭제 라우트는 publicId·uuid 둘 다 해석해 주기 때문에 publicId 하나로 통일된다.

/** 이메일 미인증 계정의 글/댓글/공감이 거부될 때 서버가 쓰는 에러코드. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';
/** 가입 시 이메일 중복 에러코드 (backend/src/auth.ts signUpWithEmail). */
export const EMAIL_TAKEN = 'EMAIL_TAKEN';

/** 뉴스봇 전용 카테고리 slug — is_agent/운영진만 쓸 수 있어 에이전트 글 대상에서 기본 제외. */
const NEWS_CATEGORY_SLUGS = new Set(['news', 'ai-news']);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10000;

/** 서버가 가입 때 만드는 username 유도 규칙(auth.ts uniqueUsernameFrom의 첫 후보): 로컬파트 소문자, [a-z0-9_]만, 20자. 중복이면 서버가 숫자를 붙이므로 근사값이다. */
export function deriveUsername(email: string): string {
  return (
    email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20) || 'user'
  );
}

/** 담당 slug에 해당하는 카테고리만 고른다(news 제외, 일치 없으면 null — 무작위 폴백 없음). */
export function pickPostingCategory(categories: CommunityCategory[], preferredSlugs: string[]): CommunityCategory | null {
  const preferred = categories.filter((c) => !NEWS_CATEGORY_SLUGS.has(c.slug) && preferredSlugs.includes(c.slug));
  if (preferred.length === 0) return null;
  return preferred[Math.floor(Math.random() * preferred.length)];
}

interface ApiResult {
  status: number;
  data: Record<string, any>;
  /** 원문(JSON이 아닐 때 로그용). */
  text: string;
}

async function callApi(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<ApiResult> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await res.text();
  let data: Record<string, any> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {
    // JSON이 아닌 응답(프록시 에러 페이지 등) — data는 비워 두고 호출부가 status/text로 처리
  }
  return { status: res.status, data, text };
}

function errorCode(r: ApiResult): string {
  return typeof r.data.error === 'string' ? r.data.error : `HTTP ${r.status}`;
}

function mapPost(raw: Record<string, any>): CommunityPost {
  return {
    // 외부 식별자(publicId)를 id로 — 파일 상단 주석 참고. 내부 uuid는 internalId로 보존.
    id: String(raw.publicId ?? raw.id),
    internalId: raw.id ? String(raw.id) : undefined,
    title: raw.title ?? '',
    bodyPreview: raw.bodyPreview ?? raw.body ?? '',
    authorId: raw.authorId ?? '',
    authorUsername: raw.authorUsername ?? '',
    authorNickname: raw.authorNickname ?? '',
    authorAvatarUrl: raw.authorAvatarUrl || undefined,
    authorIsAgent: typeof raw.authorIsAgent === 'boolean' ? raw.authorIsAgent : undefined,
    categoryName: raw.categoryName ?? '',
    categorySlug: raw.categorySlug ?? '',
    createdAt: raw.createdAt ?? '',
    reactionCount: Number(raw.reactionCount ?? 0),
    commentCount: Number(raw.commentCount ?? 0),
  };
}

function mapComment(raw: Record<string, any>, postId: string): CommunityComment {
  return {
    id: String(raw.id),
    postId,
    authorId: raw.authorId ?? '',
    authorUsername: raw.authorUsername ?? '',
    authorNickname: raw.authorNickname ?? '',
    body: raw.body ?? '',
    createdAt: raw.createdAt ?? '',
    reactionCount: Number(raw.reactionCount ?? 0),
    myReaction: Boolean(raw.myReaction),
    parentCommentId: raw.parentCommentId ?? null,
  };
}

/**
 * GET /api/categories (공개) — 공개·커뮤니티·leaf 카테고리의 평평한 목록 {categories:[{id,slug,name}]}.
 * 대시보드처럼 클라이언트 인스턴스 없이 목록만 필요한 곳에서 쓴다. 실패하면 빈 배열.
 */
export async function fetchCategories(
  baseUrl: string = config.goodfriends.baseUrl,
  fetchImpl: FetchLike = globalThis.fetch
): Promise<CommunityCategory[]> {
  try {
    const r = await callApi(fetchImpl, `${baseUrl.replace(/\/$/, '')}/api/categories`);
    if (r.status !== 200 || !Array.isArray(r.data.categories)) return [];
    return r.data.categories.map((c: any) => ({ id: String(c.id), slug: String(c.slug), name: String(c.name) }));
  } catch (err) {
    console.error(`[GoodfriendsClient] fetchCategories error:`, err);
    return [];
  }
}

export class GoodfriendsClient {
  private baseUrl: string;
  private sessionToken: string | null = null;
  private persona: AgentPersona;
  private db: DatabaseSync;
  private fetchImpl: FetchLike;
  private categoriesCache: CommunityCategory[] | null = null;

  constructor(
    persona: AgentPersona,
    baseUrl: string = config.goodfriends.baseUrl,
    storageDir: string = path.resolve(process.cwd(), 'data'),
    fetchImpl: FetchLike = globalThis.fetch
  ) {
    this.persona = persona;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.db = openDatabase(storageDir);
    this.fetchImpl = fetchImpl;
    this.sessionToken = this.loadSavedSession(persona.id);
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
      console.error(`[GoodfriendsClient] Failed to save session token:`, err);
    }
  }

  private url(pathAndQuery: string): string {
    return `${this.baseUrl}${pathAndQuery}`;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return this.sessionToken ? { Authorization: `Bearer ${this.sessionToken}`, ...extra } : extra;
  }

  private jsonInit(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    };
  }

  /** 미인증(is_agent 아님 + 이메일 미인증)으로 쓰기가 거부됐을 때 원인이 로그에 명확히 남게 한다. */
  private logIfEmailNotVerified(action: string, code: string): void {
    if (code === EMAIL_NOT_VERIFIED) {
      console.error(
        `[GoodfriendsClient:${this.persona.nickname}] ${action} 거부: EMAIL_NOT_VERIFIED — 이 계정은 이메일 미인증이고 is_agent도 아닙니다. ` +
          `/admin에서 is_agent로 전환해야 합니다.`
      );
    }
  }

  private async authResult(path: string, payload: Record<string, unknown>, okStatuses: number[]): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await callApi(this.fetchImpl, this.url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (okStatuses.includes(r.status)) {
        const token = typeof r.data.token === 'string' ? r.data.token : null;
        if (token) {
          this.sessionToken = token;
          this.saveSession(this.persona.id, token);
        }
        return { ok: true };
      }
      return { ok: false, error: errorCode(r) };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * 이메일 가입. 서버는 가입 직후 세션 token을 바디로 준다. 생년월일·국가·우편번호는 서버에서
   * 선택값이라 페르소나에 있을 때만 보낸다. 온보딩은 소셜 가입 전용이라 별도 단계가 없다.
   */
  public async signup(): Promise<{ ok: boolean; error?: string }> {
    const payload: Record<string, unknown> = {
      email: this.persona.email,
      password: this.persona.password,
      nickname: this.persona.nickname,
    };
    if (this.persona.birthdate) payload.birthdate = this.persona.birthdate;
    if (this.persona.country) payload.country = this.persona.country;
    if (this.persona.postalCode) payload.postalCode = this.persona.postalCode;
    return this.authResult('/api/auth/signup', payload, [201, 200]);
  }

  public async login(): Promise<{ ok: boolean; error?: string }> {
    return this.authResult('/api/auth/login', { email: this.persona.email, password: this.persona.password }, [200]);
  }

  public async ensureAuthenticated(): Promise<boolean> {
    // 1. 저장된 세션이 있다면 세션 유효성 검사
    if (this.sessionToken) {
      try {
        const check = await callApi(this.fetchImpl, this.url('/api/auth/session'), { headers: this.authHeaders() });
        if (check.status === 200) return true;
      } catch {}
    }

    // 2. 먼저 로그인 시도
    const loginRes = await this.login();
    if (loginRes.ok && this.sessionToken) return true;

    // 3. 로그인이 안 된다면 가입 시도
    const signupRes = await this.signup();
    if (signupRes.ok && this.sessionToken) return true;

    // 4. 가입에서 EMAIL_TAKEN이 떴다면 다시 로그인 재시도
    if (signupRes.error === EMAIL_TAKEN) {
      const retryLogin = await this.login();
      if (retryLogin.ok && this.sessionToken) return true;
    }

    console.error(`[GoodfriendsClient:${this.persona.nickname}] Auth failed: login(${loginRes.error}), signup(${signupRes.error})`);
    return false;
  }

  /** 홈 피드 또는 카테고리 피드(slug). 알 수 없는 slug면 서버가 404 → 빈 배열. */
  public async getFeed(options?: { categorySlug?: string; sort?: 'latest' | 'popular'; limit?: number }): Promise<CommunityPost[]> {
    try {
      const params = new URLSearchParams();
      if (options?.categorySlug) params.set('category', options.categorySlug);
      params.set('sort', options?.sort || 'latest');
      params.set('limit', String(options?.limit || 20));

      const r = await callApi(this.fetchImpl, this.url(`/api/feed?${params.toString()}`), { headers: this.authHeaders() });
      if (r.status !== 200 || !Array.isArray(r.data.posts)) return [];
      return r.data.posts.map(mapPost);
    } catch (err) {
      console.error(`[GoodfriendsClient] getFeed error:`, err);
      return [];
    }
  }

  /**
   * 글의 댓글 목록. 별도 댓글 목록 라우트는 없고 글 상세(GET /api/posts/:publicId)가
   * {post, comments}를 함께 준다. 실패 시 예외 없이 빈 배열.
   */
  public async getComments(postId: string): Promise<CommunityComment[]> {
    try {
      const r = await callApi(this.fetchImpl, this.url(`/api/posts/${encodeURIComponent(postId)}`), { headers: this.authHeaders() });
      if (r.status !== 200 || !Array.isArray(r.data.comments)) return [];
      return r.data.comments.map((c: Record<string, any>) => mapComment(c, postId));
    } catch (err) {
      console.error(`[GoodfriendsClient] getComments error:`, err);
      return [];
    }
  }

  /** 글 상세(본문 전체 포함). 못 읽으면 null. */
  public async getPostDetail(postId: string): Promise<{ post: Record<string, any>; comments: CommunityComment[] } | null> {
    try {
      const r = await callApi(this.fetchImpl, this.url(`/api/posts/${encodeURIComponent(postId)}`), { headers: this.authHeaders() });
      if (r.status !== 200 || !r.data.post) return null;
      const comments = Array.isArray(r.data.comments) ? r.data.comments.map((c: Record<string, any>) => mapComment(c, postId)) : [];
      return { post: r.data.post, comments };
    } catch {
      return null;
    }
  }

  /** 본문은 플레인 텍스트(빈 줄로 문단 구분). 응답 id는 publicId. */
  public async createPost(params: {
    categoryId: string;
    title: string;
    body: string;
  }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'Authentication failed' };

    try {
      const r = await callApi(
        this.fetchImpl,
        this.url('/api/posts'),
        this.jsonInit('POST', { categoryId: params.categoryId, title: params.title, body: params.body })
      );
      if (r.status === 201 && (r.data.publicId || r.data.id)) {
        return { ok: true, id: String(r.data.publicId ?? r.data.id) };
      }
      const code = errorCode(r);
      this.logIfEmailNotVerified('글 작성', code);
      return { ok: false, error: code };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** DELETE /api/posts/:id (publicId·uuid 모두 허용, 본인 글만 — 남의 글/없는 글은 404 NOT_FOUND). */
  public async deletePost(postId: string): Promise<{ ok: boolean; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'Authentication failed' };

    try {
      const r = await callApi(this.fetchImpl, this.url(`/api/posts/${encodeURIComponent(postId)}`), {
        method: 'DELETE',
        headers: this.authHeaders(),
      });
      if (r.status === 200) return { ok: true };
      return { ok: false, error: errorCode(r) };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** 페르소나의 현재 goodfriends username. 개명됐으면 저장된 값, 아니면 서버의 가입 유도 규칙 근사값. */
  public get currentUsername(): string {
    return this.persona.username || deriveUsername(this.persona.email);
  }

  /**
   * 내 프로필 조회(GET /api/profile). 응답은 {userId, username, nickname, intro, visibility,
   * avatarUrl, country, postalCode, ...}. 읽지 못하면 null.
   */
  public async getProfile(): Promise<Record<string, any> | null> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return null;

    try {
      const r = await callApi(this.fetchImpl, this.url('/api/profile'), { headers: this.authHeaders() });
      if (r.status !== 200) return null;
      return r.data;
    } catch {
      return null;
    }
  }

  /**
   * 프로필 수정(PATCH /api/profile). goodfriends는 부분 patch를 받으므로(필드 전부 optional)
   * 바꿀 필드만 보낸다 — 예전처럼 전체 객체를 읽어 되돌려 보낼 필요가 없다.
   * username 중복은 409 USERNAME_TAKEN. 에러코드는 그대로 error에 담는다.
   */
  public async updateProfile(params: {
    avatarUrl?: string;
    nickname?: string;
    username?: string;
    intro?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'Authentication failed' };

    const body: Record<string, string> = {};
    if (params.nickname !== undefined) body.nickname = params.nickname;
    if (params.username !== undefined) body.username = params.username;
    if (params.avatarUrl !== undefined) body.avatarUrl = params.avatarUrl;
    if (params.intro !== undefined) body.intro = params.intro;

    try {
      const r = await callApi(this.fetchImpl, this.url('/api/profile'), this.jsonInit('PATCH', body));
      if (r.status === 200) return { ok: true };
      return { ok: false, error: errorCode(r) };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** POST /api/comments. 답글은 1-depth만(parentCommentId가 최상위 댓글이어야 함, 아니면 400 INVALID_INPUT). 시간당 30개 제한(429 RATE_LIMITED). */
  public async createComment(params: {
    postId: string;
    body: string;
    parentCommentId?: string | null;
  }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'Authentication failed' };

    try {
      const r = await callApi(
        this.fetchImpl,
        this.url('/api/comments'),
        this.jsonInit('POST', { postId: params.postId, body: params.body, parentCommentId: params.parentCommentId || null })
      );
      if (r.status === 201 && r.data.id) return { ok: true, id: String(r.data.id) };
      const code = errorCode(r);
      this.logIfEmailNotVerified('댓글 작성', code);
      return { ok: false, error: code };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** 글 공감 토글: POST /api/intent/execute {action:'reaction'}. 같은 이모티콘을 다시 보내면 해제(reaction:null). */
  public async toggleReaction(
    postId: string,
    emoticonType = 'empathy'
  ): Promise<{ ok: boolean; reaction?: string | null; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'not authenticated' };

    try {
      const r = await callApi(
        this.fetchImpl,
        this.url('/api/intent/execute'),
        this.jsonInit('POST', {
          intent: { action: 'reaction', targetId: postId, returnTo: '/', emoticonType },
          confirmed: true,
        })
      );
      if (r.status !== 200) return { ok: false, error: `${errorCode(r)}: ${r.text}` };
      if (r.data.status === 'email_not_verified') {
        // 이 라우트만 403이 아니라 HTTP 200 + status로 거부한다(intent-http.ts).
        this.logIfEmailNotVerified('공감', EMAIL_NOT_VERIFIED);
        return { ok: false, error: EMAIL_NOT_VERIFIED };
      }
      if (r.data.status !== 'executed') {
        // HTTP 200이어도 처리 안 된 경우(blocked 등) — status를 그대로 남겨야 원인 추적이 된다.
        return { ok: false, error: `status=${r.data.status ?? 'unknown'}: ${r.text}` };
      }
      return { ok: true, reaction: r.data.reaction ?? null };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** 댓글 공감 토글: POST /api/comments/:id/reaction → {reacted}. 댓글 id는 uuid여야 한다(아니면 400). */
  public async toggleCommentReaction(commentId: string): Promise<{ ok: boolean; reacted?: boolean; error?: string }> {
    const isAuth = await this.ensureAuthenticated();
    if (!isAuth) return { ok: false, error: 'not authenticated' };

    try {
      const r = await callApi(this.fetchImpl, this.url(`/api/comments/${encodeURIComponent(commentId)}/reaction`), {
        method: 'POST',
        headers: this.authHeaders(),
      });
      if (r.status !== 200) {
        const code = errorCode(r);
        this.logIfEmailNotVerified('댓글 공감', code);
        return { ok: false, error: code };
      }
      return { ok: true, reacted: r.data.reacted };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** 공개 카테고리(leaf·커뮤니티) 목록을 한 번 가져와 캐시한다. 실패하면 캐시하지 않고 빈 배열. */
  public async getCategories(): Promise<CommunityCategory[]> {
    if (this.categoriesCache) return this.categoriesCache;
    const list = await fetchCategories(this.baseUrl, this.fetchImpl);
    if (list.length > 0) this.categoriesCache = list;
    return list;
  }

  public async getCategoryBySlug(slug: string): Promise<CommunityCategory | undefined> {
    return (await this.getCategories()).find((c) => c.slug === slug);
  }

  /**
   * 글을 올릴 카테고리를 고른다. 선호 slug 중 서버에 있는 것을 우선하고, 없으면 News 전용을 뺀 전체에서
   * 무작위. 카테고리를 못 가져오면 null(호출부가 글쓰기를 건너뛴다).
   */
  /**
   * 신규 글을 올릴 카테고리. 페르소나가 담당 slug로 고정돼 있으므로 preferredSlugs와 일치하는 것만 반환한다
   * (무작위 폴백 없음 — 담당이 아닌 곳에 쓰면 안 된다). 뉴스 카테고리는 항상 제외, 없으면 null.
   */
  public async getPostingCategory(preferredSlugs: string[]): Promise<CommunityCategory | null> {
    return pickPostingCategory(await this.getCategories(), preferredSlugs);
  }

  public async getRandomCategory(preferredSlugs?: string[]): Promise<CommunityCategory | null> {
    const all = (await this.getCategories()).filter((c) => !NEWS_CATEGORY_SLUGS.has(c.slug));
    if (all.length === 0) return null;
    if (preferredSlugs && preferredSlugs.length > 0) {
      const preferred = all.filter((c) => preferredSlugs.includes(c.slug));
      if (preferred.length > 0) return preferred[Math.floor(Math.random() * preferred.length)];
    }
    return all[Math.floor(Math.random() * all.length)];
  }
}
