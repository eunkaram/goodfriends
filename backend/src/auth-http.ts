/**
 * 인증 HTTP 라우트
 *
 * 처리했으면 true, 아니면 false를 반환해서 server.ts가 다음 핸들러로
 * 넘길 수 있게 한다. 소셜 로그인(oauth)은 이 프로젝트에서 제외했다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json } from './http-utils.ts';
import { resolveSessionToken, destroySession, getSessionUserId, clearSessionCookie } from './session.ts';
import {
  signUpWithEmail,
  signInWithEmail,
  needsOnboarding,
  completeOnboarding,
  getSuggestedEmail,
  verifyEmail,
  resendVerificationEmail,
  requestPasswordReset,
  confirmPasswordReset,
  deleteAccount,
  getAccountSummary,
  isEmailVerified,
  isEmailAvailable,
  updateEmail,
  type SignUpInput,
  findOrCreateOAuthUser,
} from './auth.ts';
import { checkRateLimit, clientIp, isRateLimitExempt } from './rate-limit.ts';
import { getAuthorizationUrl, consumeOAuthState, exchangeCodeForProfile, type Provider } from './oauth.ts';

function authResultStatus(error: string): number {
  switch (error) {
    case 'EMAIL_TAKEN':
    case 'RECENTLY_DELETED':
      return 409;
    case 'ACCOUNT_BANNED':
      return 403;
    case 'ALREADY_VERIFIED':
      return 409;
    case 'NOT_FOUND':
    case 'INVALID_OR_EXPIRED_TOKEN':
      return 404;
    case 'INVALID_CREDENTIALS':
    case 'NO_PASSWORD_SET':
    case 'INVALID_CREDENTIAL':
      return 401;
    default:
      return 400;
  }
}

export async function handleAuthRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
    // 🔒 /review 발견(api-contract) — 같은 파일의 다른 인증 쓰기 엔드포인트
    // (login·verify-email/resend·password-reset/request)는 전부 IP당 시간당
    // 5회로 막는데 가입만 무제한이었다 — 스팸 계정 생성·EMAIL_TAKEN 무제한
    // 탐색에 열려 있었다.
    // 🔒 agents.reafy.com(에이전트 계정 자동 생성 내부 서비스)은 RATE_LIMIT_
    // EXEMPT_CIDRS의 고정 IP에서만 예외 — Host 헤더 기준 예외는 위조 가능해서 안 쓴다.
    if (!isRateLimitExempt(clientIp(req)) && !(await checkRateLimit(`signup:${clientIp(req)}`, 5, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const input = JSON.parse(await readBody(req)) as SignUpInput;
    const result = await signUpWithEmail(input);
    if (!result.ok) {
      json(res, authResultStatus(result.error), { error: result.error });
      return true;
    }
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': result.setCookie, 'Cache-Control': 'private, no-store' });
    // 🔒 GitHub #1 — Secure 쿠키(Set-Cookie 위)는 RN fetch가 JS에서 못 읽고,
    // 로컬 HTTP 개발 백엔드에선 네이티브 쿠키 저장소에도 안 실린다(Secure는
    // HTTPS 전용). 이미 나가던 값을 바디에도 실어줄 뿐이라 새 노출이 아니다.
    res.end(JSON.stringify({ userId: result.userId, token: result.token }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    // 🔒 /review 발견 — verify-email/resend·password-reset/request는 IP당 시간당
    // 5회로 막아두고 정작 로그인 자체엔 아무 제한이 없었다. scrypt 자체 비용
    // 말고는 온라인 브루트포스를 막을 게 없었다 — 같은 패턴을 그대로 적용한다.
    // 🔒 signup과 같은 이유로 agents.reafy.com은 고정 IP 예외만 허용한다.
    if (!isRateLimitExempt(clientIp(req)) && !(await checkRateLimit(`login:${clientIp(req)}`, 5, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const { email, password } = JSON.parse(await readBody(req)) as { email: string; password: string };
    const result = await signInWithEmail(email, password);
    if (!result.ok) {
      json(res, authResultStatus(result.error), { error: result.error });
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': result.setCookie, 'Cache-Control': 'private, no-store' });
    // 🔒 GitHub #1 — Secure 쿠키(Set-Cookie 위)는 RN fetch가 JS에서 못 읽고,
    // 로컬 HTTP 개발 백엔드에선 네이티브 쿠키 저장소에도 안 실린다(Secure는
    // HTTPS 전용). 이미 나가던 값을 바디에도 실어줄 뿐이라 새 노출이 아니다.
    res.end(JSON.stringify({ userId: result.userId, token: result.token }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    // §26(모바일) — 헤더로 인증한 클라이언트가 로그아웃할 방법이 없었다
    // (API 레퍼런스 문서 작성 중 발견, 2026-08-29). resolveSessionToken이
    // 어느 경로로 왔든 그 토큰을 지운다 — Set-Cookie는 그대로 같이 보내도
    // 무해하다(쿠키가 애초에 없던 모바일 클라이언트는 그냥 무시함).
    const token = resolveSessionToken(req);
    await destroySession(token);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const token = resolveSessionToken(req);
    const userId = await getSessionUserId(token);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    // 🔒 /review 발견(api-contract) — 같은 파일의 signup/login/logout/delete-account는
    // 전부 Cache-Control: private, no-store를 명시하는데 이 세션 조회 라우트만
    // 빠져 있었다. 사용자별 응답이라 공유 캐시에 실리면 안 된다.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ userId, emailVerified: await isEmailVerified(userId) }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') {
    const { token } = JSON.parse(await readBody(req)) as { token: string };
    const result = await verifyEmail(token);
    json(res, result.ok ? 200 : authResultStatus(result.error), result.ok ? { ok: true } : { error: result.error });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/verify-email/resend') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    // 🔒 재발송 스팸 방지 — IP당 시간당 5회. 이메일 기준이 아니다(계정 존재
    // 여부 비노출 원칙과 충돌하지 않으려면 요청자 기준으로만 걸어야 한다).
    if (!(await checkRateLimit(`verify-resend:${clientIp(req)}`, 5, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const result = await resendVerificationEmail(userId);
    json(res, result.ok ? 200 : authResultStatus(result.error), result.ok ? { ok: true } : { error: result.error });
    return true;
  }

  // 🔒 사용자 지시(2026-08, "프로필 수정에서... 아이디 있던 부분에 이메일을
  // 보여줘. 수정가능하면 좋을것 같아") — user-log-http.ts의
  // username-available과 같은 패턴(로그인 필수 + 유저 기준 레이트리밋,
  // 저장 전 실시간 확인). email은 auth_credentials에 있어 이 라우트가
  // 여기(auth-http.ts) 있다 — user-log-http.ts는 appPool이라 이 테이블에
  // GRANT가 없다.
  if (req.method === 'GET' && url.pathname === '/api/auth/email-available') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!(await checkRateLimit(`email-check:${userId}`, 60, 600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const email = url.searchParams.get('email') ?? '';
    const available = await isEmailAvailable(email, userId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ available }));
    return true;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/auth/email') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    // 🔒 인증 메일이 사용자가 입력한 임의 주소로 나간다 — 반복 호출을 제3자
    // 이메일 폭탄 수단으로 못 쓰게 verify-email/resend와 같은 강도로 막는다.
    if (!(await checkRateLimit(`email-change:${userId}`, 5, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const { email, password } = JSON.parse(await readBody(req)) as { email: string; password?: string };
    const result = await updateEmail(userId, email, password);
    if (!result.ok) {
      json(res, authResultStatus(result.error), { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 🔒 이메일 존재 여부와 무관하게 항상 200 — requestPasswordReset이 그 원칙을 지킨다.
  // 레이트리밋도 같은 이유로 이메일이 아니라 IP 기준.
  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/request') {
    if (!(await checkRateLimit(`password-reset:${clientIp(req)}`, 5, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const { email } = JSON.parse(await readBody(req)) as { email: string };
    await requestPasswordReset(email);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/account-summary') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const summary = await getAccountSummary(userId);
    if (!summary) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify(summary));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/delete-account') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    // 🔒 보안 점검 발견(2026-08-22) — 이 라우트는 실제 비밀번호(scrypt)를 대조한다
    // (deleteAccount() 내부). 탈취한 세션 쿠키만 가진 공격자가 시도 횟수 제한
    // 없이 비밀번호를 무제한으로 맞춰볼 수 있는 오라클이었다 — 이 파일의
    // 다른 모든 민감 라우트(signup/login/email-change/password-reset)엔
    // 이미 걸려있던 걸 여기만 빠뜨렸다.
    if (!(await checkRateLimit(`delete-account:${userId}`, 5, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const credential = JSON.parse(await readBody(req)) as { password?: string; confirmationPhrase?: string };
    const result = await deleteAccount(userId, credential);
    if (!result.ok) {
      json(res, authResultStatus(result.error), { error: result.error });
      return true;
    }
    // deleteAccount()가 이미 destroyAllSessionsForUser로 이 세션을 포함해 전부 지웠다 — 여긴 브라우저 쿠키만 정리한다.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/confirm') {
    const { token, newPassword } = JSON.parse(await readBody(req)) as { token: string; newPassword: string };
    const result = await confirmPasswordReset(token, newPassword);
    json(res, result.ok ? 200 : authResultStatus(result.error), result.ok ? { ok: true } : { error: result.error });
    return true;
  }

  // 소셜 로그인(Google/GitHub) — 2026-10-26 추가. oauth.ts 헤더 주석 참고.
  const oauthStart = url.pathname.match(/^\/api\/auth\/(google|github)$/);
  if (req.method === 'GET' && oauthStart) {
    const provider = oauthStart[1] as Provider;
    const authorizationUrl = await getAuthorizationUrl(provider);
    res.writeHead(302, { Location: authorizationUrl });
    res.end();
    return true;
  }

  const oauthCallback = url.pathname.match(/^\/api\/auth\/(google|github)\/callback$/);
  if (req.method === 'GET' && oauthCallback) {
    const provider = oauthCallback[1] as Provider;
    const code = url.searchParams.get('code');
    const stateOk = await consumeOAuthState(url.searchParams.get('state'));
    if (!stateOk || !code) {
      json(res, 400, { error: 'INVALID_OAUTH_CALLBACK' });
      return true;
    }
    const frontendBase = process.env.APP_BASE_URL || 'http://localhost:3011';
    try {
      const profile = await exchangeCodeForProfile(provider, code);
      const result = await findOrCreateOAuthUser(profile);
      if (!result.ok) {
        res.writeHead(302, { Location: `${frontendBase}/signin?error=${result.error}` });
        res.end();
        return true;
      }
      // 이 서비스는 생년월일·국가를 안 걷으므로(findOrCreateOAuthUser 주석
      // 참고) 온보딩 리다이렉트 없이 바로 홈으로 — 이메일 가입과 동일한 완료 지점.
      res.writeHead(302, { 'Set-Cookie': result.setCookie, Location: frontendBase });
      res.end();
    } catch (err) {
      console.error(`[oauth] ${provider} 콜백 실패:`, err);
      res.writeHead(302, { Location: `${frontendBase}/signin?error=OAUTH_FAILED` });
      res.end();
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/onboarding/status') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const status = await needsOnboarding(userId);
    // 프리필은 email이 실제로 필요할 때만 조회 — 나머지 경우엔 Redis 왕복을 아낀다.
    const suggestedEmail = status.email ? await getSuggestedEmail(userId) : null;
    json(res, 200, { ...status, suggestedEmail });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/onboarding') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { birthdate, country, postalCode, email } = JSON.parse(await readBody(req)) as {
      birthdate?: string;
      country?: string;
      postalCode?: string;
      email?: string;
    };
    // 🔒 CEO 리뷰 발견(2026-08-22) — 이메일 변경은 민감한 작업이라 기존
    // 이메일수정 API(auth-http.ts의 email-change 라우트)와 같은 이유로
    // 레이트리밋이 필요하다. 다만 같은 키를 공유하면 온보딩 중 오타로 몇 번
    // 실패해도 카운트가 깎여, 필수 항목인 이메일이 그 시간 동안 아예 막힌다
    // — 별도 키로 분리하고 한도를 넉넉히 둔다.
    if (email !== undefined) {
      if (!(await checkRateLimit(`onboarding-email:${userId}`, 10, 3600))) {
        json(res, 429, { error: 'RATE_LIMITED' });
        return true;
      }
    }
    const result = await completeOnboarding(userId, { birthdate, country, postalCode, email });
    if (!result.ok) {
      if (result.error === 'UNDERAGE') {
        // completeOnboarding이 이미 계정·세션을 지웠다 — 브라우저 쿠키도
        // 함께 정리한다(delete-account 라우트와 같은 패턴).
        const payload = JSON.stringify({ error: result.error });
        res.writeHead(403, { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() });
        res.end(payload);
        return true;
      }
      json(res, authResultStatus(result.error), { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
