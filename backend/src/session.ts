/**
 * 로그인 세션 — §6.1
 *
 * intent-session.ts(§11.9.2)와 같은 패턴(Redis 저장, HttpOnly 쿠키)이지만
 * 목적이 다르다 — 이건 30분짜리 1회성 의도 저장소가 아니라 실제 로그인
 * 상태다. 세션 토큰은 불투명 랜덤값이고, Redis에 `session:{token} -> userId`
 * 로만 저장한다(JWT 아님 — 즉시 폐기(로그아웃)가 폐기 목록 없이 바로 되어야
 * 하므로 서버 보유 세션을 쓴다).
 *
 * 🔒 이 토큰에서 유도된 userId만 §4.5 RLS 세션 컨텍스트(app.user_id)에
 * 주입한다 — ws-server.ts가 이전에 쓰던 `?userId=` 쿼리 파라미터(검증되지
 * 않은 자리표시자)를 대체하는 게 이 파일의 존재 이유다.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { redis } from './redis.ts';

export const SESSION_COOKIE = 'aic_session';
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30일

function keyFor(token: string) {
  return `session:${token}`;
}

/**
 * 🔒 이슈 #8 — web가 다른 서브도메인(예: app.reafy.com)에 뜨면
 * host-only 쿠키(Domain 속성 없음)가 그쪽으로 안 실린다(RFC 6265, Domain
 * 없으면 발급한 호스트에만 매칭). APP_BASE_URL(server.ts CORS 허용 오리진과
 * 같은 값)에서 상위 도메인을 뽑아 Domain 속성에 쓴다 — localhost/IP거나
 * 라벨이 2개 이하(이미 최상위 도메인)면 빈 문자열을 돌려줘 로컬 개발은
 * 지금과 똑같이 host-only로 동작한다.
 */
function cookieDomainAttr(): string {
  let hostname: string;
  try {
    hostname = new URL(process.env.APP_BASE_URL || 'http://localhost:3010').hostname;
  } catch {
    return '';
  }
  if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return '';
  const labels = hostname.split('.');
  if (labels.length <= 2) return '';
  return `; Domain=.${labels.slice(-2).join('.')}`;
}

// 🔒 /review 발견(security, confidence 68) — confirmPasswordReset이 비밀번호
// 해시만 바꾸고 기존 세션은 하나도 건드리지 않았다. 세션 쿠키를 훔친
// 공격자는 피해자가 "비밀번호를 바꿨으니 안전하다"고 여긴 뒤에도 그대로
// 로그인 상태를 유지할 수 있었다. userId → 발급된 토큰 집합을 별도로
// 인덱싱해서, 필요할 때 그 사람의 세션을 전부 끊을 수 있게 한다.
const USER_SESSIONS_PREFIX = 'user_sessions:';

function userSessionsKeyFor(userId: string) {
  return `${USER_SESSIONS_PREFIX}${userId}`;
}

const TOUCH_SESSION_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return nil end
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('EXPIRE', ARGV[2] .. v, ARGV[1])
return v
`;

/**
 * 🔒 배포 실측(2026-10-19) — Secure가 하드코딩이었다가 워크스테이션 dev 배포에서
 * 로그인이 "성공하는데 로그인이 안 되는" 상태가 됐다: http LAN IP
 * (http://10.10.1.100:3021)에서 브라우저는 Secure 쿠키를 저장하지 않는데,
 * 서버 응답·세션 생성 자체는 정상이라 유저 입장에선 조용한 로그인 실패였다
 * (localhost는 브라우저 예외로 Secure 쿠키 저장을 허용해서 로컬에서만 일했다).
 * 판정: COOKIE_SECURE env(true/false) 최우선 → 없으면 APP_BASE_URL이 https일 때만
 * Secure. 운영(https 도메인)에선 env 없이도 자동 걸린다.
 */
function secureCookieAttr(): string {
  const env = process.env.COOKIE_SECURE;
  const secure = env !== undefined
    ? env === 'true'
    : (process.env.APP_BASE_URL ?? '').startsWith('https');
  return secure ? 'Secure; ' : '';
}

export async function createSession(userId: string): Promise<{ token: string; setCookie: string }> {
  const token = randomBytes32();
  await redis().set(keyFor(token), userId, 'EX', TTL_SECONDS);
  await redis().sadd(userSessionsKeyFor(userId), token);
  await redis().expire(userSessionsKeyFor(userId), TTL_SECONDS);
  const setCookie = `${SESSION_COOKIE}=${token}; HttpOnly; ${secureCookieAttr()}SameSite=Lax; Max-Age=${TTL_SECONDS}; Path=/${cookieDomainAttr()}`;
  return { token, setCookie };
}

/** 세션이 살아있는 동안 만료를 밀어준다("sliding" — 활동 중인 사용자가 30일 뒤 갑자기 끊기지 않게). */
export async function getSessionUserId(token: string | null): Promise<string | null> {
  if (!token) return null;
  try {
    const userId = await redis().eval(TOUCH_SESSION_SCRIPT, 1, keyFor(token), String(TTL_SECONDS), USER_SESSIONS_PREFIX);
    return typeof userId === 'string' ? userId : null;
  } catch {
    const userId = await redis().get(keyFor(token));
    if (!userId) return null;
    await Promise.all([
      redis().expire(keyFor(token), TTL_SECONDS),
      redis().expire(userSessionsKeyFor(userId), TTL_SECONDS),
    ]);
    return userId;
  }
}

export async function destroySession(token: string | null): Promise<void> {
  if (!token) return;
  const userId = await redis().get(keyFor(token));
  await redis().del(keyFor(token));
  if (userId) await redis().srem(userSessionsKeyFor(userId), token);
}

/** 🔒 비밀번호 재설정처럼 "이 사람 계정에 무슨 일이 있었다"는 확실할 때 — 발급된 모든 세션을 무효화한다. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  const indexKey = userSessionsKeyFor(userId);
  const tokens = await redis().smembers(indexKey);
  if (tokens.length > 0) {
    await redis().del(...tokens.map(keyFor));
  }
  await redis().del(indexKey);
}

/** createSession()과 같은 Domain·Secure 로직을 써야 한다 — 하나만 바뀌면 로그아웃이 새 도메인 쿠키를 못 지우거나(이슈 #8), 반대로 Secure 속성이 다르면 브라우저가 별개 쿠키로 취급해 구 쿠키가 안 지워진다. */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; ${secureCookieAttr()}SameSite=Lax; Max-Age=0; Path=/${cookieDomainAttr()}`;
}

function randomBytes32(): string {
  return randomBytes(32).toString('base64url');
}

/** `Cookie:` 헤더 문자열에서 쿠키 하나를 뽑는다. http-server.ts/ws-server.ts가 공유한다. */
export function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * §26(모바일) — 웹은 그대로 `aic_session` 쿠키, 모바일 클라이언트는
 * `Authorization: Bearer <token>` 헤더로 같은 불투명 세션 토큰을 보낸다.
 * 읽기 전용 인증 체크(getSessionUserId에 넘길 토큰을 구하는 자리)는 전부
 * parseCookieHeader(req.headers.cookie, SESSION_COOKIE) 대신 이 함수를 쓴다
 * — 쿠키 흐름은 그대로 폴백이라 웹 동작은 바이트 단위로 그대로다.
 * 로그아웃처럼 "그 쿠키가 가리키는 세션 자체를 지운다"는 목적의 호출부는
 * 여전히 parseCookieHeader를 직접 쓴다(이 함수로 바꾸지 않는다).
 */
export function resolveSessionToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  return parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
}
