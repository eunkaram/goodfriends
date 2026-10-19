/**
 * 인증 통합 테스트 — 실제 HTTP 요청으로 검증한다.
 *
 * 소셜 로그인(oauth)은 이 프로젝트에서 제외했다.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handleAuthRoutes } from '../../src/auth-http.ts';
import {
  deleteAccount,
  needsOnboarding,
  getSuggestedEmail,
} from '../../src/auth.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession } from '../../src/session.ts';
import { closeRedis, redis } from '../../src/redis.ts';
import type pg from 'pg';

// 실제 이메일 발송 없이 링크에 실린 토큰을 캡처한다 — email.ts는 콘솔 로그
// 스텁이라(§17.3 미해결 숙제), 토큰 원문은 이 방법으로만 테스트에서 얻을 수
// 있다(DB엔 해시만 저장되므로 §6.1 verification-tokens.ts 설계상 당연하다).
const emailMocks = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailChangedNotice: vi.fn(),
}));
vi.mock('../../src/email.ts', () => ({
  sendEmail: vi.fn(),
  sendVerificationEmail: emailMocks.sendVerificationEmail,
  sendPasswordResetEmail: emailMocks.sendPasswordResetEmail,
  sendEmailChangedNotice: emailMocks.sendEmailChangedNotice,
}));

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

function getCookie(res: Response, name: string): string | null {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of all) if (c.startsWith(`${name}=`)) return c;
  return null;
}

// 0049 이관 — oauth가 1차 스코프에서 제외되어 findOrCreateOAuthUser가 사라졌다.
// "소셜 전용(비밀번호 없는) 계정"은 이제 직접 INSERT로 만든다: users 행 + 세션,
// auth_credentials는 없는 상태(username을 'authtest%'로 두면 cleanup이 정리한다).
async function createSocialOnlyAccount(username: string, nickname: string) {
  const u = await owner.query<{ id: string }>(
    `INSERT INTO users (username, nickname, avatar_url) VALUES ($1, $2, '') RETURNING id`,
    [username, nickname],
  );
  const userId = u.rows[0].id;
  const { token } = await createSession(userId);
  return { userId, cookie: `aic_session=${token}` };
}

async function cleanup() {
  await owner.query(`DELETE FROM users WHERE username LIKE 'authtest%'`); // auth_credentials는 CASCADE
  // 🔒 탈퇴 테스트는 deleteAccount()를 실제로 호출해 deleted_account_emails에
  // 행을 남긴다(0041, 7일 쿨다운) — users처럼 CASCADE로 같이 안 지워지므로
  // 여기서 따로 안 지우면 다음 실행의 같은 이메일 재가입 테스트가 막힌다.
  await owner.query(`DELETE FROM deleted_account_emails WHERE email LIKE 'authtest%'`);
  const rateLimitKeys = await redis().keys('ratelimit:*');
  if (rateLimitKeys.length) await redis().del(...rateLimitKeys);
  const suggestedEmailKeys = await redis().keys('onboarding_suggested_email:*');
  if (suggestedEmailKeys.length) await redis().del(...suggestedEmailKeys);
}

beforeEach(() => {
  emailMocks.sendVerificationEmail.mockClear();
  emailMocks.sendPasswordResetEmail.mockClear();
  emailMocks.sendEmailChangedNotice.mockClear();
});

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleAuthRoutes(req, res)) return;
      res.writeHead(404);
      res.end();
    } catch (err) {
      // server.ts의 프로덕션 경로와 같은 방어 — 이게 없으면 라우트 안에서
      // 던진 예외가 응답 없이 그냥 사라져서 실패가 5초 타임아웃으로만
      // 보이고 진짜 원인(예: GRANT 누락)이 로그에 묻힌다(실측 발견).
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;

  owner = ownerPool();
  await cleanup();
});

afterEach(cleanup);

afterAll(async () => {
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRedis();
});

/** age-gate.test.ts와 달리 이 스위트는 signUpWithEmail의 실제 현재 시각을 쓴다 — 절대 날짜 대신 상대 계산으로 테스트 실행 시점과 무관하게 만든다. */
function birthdateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function validSignupBody(overrides: Record<string, unknown> = {}) {
  return {
    nickname: '지수',
    email: 'authtest_valid@example.com',
    password: 'correct horse battery staple',
    birthdate: '1995-05-20',
    country: 'KR',
    ...overrides,
  };
}

describe('POST /api/auth/signup', () => {
  it('올바른 입력이면 201 + 세션 쿠키를 받는다', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody()),
    });
    expect(res.status).toBe(201);
    const cookie = getCookie(res, 'aic_session');
    expect(cookie).toBeTruthy();
    expect(cookie).toContain('HttpOnly');
    const body = await res.json();
    expect(body.userId).toBeTruthy();
  });

  // GitHub #1 — Secure 쿠키는 RN fetch가 못 읽고, 로컬 HTTP 개발 백엔드에선
  // 네이티브 쿠키 저장소에도 안 실린다. 바디의 token이 쿠키 안 값과 같은지까지 확인.
  it('GitHub #1 — 응답 바디의 token이 Set-Cookie 안 토큰 값과 같다', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_bodytoken_signup@example.com' })),
    });
    expect(res.status).toBe(201);
    const cookie = getCookie(res, 'aic_session')!;
    const cookieToken = cookie.split(';')[0].split('=')[1];
    const { token } = await res.json();
    expect(token).toBe(cookieToken);

    // 그 토큰이 실제로 유효한 세션인지도 확인(진짜 값인지, 아무 문자열이 아닌지).
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Authorization: `Bearer ${token}` } });
    expect(sessionRes.status).toBe(200);
  });

  it('§6.4 UserLog가 자동으로 함께 생성된다(가입 시 자동 생성되지 않던 실전 버그, 수정됨)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_userlog@example.com' })),
    });
    const { userId } = await res.json();
    const row = await owner.query(`SELECT 1 FROM user_logs WHERE user_id = $1`, [userId]);
    expect(row.rowCount).toBe(1);
  });

  it('🔒 응답 본문에 비밀번호 해시가 절대 실리지 않는다', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_nohash@example.com' })),
    });
    const text = await res.text();
    expect(text).not.toMatch(/scrypt\$/);
    expect(text).not.toContain('password');
  });

  it('이메일이 이미 있으면 409', async () => {
    await fetch(`${baseUrl}/api/auth/signup`, { method: 'POST', body: JSON.stringify(validSignupBody({ email: 'authtest_dup@example.com' })) });
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_dup@example.com' })),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('EMAIL_TAKEN');
  });

  // 🔒 REGRESSION — username이 이메일 로컬파트를 그대로 쓰던 시절엔
  // admin@example.com으로 가입하면 검증 없이 /@admin을 차지했다
  // (RESERVED_USERNAMES, src/auth.ts). 이메일이 authtest%가 아니라
  // cleanup()이 안 잡으므로 userId로 직접 정리한다(구글 계정 테스트와 같은 패턴).
  it('🔒 이메일 로컬파트가 예약어(admin)면 그 문자열 그대로 username을 받지 않는다', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'admin@example.com' })),
    });
    expect(res.status).toBe(201);
    const { userId } = await res.json();
    const row = await owner.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [userId]);
    expect(row.rows[0].username).not.toBe('admin');

    await owner.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  // 🔒 REGRESSION — 닉네임(표시 이름)은 자유 텍스트라 한글 사칭 문구가
  // 그대로 들어간다(RESERVED_NICKNAMES, src/reserved-nicknames.ts).
  // username과 별개 검증이라 여기서 따로 확인해야 한다.
  it('🔒 닉네임이 예약어(관리자)면 가입 자체가 거부된다', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ nickname: '관리자', email: 'authtest_reserved_nickname@example.com' })),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
  });

  it('🔒 필수 항목 누락은 400 (예: 닉네임 없음)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ nickname: '', email: 'authtest_missing@example.com' })),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
  });

    });

describe('POST /api/auth/login', () => {
  async function signUp(email: string, password: string) {
    await fetch(`${baseUrl}/api/auth/signup`, { method: 'POST', body: JSON.stringify(validSignupBody({ email, password })) });
  }

  it('올바른 이메일/비밀번호면 200 + 세션 쿠키', async () => {
    await signUp('authtest_login@example.com', 'correct horse battery staple');
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_login@example.com', password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(200);
    expect(getCookie(res, 'aic_session')).toBeTruthy();
  });

  // GitHub #1 — 같은 이유(Secure 쿠키는 RN fetch가 못 읽고, 로컬 HTTP 개발
  // 백엔드에선 네이티브 쿠키 저장소에도 안 실린다)로 login도 바디에 token을 실어야 한다.
  it('GitHub #1 — 응답 바디의 token이 Set-Cookie 안 토큰 값과 같다', async () => {
    await signUp('authtest_bodytoken_login@example.com', 'correct horse battery staple');
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_bodytoken_login@example.com', password: 'correct horse battery staple' }),
    });
    const cookie = getCookie(res, 'aic_session')!;
    const cookieToken = cookie.split(';')[0].split('=')[1];
    const { token } = await res.json();
    expect(token).toBe(cookieToken);

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Authorization: `Bearer ${token}` } });
    expect(sessionRes.status).toBe(200);
  });

  it('🔒 틀린 비밀번호는 401, 계정 존재 여부를 드러내지 않는 동일한 에러 코드', async () => {
    await signUp('authtest_wrongpw@example.com', 'correct horse battery staple');
    const wrongPw = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_wrongpw@example.com', password: 'nope' }),
    });
    const noSuchUser = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_never_signed_up@example.com', password: 'nope' }),
    });
    expect(wrongPw.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect((await wrongPw.json()).error).toBe((await noSuchUser.json()).error);
  });

  // 🔒 REGRESSION (eng-review, 2026-08) — admin 밴 기능이 signInWithEmail에
  // is_banned 체크를 추가했다. 밴된 계정은 비밀번호가 맞아도 재로그인이
  // 막혀야 "즉시 킬스위치" 약속이 실제로 성립한다(3차 스펙 리뷰 발견).
  it('🔒 밴된 계정은 비밀번호가 맞아도 403 ACCOUNT_BANNED', async () => {
    const email = 'authtest_banned_login@example.com';
    await signUp(email, 'correct horse battery staple');
    await owner.query(`UPDATE users SET is_banned = true WHERE id = (SELECT user_id FROM auth_credentials WHERE email = $1)`, [email]);

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ACCOUNT_BANNED');
    expect(getCookie(res, 'aic_session')).toBeNull();
  });
});

describe('GET /api/auth/session · POST /api/auth/logout', () => {
  it('로그인 상태면 세션 조회가 되고, 로그아웃하면 같은 쿠키로도 더 이상 안 된다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_session@example.com' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
    expect(sessionRes.status).toBe(200);
    const { userId } = await sessionRes.json();
    expect(userId).toBe((await signupRes.json()).userId);

    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });

    const afterLogout = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
    expect(afterLogout.status).toBe(401);
  });

  it('쿠키 없이 조회하면 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/session`);
    expect(res.status).toBe(401);
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  it('Authorization: Bearer 헤더만으로도(쿠키 없이) 쿠키와 같은 결과를 받는다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_bearer@example.com' })),
    });
    const token = getCookie(signupRes, 'aic_session')!.split(';')[0].split('=')[1];

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Authorization: `Bearer ${token}` } });
    expect(sessionRes.status).toBe(200);
    const { userId } = await sessionRes.json();
    expect(userId).toBe((await signupRes.json()).userId);
  });

  // §26(모바일) — API 레퍼런스 문서 작성 중 발견: 로그아웃이 쿠키만 지원했다.
  // resolveSessionToken 전환으로 고정(2026-08-29).
  it('Authorization: Bearer 헤더로 로그아웃하면 그 토큰이 무효화된다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_bearer_logout@example.com' })),
    });
    const token = getCookie(signupRes, 'aic_session')!.split(';')[0].split('=')[1];

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(200);

    const afterLogout = await fetch(`${baseUrl}/api/auth/session`, { headers: { Authorization: `Bearer ${token}` } });
    expect(afterLogout.status).toBe(401);
  });
});


describe('이메일 인증', () => {
  it('가입 직후 자동으로 인증 메일을 "보내고"(스텁), session의 emailVerified는 false다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_verify1@example.com' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];

    expect(emailMocks.sendVerificationEmail).toHaveBeenCalledWith('authtest_verify1@example.com', expect.any(String));

    const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
    expect(session.emailVerified).toBe(false);
  });

  it('🔒 올바른 토큰으로 인증되고, 같은 토큰은 재사용할 수 없다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_verify2@example.com' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];
    const token = emailMocks.sendVerificationEmail.mock.calls.at(-1)![1] as string;

    const first = await fetch(`${baseUrl}/api/auth/verify-email`, { method: 'POST', body: JSON.stringify({ token }) });
    expect(first.status).toBe(200);

    const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
    expect(session.emailVerified).toBe(true);

    const second = await fetch(`${baseUrl}/api/auth/verify-email`, { method: 'POST', body: JSON.stringify({ token }) });
    expect(second.status).toBe(404);
  });

  it('존재하지 않는 토큰은 404', async () => {
    const res = await fetch(`${baseUrl}/api/auth/verify-email`, { method: 'POST', body: JSON.stringify({ token: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });

  it('재발송 — 로그인 없이는 401, 로그인 후엔 재발송되고, 인증 완료 후엔 409', async () => {
    const noAuth = await fetch(`${baseUrl}/api/auth/verify-email/resend`, { method: 'POST' });
    expect(noAuth.status).toBe(401);

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_resend@example.com' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];
    emailMocks.sendVerificationEmail.mockClear(); // 가입 시 자동발송 호출 기록 지우기

    const resend = await fetch(`${baseUrl}/api/auth/verify-email/resend`, { method: 'POST', headers: { Cookie: cookie } });
    expect(resend.status).toBe(200);
    expect(emailMocks.sendVerificationEmail).toHaveBeenCalledTimes(1);

    const newToken = emailMocks.sendVerificationEmail.mock.calls.at(-1)![1] as string;
    await fetch(`${baseUrl}/api/auth/verify-email`, { method: 'POST', body: JSON.stringify({ token: newToken }) });

    const alreadyVerified = await fetch(`${baseUrl}/api/auth/verify-email/resend`, { method: 'POST', headers: { Cookie: cookie } });
    expect(alreadyVerified.status).toBe(409);
  });
});

// 🔒 사용자 지시(2026-08, "프로필 수정에서... 아이디 있던 부분에 이메일을
// 보여줘. 수정가능하면 좋을것 같아") — 이메일 변경 엔드포인트.
describe('이메일 변경', () => {
  async function signUpAndCookie(email: string, password = 'correct horse battery staple') {
    const res = await fetch(`${baseUrl}/api/auth/signup`, { method: 'POST', body: JSON.stringify(validSignupBody({ email, password })) });
    return { userId: (await res.json()).userId as string, cookie: getCookie(res, 'aic_session')!.split(';')[0] };
  }

  describe('GET /api/auth/email-available', () => {
    it('로그인 없이는 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/email-available?email=whoever@example.com`);
      expect(res.status).toBe(401);
    });

    it('아무도 안 쓰는 이메일은 available:true, 다른 계정이 이미 쓰는 이메일은 false', async () => {
      const { cookie } = await signUpAndCookie('authtest_email_checker@example.com');
      await signUpAndCookie('authtest_email_taken@example.com');

      const free = await fetch(`${baseUrl}/api/auth/email-available?email=authtest_email_never_used@example.com`, { headers: { Cookie: cookie } });
      expect((await free.json()).available).toBe(true);

      const taken = await fetch(`${baseUrl}/api/auth/email-available?email=authtest_email_taken@example.com`, { headers: { Cookie: cookie } });
      expect((await taken.json()).available).toBe(false);
    });

    it('🔒 본인이 이미 쓰고 있는 이메일 그대로 확인하면 available:true — 자기 자신과 안 부딪힌다', async () => {
      const { cookie } = await signUpAndCookie('authtest_email_self_check@example.com');
      const res = await fetch(`${baseUrl}/api/auth/email-available?email=authtest_email_self_check@example.com`, { headers: { Cookie: cookie } });
      expect((await res.json()).available).toBe(true);
    });

    it('형식이 잘못되면 false', async () => {
      const { cookie } = await signUpAndCookie('authtest_email_fmt_checker@example.com');
      const res = await fetch(`${baseUrl}/api/auth/email-available?email=not-an-email`, { headers: { Cookie: cookie } });
      expect((await res.json()).available).toBe(false);
    });
  });

  describe('PATCH /api/auth/email', () => {
    it('로그인 없이는 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/email`, { method: 'PATCH', body: JSON.stringify({ email: 'whoever@example.com' }) });
      expect(res.status).toBe(401);
    });

    it('🔒 이메일을 바꾸면 auth_credentials가 갱신되고, 재인증이 필요해지고(email_verified_at 초기화), 새 이메일로 인증 메일이 나간다', async () => {
      const { userId, cookie } = await signUpAndCookie('authtest_email_before@example.com');
      // 가입 직후 인증까지 마쳐서 "재인증 필요해짐"이 실제로 리셋되는지 확인할 수 있게 한다.
      const token = emailMocks.sendVerificationEmail.mock.calls.at(-1)![1] as string;
      await fetch(`${baseUrl}/api/auth/verify-email`, { method: 'POST', body: JSON.stringify({ token }) });
      const verifiedBefore = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
      expect(verifiedBefore.emailVerified).toBe(true);

      emailMocks.sendVerificationEmail.mockClear();
      const res = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: cookie },
        body: JSON.stringify({ email: 'authtest_email_after@example.com', password: 'correct horse battery staple' }),
      });
      expect(res.status).toBe(200);

      const row = await owner.query(`SELECT email, email_verified_at FROM auth_credentials WHERE user_id = $1`, [userId]);
      expect(row.rows[0].email).toBe('authtest_email_after@example.com');
      expect(row.rows[0].email_verified_at).toBeNull(); // 🔒 재인증 필요 — 예전 인증 상태를 새 이메일에 물려주지 않는다
      expect(emailMocks.sendVerificationEmail).toHaveBeenCalledWith('authtest_email_after@example.com', expect.any(String));
      // 🔒 보안 점검 발견(2026-08-22) — 예전 주소로도 변경 알림이 나가야 한다(계정 탈취 조기 발견용).
      expect(emailMocks.sendEmailChangedNotice).toHaveBeenCalledWith('authtest_email_before@example.com', 'authtest_email_after@example.com');

      const sessionAfter = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
      expect(sessionAfter.emailVerified).toBe(false);

      // 옛 이메일로는 더 이상 로그인이 안 되고, 새 이메일로는 그대로 되던 비밀번호로 로그인된다.
      const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: 'authtest_email_before@example.com', password: 'correct horse battery staple' }),
      });
      expect(oldLogin.status).toBe(401);
      const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: 'authtest_email_after@example.com', password: 'correct horse battery staple' }),
      });
      expect(newLogin.status).toBe(200);
    });

    // 🔒 보안 점검 발견(2026-08-22, "세션만 탈취해도 이메일을 바꿔 계정을 통째로
    // 탈취할 수 있었다") — 비밀번호가 있는 계정은 재확인 없이는 이메일을 못 바꾼다.
    it('🔒 비밀번호가 있는 계정은 비밀번호 없이/틀리게 보내면 401, 이메일은 그대로 남는다', async () => {
      const { userId, cookie } = await signUpAndCookie('authtest_email_noauth@example.com');

      const noPassword = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: cookie },
        body: JSON.stringify({ email: 'authtest_email_noauth_new@example.com' }),
      });
      expect(noPassword.status).toBe(401);
      expect((await noPassword.json()).error).toBe('INVALID_CREDENTIAL');

      const wrongPassword = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: cookie },
        body: JSON.stringify({ email: 'authtest_email_noauth_new@example.com', password: 'wrong password' }),
      });
      expect(wrongPassword.status).toBe(401);
      expect((await wrongPassword.json()).error).toBe('INVALID_CREDENTIAL');

      const row = await owner.query(`SELECT email FROM auth_credentials WHERE user_id = $1`, [userId]);
      expect(row.rows[0].email).toBe('authtest_email_noauth@example.com'); // 안 바뀌었다
      expect(emailMocks.sendEmailChangedNotice).not.toHaveBeenCalled();
    });

    it('🔒 비밀번호가 없는 소셜 전용 계정은 재확인 없이 이메일을 추가/변경할 수 있다(같은 탈취 경로가 성립하지 않는다)', async () => {
      const social = await createSocialOnlyAccount(`authtest_social_email_${Math.random().toString(36).slice(2)}`, '가나');
      const socialCookie = social.cookie;

      const res = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: socialCookie },
        body: JSON.stringify({ email: 'authtest_email_social_added@example.com' }),
      });
      expect(res.status).toBe(200);

      const row = await owner.query(`SELECT email FROM auth_credentials WHERE user_id = $1`, [social.userId]);
      expect(row.rows[0].email).toBe('authtest_email_social_added@example.com');
      // 예전 주소가 없었으니(처음 추가) 알릴 대상도 없다.
      expect(emailMocks.sendEmailChangedNotice).not.toHaveBeenCalled();

    });

    it('이미 다른 계정이 쓰는 이메일로 바꾸려 하면 409 EMAIL_TAKEN — 원래 이메일은 그대로 남는다', async () => {
      await signUpAndCookie('authtest_email_owner@example.com');
      const { userId, cookie } = await signUpAndCookie('authtest_email_wants_it@example.com');

      const res = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: cookie },
        body: JSON.stringify({ email: 'authtest_email_owner@example.com', password: 'correct horse battery staple' }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('EMAIL_TAKEN');

      const row = await owner.query(`SELECT email FROM auth_credentials WHERE user_id = $1`, [userId]);
      expect(row.rows[0].email).toBe('authtest_email_wants_it@example.com');
    });

    it('형식이 잘못되면 400 INVALID_INPUT', async () => {
      const { cookie } = await signUpAndCookie('authtest_email_badfmt@example.com');
      const res = await fetch(`${baseUrl}/api/auth/email`, { method: 'PATCH', headers: { Cookie: cookie }, body: JSON.stringify({ email: 'not-an-email' }) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('INVALID_INPUT');
    });

    it('🔒 그대로 같은 이메일로 제출하면 성공하지만 재인증 상태를 건드리지 않는다(불필요한 인증메일 재발송 방지)', async () => {
      const { userId, cookie } = await signUpAndCookie('authtest_email_noop@example.com');
      const token = emailMocks.sendVerificationEmail.mock.calls.at(-1)![1] as string;
      await fetch(`${baseUrl}/api/auth/verify-email`, { method: 'POST', body: JSON.stringify({ token }) });
      emailMocks.sendVerificationEmail.mockClear();

      const res = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: cookie },
        body: JSON.stringify({ email: 'authtest_email_noop@example.com' }),
      });
      expect(res.status).toBe(200);
      expect(emailMocks.sendVerificationEmail).not.toHaveBeenCalled();

      const row = await owner.query(`SELECT email_verified_at FROM auth_credentials WHERE user_id = $1`, [userId]);
      expect(row.rows[0].email_verified_at).not.toBeNull(); // 여전히 인증된 상태 그대로
    });

    it('🔒 소셜 전용 계정(auth_credentials 행 없음)도 이메일을 새로 추가할 수 있다 — 비밀번호는 여전히 없다', async () => {
      const social = await createSocialOnlyAccount('authtest_email_social_usuario', '소셜프로필');
      const cookie = social.cookie;

      const before = await owner.query(`SELECT 1 FROM auth_credentials WHERE user_id = $1`, [social.userId]);
      expect(before.rowCount).toBe(0);

      const res = await fetch(`${baseUrl}/api/auth/email`, {
        method: 'PATCH',
        headers: { Cookie: cookie },
        body: JSON.stringify({ email: 'authtest_email_added_to_social@example.com' }),
      });
      expect(res.status).toBe(200);

      const after = await owner.query(`SELECT email, password_hash FROM auth_credentials WHERE user_id = $1`, [social.userId]);
      expect(after.rows[0].email).toBe('authtest_email_added_to_social@example.com');
      expect(after.rows[0].password_hash).toBeNull();

    });

    it('🔒 IP가 아니라 유저 기준 레이트리밋 — 짧은 시간에 6번째 요청은 429', async () => {
      const { cookie } = await signUpAndCookie('authtest_email_ratelimit@example.com');
      const results: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${baseUrl}/api/auth/email`, {
          method: 'PATCH',
          headers: { Cookie: cookie },
          body: JSON.stringify({ email: `authtest_email_rl_${i}@example.com`, password: 'correct horse battery staple' }),
        });
        results.push(res.status);
      }
      expect(results.slice(0, 5).every((s) => s === 200)).toBe(true);
      expect(results[5]).toBe(429);
    });
  });
});

describe('비밀번호 재설정', () => {
  it('🔒 요청 응답은 이메일 존재 여부와 무관하게 항상 200 — 존재할 때만 메일이 나간다', async () => {
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_reset_exists@example.com' })),
    });
    emailMocks.sendPasswordResetEmail.mockClear();

    const existing = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_exists@example.com' }),
    });
    const notExisting = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_never_registered@example.com' }),
    });

    expect(existing.status).toBe(200);
    expect(notExisting.status).toBe(200); // 🔒 같은 200 — 응답 모양으로 계정 존재 여부가 새지 않는다
    expect(emailMocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendPasswordResetEmail).toHaveBeenCalledWith('authtest_reset_exists@example.com', expect.any(String));
  });

  it('🔒 올바른 토큰으로 비밀번호를 바꾸면, 새 비밀번호로만 로그인된다', async () => {
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_reset_flow@example.com', password: 'original password 123' })),
    });
    emailMocks.sendPasswordResetEmail.mockClear();

    await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_flow@example.com' }),
    });
    const token = emailMocks.sendPasswordResetEmail.mock.calls.at(-1)![1] as string;

    const confirm = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: 'brand new password 456' }),
    });
    expect(confirm.status).toBe(200);

    const oldPwLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_flow@example.com', password: 'original password 123' }),
    });
    expect(oldPwLogin.status).toBe(401);

    const newPwLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_flow@example.com', password: 'brand new password 456' }),
    });
    expect(newPwLogin.status).toBe(200);
  });

  it('🔒 비밀번호 재설정 전에 살아있던 세션은 재설정 후 즉시 무효화된다(/review 발견 — 세션 탈취 대응)', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_reset_kills_session@example.com', password: 'original password 123' })),
    });
    const stolenCookie = getCookie(signupRes, 'aic_session')!.split(';')[0]; // 가입 시 생긴 세션 = "탈취당한" 세션이라고 가정

    const stillValidBeforeReset = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: stolenCookie } });
    expect(stillValidBeforeReset.status).toBe(200);

    emailMocks.sendPasswordResetEmail.mockClear();
    await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_kills_session@example.com' }),
    });
    const token = emailMocks.sendPasswordResetEmail.mock.calls.at(-1)![1] as string;
    await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: 'brand new password 456' }),
    });

    const stolenAfterReset = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: stolenCookie } });
    expect(stolenAfterReset.status).toBe(401); // 훔친 쿠키는 이제 죽었다
  });

  it('🔒 같은 토큰을 두 번 쓸 수 없다', async () => {
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_reset_reuse@example.com' })),
    });
    await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_reuse@example.com' }),
    });
    const token = emailMocks.sendPasswordResetEmail.mock.calls.at(-1)![1] as string;

    const first = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: 'first new password 789' }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: 'second new password 000' }),
    });
    expect(second.status).toBe(404);
  });

  it('새 비밀번호가 8자 미만이면 400', async () => {
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_reset_short@example.com' })),
    });
    await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_reset_short@example.com' }),
    });
    const token = emailMocks.sendPasswordResetEmail.mock.calls.at(-1)![1] as string;

    const res = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('존재하지 않는 토큰은 404', async () => {
    const res = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token: 'does-not-exist', newPassword: 'whatever password 123' }),
    });
    expect(res.status).toBe(404);
  });

  it('🔒 IP 기준 레이트리밋 — 짧은 시간에 6번째 요청은 429', async () => {
    const email = 'authtest_ratelimit@example.com';
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${baseUrl}/api/auth/password-reset/request`, { method: 'POST', body: JSON.stringify({ email }) });
      results.push(res.status);
    }
    expect(results.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(results[5]).toBe(429);
  });
});

// 🔒 사용자 지시(2026-08-22, "프로필 편집버튼을 삼점 메뉴로... 어카운트
// 삭제는 삭제페이지로 이동후 기본정보를 제공후 동의를 받고") — 삭제 페이지가
// "안내" 단계에서 보여줄 계정 기본정보 API.
describe('GET /api/auth/account-summary', () => {
  it('로그인 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/account-summary`);
    expect(res.status).toBe(401);
  });

  it('비밀번호 있는 계정은 hasPassword:true, 확인문구는 null', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_summary_pw@example.com', nickname: '요약테스트' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];

    const res = await fetch(`${baseUrl}/api/auth/account-summary`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('authtest_summary_pw@example.com');
    expect(body.nickname).toBe('요약테스트');
    expect(body.hasPassword).toBe(true);
    expect(body.deleteConfirmationPhrase).toBeNull();
    expect(typeof body.joinedAt).toBe('string');
    expect(body.avatarUrl).toBe(''); // 이슈 #5 — 업로드 안 한 계정은 빈 문자열(0026, NOT NULL DEFAULT '')
  });

  it('avatar_url이 채워진 계정은 avatarUrl에 그대로 반영된다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_summary_avatar@example.com', nickname: '아바타테스트' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];
    const signupBody = await signupRes.json();
    await owner.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, ['https://example.com/avatar.png', signupBody.userId]);

    const res = await fetch(`${baseUrl}/api/auth/account-summary`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('소셜 전용(비밀번호 없음) 계정은 hasPassword:false, 확인문구가 채워진다', async () => {
    const result = await createSocialOnlyAccount('authtest_summary_social', '소셜요약테스트');
    const cookie = result.cookie;

    const res = await fetch(`${baseUrl}/api/auth/account-summary`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBeNull();
    expect(body.hasPassword).toBe(false);
    expect(body.deleteConfirmationPhrase).toBe('탈퇴합니다');

  });
});

describe('탈퇴', () => {
  it('로그인 없이는 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/delete-account`, { method: 'POST', body: JSON.stringify({ password: 'whatever' }) });
    expect(res.status).toBe(401);
  });

  it('🔒 틀린 비밀번호는 401 — 계정은 그대로 남는다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_delete_wrong@example.com', password: 'correct horse battery staple' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];

    const res = await fetch(`${baseUrl}/api/auth/delete-account`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ password: 'wrong password' }),
    });
    expect(res.status).toBe(401);

    const stillThere = await owner.query(`SELECT 1 FROM auth_credentials WHERE email = 'authtest_delete_wrong@example.com'`);
    expect(stillThere.rowCount).toBe(1);
  });

  it('🔒 올바른 비밀번호면 계정이 완전히 삭제되고, 세션도 즉시 무효화된다', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_delete_ok@example.com', password: 'correct horse battery staple' })),
    });
    const userId = (await signupRes.json()).userId;
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];

    const del = await fetch(`${baseUrl}/api/auth/delete-account`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    });
    expect(del.status).toBe(200);

    const gone = await owner.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    expect(gone.rowCount).toBe(0);
    const credentialsGone = await owner.query(`SELECT 1 FROM auth_credentials WHERE user_id = $1`, [userId]); // CASCADE 확인
    expect(credentialsGone.rowCount).toBe(0);

    const sessionAfter = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
    expect(sessionAfter.status).toBe(401);

    const loginAfter = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'authtest_delete_ok@example.com', password: 'correct horse battery staple' }),
    });
    expect(loginAfter.status).toBe(401);
  });

  it('🔒 다른 기기의 세션도 탈퇴와 함께 전부 무효화된다(/review 발견 — 기존엔 "이 요청의" 세션만 지웠다)', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_delete_multisession@example.com', password: 'correct horse battery staple' })),
    });
    const userId = (await signupRes.json()).userId;
    const primaryCookie = getCookie(signupRes, 'aic_session')!.split(';')[0];
    const otherDeviceCookie = `aic_session=${(await createSession(userId)).token}`; // "다른 기기"에서 로그인했다고 가정

    const del = await fetch(`${baseUrl}/api/auth/delete-account`, {
      method: 'POST',
      headers: { Cookie: primaryCookie },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    });
    expect(del.status).toBe(200);

    const otherDeviceAfter = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: otherDeviceCookie } });
    expect(otherDeviceAfter.status).toBe(401);
  });

  // 🔒 보안 점검 발견(2026-08-22) — 탈취한 세션 쿠키만 가진 공격자가 이 라우트를
  // 무제한 비밀번호 추측 오라클로 쓸 수 있었다(진짜 비밀번호를 몰라도 이 API로
  // 알아낼 수 있음 — 세션 탈취를 영구 계정 탈취로 격상). password-reset/request의
  // 레이트리밋 테스트(위)와 같은 패턴.
  it('🔒 세션당 레이트리밋 — 짧은 시간에 6번째 요청은 429(비밀번호 추측 오라클 방지)', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(validSignupBody({ email: 'authtest_delete_ratelimit@example.com', password: 'correct horse battery staple' })),
    });
    const cookie = getCookie(signupRes, 'aic_session')!.split(';')[0];

    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${baseUrl}/api/auth/delete-account`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ password: 'wrong guess' }),
      });
      results.push(res.status);
    }
    expect(results.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(results[5]).toBe(429);
  });

  // 🔒 /review 발견(testing, confidence 88) — 비밀번호가 없는 소셜 전용 계정의
  // 탈퇴 경로(확인 문구 분기)가 완전히 미검증이었다. 탈퇴는 되돌릴 수 없는
  // 하드 삭제라(§6.1, 소프트 삭제 안 씀) 이 분기가 조용히 깨져 있으면 계정을
  // 영영 못 지우거나, 반대로 문구 비교가 잘못돼 아무 값이나 통과할 수 있다.
});


// 🔒 소셜 로그인은 생년월일·거주 국가를 안 준다 — 카카오는 이메일도 안 줄 수
// 있다. 계정을 먼저 만들고(findOrCreateOAuthUser) /onboarding에서 뒤늦게
// 채운다. auth.ts의 findOrCreateOAuthUser 주석 참고.
