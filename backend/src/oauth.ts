/**
 * 소셜 로그인 — Google · GitHub (2026-10-26, 사용자 지시로 추가 — PLAN.md의
 * "로그인 결합 금지" 1차 원칙을 이번 요청으로 재정의함).
 *
 * 필요한 env var (레포에 없음, 배포 환경마다 직접 채운다):
 *
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *     → https://console.cloud.google.com/apis/credentials 에서
 *       "OAuth 클라이언트 ID" 생성(애플리케이션 유형: 웹 애플리케이션).
 *       승인된 리디렉션 URI에 `${OAUTH_REDIRECT_BASE}/api/auth/google/callback` 등록.
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 *     → https://github.com/settings/developers → "New OAuth App".
 *       Authorization callback URL에 `${OAUTH_REDIRECT_BASE}/api/auth/github/callback` 등록.
 *   OAUTH_REDIRECT_BASE
 *     → 콜백 URL의 오리진(이 백엔드의 공개 주소). 로컬 http://localhost:3010,
 *       프로덕션 https://api.goodfriends.co.
 *
 * state 파라미터는 CSRF 방지용 — 새 세션 종류 없이 짧은 TTL의 Redis 키로
 * "이 콜백이 우리가 시작한 플로우인지"만 확인한다(Reafy의 oauth.ts와 같은
 * 패턴). Google·GitHub 둘 다 PKCE가 필수는 아니라 안 쓴다.
 */
import { randomBytes } from 'node:crypto';
import { redis } from './redis.ts';
import type { OAuthProfile } from './auth.ts';

export type Provider = 'google' | 'github';

const STATE_TTL_SECONDS = 10 * 60;

function redirectBase(): string {
  return process.env.OAUTH_REDIRECT_BASE ?? 'http://localhost:3010';
}

function callbackUrl(provider: Provider): string {
  return `${redirectBase()}/api/auth/${provider}/callback`;
}

async function createState(): Promise<string> {
  const state = randomBytes(16).toString('base64url');
  await redis().set(`oauth_state:${state}`, '1', 'EX', STATE_TTL_SECONDS);
  return state;
}

/** state 존재 확인 + 1회성 소비(재사용 방지). */
export async function consumeOAuthState(state: string | null): Promise<boolean> {
  if (!state) return false;
  const key = `oauth_state:${state}`;
  const value = await redis().get(key);
  if (value === null) return false;
  await redis().del(key);
  return true;
}

export async function getAuthorizationUrl(provider: Provider): Promise<string> {
  const state = await createState();
  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', callbackUrl('google'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return url.toString();
  }
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', callbackUrl('github'));
  // user:email — GitHub 프로필이 이메일을 비공개로 해둔 경우 /user/emails로
  // 따로 받아야 한다(아래 exchangeGithubCode 참고).
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeGoogleCode(code: string): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl('google'),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`google token exchange failed: ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error(`google userinfo failed: ${profileRes.status}`);
  const profile = (await profileRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean | string; // OIDC 표준상 boolean이지만 일부 응답은 문자열로 온다
    name?: string;
    given_name?: string;
    picture?: string;
  };

  return {
    provider: 'google',
    providerUserId: profile.sub,
    email: profile.email ?? null,
    emailVerified: profile.email_verified === true || profile.email_verified === 'true',
    nickname: profile.name ?? profile.given_name ?? null,
    avatarUrl: profile.picture ?? null,
  };
}

async function exchangeGithubCode(code: string): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    // 🔒 Accept 없으면 GitHub가 기본으로 form-urlencoded 바디를 돌려준다 —
    // JSON으로 받으려면 명시해야 한다.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GITHUB_CLIENT_ID ?? '',
      client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl('github'),
    }),
  });
  if (!tokenRes.ok) throw new Error(`github token exchange failed: ${tokenRes.status}`);
  const { access_token, error } = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!access_token) throw new Error(`github token exchange failed: ${error ?? 'no access_token'}`);

  // 🔒 GitHub API는 User-Agent 없는 요청을 거부한다.
  const headers = { Authorization: `Bearer ${access_token}`, 'User-Agent': 'goodfriends-oauth' };
  const profileRes = await fetch('https://api.github.com/user', { headers });
  if (!profileRes.ok) throw new Error(`github userinfo failed: ${profileRes.status}`);
  const profile = (await profileRes.json()) as { id: number; login: string; name?: string | null; avatar_url?: string; email?: string | null };

  // 🔒 프로필의 email은 유저가 "Keep my email private"를 켜두면 null이다 —
  // /user/emails(scope: user:email)로 검증된 primary 이메일을 따로 받는다.
  let email: string | null = profile.email ?? null;
  let emailVerified = false;
  const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const primary = emails.find((e) => e.primary) ?? emails.find((e) => e.verified);
    if (primary) {
      email = primary.email;
      emailVerified = primary.verified;
    }
  }

  return {
    provider: 'github',
    providerUserId: String(profile.id),
    email,
    emailVerified,
    nickname: profile.name ?? profile.login ?? null,
    avatarUrl: profile.avatar_url ?? null,
  };
}

export async function exchangeCodeForProfile(provider: Provider, code: string): Promise<OAuthProfile> {
  return provider === 'google' ? exchangeGoogleCode(code) : exchangeGithubCode(code);
}
