/**
 * 인증 핵심 로직 — §6.1
 *
 * HTTP 레이어(auth-http.ts)는 이 파일의 함수만 호출한다 — 라우팅 코드에
 * SQL이 섞이지 않게 한다. 전부 authPool()(community_app_auth)을 쓴다.
 *
 * ⚠️ username: PRD §6.1은 가입 필수 항목으로 이름(First/Last)·이메일·
 * 생년월일·거주 국가만 명시하고 별도 "아이디 선택" 단계가 없다. 그런데
 * `/@{username}` 라우팅(§3.2)엔 username이 필요하다 — 이메일 로컬파트에서
 * 파생시키고 충돌하면 숫자를 붙인다. 나중에 "핸들 변경" 화면이 생기면
 * 여기서 만든 값은 그냥 초기값이 된다.
 */
import type pg from 'pg';
import { authPool } from './db.ts';
import { redis } from './redis.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { createSession, destroyAllSessionsForUser } from './session.ts';
import {
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  createPasswordResetToken,
  consumePasswordResetToken,
} from './verification-tokens.ts';
import { sendVerificationEmail, sendPasswordResetEmail, sendEmailChangedNotice } from './email.ts';
import { createDefaultUserLog } from './user-log.ts';
import { RESERVED_USERNAMES } from './reserved-usernames.ts';
import { isReservedNickname } from './reserved-nicknames.ts';

export type SignUpInput = {
  nickname: string;
  email: string;
  password: string;
  birthdate: string; // YYYY-MM-DD
  country: string; // ISO 3166-1 alpha-2, 예: KR, US — 2026-08 재도입(프로필 위치 표시용, age-gate.ts 참고)
  postalCode?: string;
};

export type AuthResult =
  // 🔒 GitHub #1(2026-08-29) — token은 setCookie와 같은 값(createSession()의
  // 반환값 그대로)이다. Secure 쿠키는 RN fetch가 JS에서 읽을 수 없고, 로컬
  // HTTP 개발 백엔드에서는 Secure 속성 때문에 네이티브 쿠키 저장소에도 안
  // 실려서(HTTPS 전용) 모바일이 로그인 토큰을 얻을 방법이 setCookie 파싱
  // 말고는 없었다 — 새 노출이 아니라 이미 나가던 값을 바디에도 실어주는 것.
  | { ok: true; userId: string; setCookie: string; token: string }
  | { ok: false; error: 'EMAIL_TAKEN' | 'RECENTLY_DELETED' | 'UNDERAGE' | 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'NO_PASSWORD_SET' | 'ACCOUNT_BANNED' };

/**
 * 🔒 eng-review outside voice 발견(2026-08) — 밴 킬스위치(destroyAllSessionsForUser)는
 * *기존* 세션만 끊는다. 로그인 경로 자체가 is_banned를 안 보면 비밀번호만
 * 다시 넣어 즉시 재로그인할 수 있다. signInWithEmail·findOrCreateOAuthUser
 * 양쪽 모두(로그인 경로가 두 개다) 기존 유저를 세션 발급 직전에 이 함수로
 * 확인한다. authPool()은 이미 users에 SELECT 권한이 있다(0012).
 */
async function isBanned(userId: string): Promise<boolean> {
  const r = await pool.query<{ is_banned: boolean }>(`SELECT is_banned FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.is_banned ?? false;
}

// 🔒 /review 발견(red-team) — 이 파일이 함수마다 authPool()을 새로 호출하고
// 있었다. authPool()은 매번 새 pg.Pool(최대 4커넥션)을 만든다 — 다른 모든
// src/*.ts 파일처럼 모듈 스코프에서 한 번만 만들어 재사용해야, PgBouncer
// 기본 풀 크기(3)보다 많은 동시 가입/로그인이 몰려도 커넥션을 고갈시키지 않는다.
const pool = authPool();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 🔒 outside voice 발견(2026-08-22) — signUpWithEmail/signInWithEmail/
// findOrCreateOAuthUser는 이메일을 원문 그대로 비교·저장했고 updateEmail만
// trim+lowercase했다. `A@x.com`으로 가입하고 `a@x.com`으로 로그인/온보딩하면
// 서로 다른 값으로 취급돼 EMAIL_TAKEN·로그인실패가 났다 — 세 곳 모두 이
// 헬퍼로 통일한다.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === code;
}

async function uniqueUsernameFrom(client: pg.PoolClient, email: string): Promise<string> {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20) || 'user';
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 10000)}`;
    if (RESERVED_USERNAMES.has(candidate)) continue;
    const exists = await client.query('SELECT 1 FROM users WHERE username = $1', [candidate]);
    if (exists.rowCount === 0) return candidate;
  }
  throw new Error('username generation exhausted attempts');
}

export async function signUpWithEmail(input: SignUpInput): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (
    !input.nickname?.trim() ||
    !EMAIL_RE.test(email) ||
    !input.password ||
    input.password.length < 8 ||
    !input.country?.trim()
  ) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  if (isReservedNickname(input.nickname)) return { ok: false, error: 'INVALID_INPUT' };

  const birthdate = new Date(input.birthdate);
  if (Number.isNaN(birthdate.getTime())) return { ok: false, error: 'INVALID_INPUT' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT 1 FROM auth_credentials WHERE email = $1', [email]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'EMAIL_TAKEN' };
    }

    // 🔒 사용자 지시(2026-08-24, "탈퇴 후 7일간 같은 이메일 재가입 금지") —
    // users는 하드 삭제(0013)라 여기 없다고 재가입 가능한 게 아니다 —
    // 별도 보관 테이블(0041)에서 최근 7일 내 탈퇴 여부를 따로 확인한다.
    const recentlyDeleted = await client.query(
      `SELECT 1 FROM deleted_account_emails WHERE email = $1 AND deleted_at > now() - interval '7 days'`,
      [email],
    );
    if ((recentlyDeleted.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'RECENTLY_DELETED' };
    }

    const username = await uniqueUsernameFrom(client, email);
    const userRow = await client.query<{ id: string }>(
      `INSERT INTO users (username, nickname, birthdate, country, postal_code)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, input.nickname.trim(), input.birthdate, input.country, input.postalCode ?? null],
    );
    const userId = userRow.rows[0].id;

    const passwordHash = await hashPassword(input.password);
    await client.query(
      `INSERT INTO auth_credentials (user_id, email, password_hash) VALUES ($1, $2, $3)`,
      [userId, email, passwordHash],
    );

    await client.query('COMMIT');

    // 🔒 이메일 발송 실패가 회원가입 자체를 막으면 안 된다 — 실패해도 계정은 이미 만들어졌다.
    // 재발송 버튼(resendVerificationEmail)이 안전망이다.
    try {
      const token = await createEmailVerificationToken(userId);
      await sendVerificationEmail(email, token);
    } catch (err) {
      console.error('verification email send failed (signup still succeeded):', err);
    }

    // §6.4 UserLog는 User와 1:1이다. authPool엔 user_logs GRANT가 없어(자격증명
    // 격리, §6.1) 별도 역할로 커밋 후 만든다 — 실패해도 가입은 막지 않는다.
    try {
      await createDefaultUserLog(userId);
    } catch (err) {
      console.error('default user_logs row creation failed (signup still succeeded):', err);
    }

    const { token, setCookie } = await createSession(userId);
    return { ok: true, userId, setCookie, token };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 🔒 보안 점검 발견(2026-08-22) — 이메일이 없거나 소셜 전용 계정(비밀번호 없음)일
// 땐 scrypt 호출 없이 즉시 반환해서, 응답 시간만으로 "이 이메일에 비밀번호
// 계정이 존재하는지"가 새어나갔다(계정 열거 — 틀린 비밀번호 검증은 수십 ms
// 걸리지만 이 두 경로는 거의 즉시 반환). NO_PASSWORD_SET 에러 코드 자체는
// app/signin/page.tsx의 실제 안내 문구("소셜 로그인으로 가입된 계정이에요")로
// 쓰이는 의도된 UX라 남겨두되, 시간 차이만 없앤다 — 두 조기 반환 경로에서도
// 진짜 검증과 똑같은 비용의 더미 scrypt를 한 번 태우고 결과는 버린다.
const DUMMY_HASH_FOR_TIMING = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export async function signInWithEmail(rawEmail: string, password: string): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email) || !password) return { ok: false, error: 'INVALID_INPUT' };

  const r = await pool.query<{ user_id: string; password_hash: string | null }>(
    `SELECT user_id, password_hash FROM auth_credentials WHERE email = $1`,
    [email],
  );
  if (r.rowCount === 0) {
    await verifyPassword(password, DUMMY_HASH_FOR_TIMING).catch(() => {});
    return { ok: false, error: 'INVALID_CREDENTIALS' };
  }

  const { user_id: userId, password_hash: passwordHash } = r.rows[0];
  if (!passwordHash) {
    // 소셜 전용 계정
    await verifyPassword(password, DUMMY_HASH_FOR_TIMING).catch(() => {});
    return { ok: false, error: 'NO_PASSWORD_SET' };
  }

  const valid = await verifyPassword(password, passwordHash);
  if (!valid) return { ok: false, error: 'INVALID_CREDENTIALS' };

  if (await isBanned(userId)) return { ok: false, error: 'ACCOUNT_BANNED' };

  const { token, setCookie } = await createSession(userId);
  return { ok: true, userId, setCookie, token };
}



// 🔒 CEO 리뷰(2026-08-22, 카카오 무이메일 온보딩) — 카카오가 이메일을 주긴
// 주는데 검증은 안 된 경우(is_email_verified: false), findOrCreateOAuthUser는
// 그 값을 auth_credentials에 못 넣는다(자동연결 금지 원칙, 위 주석 참고) — 예전엔
// 그냥 버렸다. 대신 온보딩 화면이 프리필용으로 잠깐 꺼내 쓸 수 있게 Redis에
// 짧게 스탬프한다(oauth.ts의 oauth_state 패턴과 동일). 사용자가 어차피 온보딩에서
// 직접 확인/수정하므로 여기 저장된 값 자체가 신뢰의 근거가 되는 건 아니다.
const SUGGESTED_EMAIL_TTL_SECONDS = 30 * 60;

function suggestedEmailKey(userId: string): string {
  return `onboarding_suggested_email:${userId}`;
}


/** 실패하면 null — 프리필은 편의 기능이라 온보딩 자체를 막지 않는다. */
export async function getSuggestedEmail(userId: string): Promise<string | null> {
  return redis()
    .get(suggestedEmailKey(userId))
    .catch(() => null);
}

/**
 * 소셜 로그인 — 기존 연결이 있으면 로그인, 없으면 새 계정을 만든다.
 *
 * 🔒 계정 병합: 소셜 프로필의 이메일이 이미 가입된 이메일과 같고 **제공자가
 * 그 이메일을 검증했다면**(emailVerified) 새 계정을 또 만들지 않고 기존
 * 계정에 이 소셜 로그인을 연결한다 — 안 그러면 같은 사람이 이메일 가입
 * 계정과 소셜 계정을 각각 따로 갖는 유령 중복 계정이 생긴다. 검증 안 된
 * 이메일이면(제공자가 그렇게 응답하면) 절대 자동 연결하지 않는다 — 계정
 * 탈취 경로가 될 수 있다. 이 경우 새 계정을 만들되 그 이메일은 기록하지
 * 않는다(auth_credentials.email은 UNIQUE라 겹치는 값을 넣을 수 없다).
 *
 * ⚠️ §6.1의 생년월일·거주 국가는 소셜 프로필이 안 준다 — 연령 게이팅(국가별
 * 최소연령이라 국가도 필요하다, age-gate.ts)을 여기서 할 수 없다. 대신 계정을
 * 일단 만들고(또는 연결하고), HTTP 레이어(auth-http.ts)가 `needsOnboarding()`
 * 으로 확인해 `/onboarding`으로 보낸다. 거기서 미달로 밝혀지면
 * `completeOnboarding`이 이미 만들어진 계정을 사후에 삭제한다 — 이메일
 * 가입이 "계정 생성 자체를 막는" 것과 결과적으로 같은 정책을, 순서만
 * 바꿔서(선가입-후검증) 적용하는 것.
 */

// ─────────────────────────────────────────────────────────────
// 소셜 가입 온보딩 — 생년월일·거주 국가·(카카오 무이메일이면) 이메일 뒤늦게
// 수집 (findOrCreateOAuthUser 주석 참고)
// ─────────────────────────────────────────────────────────────

export type OnboardingStatus = { birthdate: boolean; country: boolean; email: boolean };

/**
 * 로그인 직후(신규·기존 계정 무관) 이 유저에게 /onboarding에서 뭘 더 받아야
 * 하는지 — 필드별로 따로 반환한다.
 *
 * 🔒 CEO 리뷰(2026-08-22) 발견 — 예전엔 boolean 하나였다. 생년월일·국가를
 * 이미 채운 기존 카카오 무이메일 유저가 이번 변경으로 다음 로그인 때 다시
 * /onboarding에 걸리는데, boolean 하나면 이미 있는 값까지 다시 입력하라고
 * 강요하게 된다 — 필드별로 쪼개 실제로 빠진 것만 요구한다.
 */
export async function needsOnboarding(userId: string): Promise<OnboardingStatus> {
  const [userRow, credRow] = await Promise.all([
    pool.query<{ birthdate: Date | null; country: string | null }>(`SELECT birthdate, country FROM users WHERE id = $1`, [userId]),
    pool.query('SELECT 1 FROM auth_credentials WHERE user_id = $1', [userId]),
  ]);
  const row = userRow.rows[0];
  return {
    birthdate: !row || row.birthdate === null,
    country: !row || row.country === null,
    email: (credRow.rowCount ?? 0) === 0,
  };
}

export type CompleteOnboardingResult = { ok: true } | { ok: false; error: 'INVALID_INPUT' | 'UNDERAGE' | 'EMAIL_TAKEN' };

/**
 * 세 필드 다 optional — 클라이언트가 needsOnboarding()으로 실제 빠진 것만
 * 보내온다(이미 채워진 필드를 재입력하라고 강요하지 않는다).
 *
 * 🔒 outside voice 발견(2026-08-22) — 생년월일·국가 처리와 이메일 처리 순서가
 * 중요하다. UNDERAGE면 이 함수가 계정을 하드 삭제하는데(아래), 이메일을
 * 먼저 처리해버리면 (a) 삭제 후 이메일 INSERT가 FK 위반으로 500이 나거나
 * (b) 곧 삭제될 계정 주소로 인증메일이 나간다. 그래서 생년월일·국가(연령
 * 게이팅)를 항상 먼저 확정하고, 통과했을 때만 이메일을 처리한다.
 */
export async function completeOnboarding(
  userId: string,
  input: { birthdate?: string; country?: string; postalCode?: string; email?: string },
): Promise<CompleteOnboardingResult> {
  if (input.birthdate !== undefined || input.country !== undefined) {
    const birthdate = new Date(input.birthdate ?? '');
    if (Number.isNaN(birthdate.getTime()) || !input.country?.trim()) return { ok: false, error: 'INVALID_INPUT' };

    // 🔒 사용자 지시(2026-08-23) — signUpWithEmail의 postalCode와 같은 이유로
    // 선택 입력이다(§6.1 "선택. 마켓 진입 시 유도") — 생년월일·국가와 같이
    // 뜨는 시점에만 받는다(이후 재방문에선 이 블록 자체를 안 탄다).
    await pool.query(`UPDATE users SET birthdate = $1, country = $2, postal_code = $3 WHERE id = $4`, [
      input.birthdate,
      input.country,
      input.postalCode?.trim() || null,
      userId,
    ]);
  }

  if (input.email !== undefined) {
    // 소셜 전용 계정이라 password_hash가 없어 currentPassword 재확인은 건너뛴다
    // (updateEmail 자체 로직, 위 주석 참고).
    const emailResult = await updateEmail(userId, input.email);
    if (!emailResult.ok) {
      return { ok: false, error: emailResult.error === 'EMAIL_TAKEN' ? 'EMAIL_TAKEN' : 'INVALID_INPUT' };
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 이메일 인증 — §6.1 "토큰 발급·검증·재발송 UI 필수"
//
// 인증 여부는 로그인·글쓰기를 막지 않는다(§11.9.3 "온보딩에서 첫 글
// 강제하지 않음"과 같은 원칙 — 진입장벽을 늘리지 않는다). UI가 배너로
// 상태만 보여주고 재발송 버튼을 제공한다.
// ─────────────────────────────────────────────────────────────

export type VerifyEmailResult = { ok: true } | { ok: false; error: 'INVALID_OR_EXPIRED_TOKEN' };

export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  const userId = await consumeEmailVerificationToken(token);
  if (!userId) return { ok: false, error: 'INVALID_OR_EXPIRED_TOKEN' };
  await pool.query(`UPDATE auth_credentials SET email_verified_at = now() WHERE user_id = $1`, [userId]);
  return { ok: true };
}

/**
 * 소셜 전용 계정이라 이메일이 없으면(검증할 게 없으므로) true를 반환한다.
 * 🔒 사용자 지시(2026-08-25, "에이전트로 처리된 유저는 ai 봇이니까 이메일
 * 인증이 안되어있더라도 글을 작성 할수 있게") — is_agent(0043)는 users에
 * 있고 authPool()은 이미 users에 SELECT 권한이 있어(주석 위 참고) 여기서
 * 바로 조회한다.
 */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const agent = await pool.query<{ is_agent: boolean }>(`SELECT is_agent FROM users WHERE id = $1`, [userId]);
  if (agent.rows[0]?.is_agent) return true;

  const r = await pool.query<{ email_verified_at: Date | null }>(
    `SELECT email_verified_at FROM auth_credentials WHERE user_id = $1`,
    [userId],
  );
  if (r.rowCount === 0) return true;
  return r.rows[0].email_verified_at !== null;
}

// ─────────────────────────────────────────────────────────────
// 이메일 변경 — 사용자 지시(2026-08, "프로필 수정에서... 아이디 있던
// 부분에 이메일을 보여줘. 수정가능하면 좋을것 같아")
//
// email은 users가 아니라 auth_credentials에 있다(§6.1 자격증명 격리,
// 파일 헤더 주석). 소셜 전용 계정은 이 테이블에 행 자체가 없을 수 있어
// (findOrCreateOAuthUser 참고) getUserEmail은 null을 반환할 수 있다.
// ─────────────────────────────────────────────────────────────

/** 소셜 전용 계정이라 행이 없으면 null. */
export async function getUserEmail(userId: string): Promise<string | null> {
  const r = await pool.query<{ email: string }>(`SELECT email FROM auth_credentials WHERE user_id = $1`, [userId]);
  return r.rows[0]?.email ?? null;
}

/**
 * 🔒 보안 점검 발견(2026-08-22) — 이메일 변경 시 비밀번호 재확인 UI를
 * 보여줄지(계정에 비밀번호가 있는지) 클라이언트가 미리 알아야 한다 —
 * updateEmail()의 재인증 요구와 짝을 이룬다.
 */
export async function hasPassword(userId: string): Promise<boolean> {
  const r = await pool.query<{ password_hash: string | null }>(`SELECT password_hash FROM auth_credentials WHERE user_id = $1`, [userId]);
  return r.rows[0]?.password_hash != null;
}

export async function isEmailAvailable(email: string, excludeUserId: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) return false;
  const taken = await pool.query(`SELECT 1 FROM auth_credentials WHERE email = $1 AND user_id <> $2`, [normalized, excludeUserId]);
  return (taken.rowCount ?? 0) === 0;
}

export type UpdateEmailResult = { ok: true } | { ok: false; error: 'EMAIL_TAKEN' | 'INVALID_INPUT' | 'INVALID_CREDENTIAL' };

/**
 * 🔒 이메일이 실제로 바뀌면 email_verified_at을 다시 NULL로 돌리고 새
 * 인증 메일을 보낸다 — 예전 이메일로 인증된 상태를 새 이메일에 그대로
 * 물려주면 소유권 확인 없이 "인증됨"이 찍히는 구멍이 생긴다. 그대로
 * 제출된 경우(값 안 바뀜)는 재인증을 건드리지 않는다.
 *
 * 소셜 전용 계정(행 없음)도 이 경로로 이메일을 처음 추가할 수 있다 —
 * findOrCreateOAuthUser가 검증된 소셜 이메일을 넣을 때와 같은 모양으로
 * password_hash 없이 INSERT한다(나중에 "비밀번호 추가" 흐름이 그 행을
 * UPDATE하면 된다, findOrCreateOAuthUser 주석과 동일 원칙).
 *
 * 🔒 보안 점검 발견(2026-08-22) — 세션 쿠키만으로 이메일을 바꿀 수 있어서,
 * 탈취된 세션이 "이메일 변경 → 비밀번호 재설정 요청"으로 영구 계정 탈취로
 * 이어질 수 있었다. deleteAccount()와 같은 재인증 원칙을 적용한다 — 비밀번호가
 * 이미 있는 계정은 그 비밀번호를 다시 확인해야만 이메일을 바꿀 수 있다.
 * (비밀번호가 아예 없는 소셜 전용 계정은 이 경로로 애초에 requestPasswordReset이
 * 안 먹혀 — 그 함수가 password_hash IS NOT NULL을 요구한다 — 같은 탈취 경로가
 * 성립하지 않는다, 재확인 요구 안 함.)
 */
export async function updateEmail(userId: string, newEmail: string, currentPassword?: string): Promise<UpdateEmailResult> {
  const email = normalizeEmail(newEmail);
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'INVALID_INPUT' };

  const r = await pool.query<{ email: string | null; password_hash: string | null }>(
    `SELECT email, password_hash FROM auth_credentials WHERE user_id = $1`,
    [userId],
  );
  const current = r.rows[0]?.email ?? null;
  const passwordHash = r.rows[0]?.password_hash ?? null;
  if (current === email) return { ok: true }; // 그대로 제출 — 재인증 건드리지 않는다

  if (passwordHash) {
    if (!currentPassword || !(await verifyPassword(currentPassword, passwordHash))) {
      return { ok: false, error: 'INVALID_CREDENTIAL' };
    }
  }

  if (!(await isEmailAvailable(email, userId))) return { ok: false, error: 'EMAIL_TAKEN' };

  try {
    await pool.query(
      `INSERT INTO auth_credentials (user_id, email, email_verified_at) VALUES ($1, $2, NULL)
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, email_verified_at = NULL`,
      [userId, email],
    );
  } catch (err) {
    // 🔒 위 중복확인과 이 쓰기 사이의 찰나에 다른 요청이 같은 이메일을 먼저
    // 가져갈 수 있다(TOCTOU) — auth_credentials.email UNIQUE가 최종
    // 방어선이라 그 위반(23505)을 같은 EMAIL_TAKEN으로 정리한다
    // (updateProfile의 username 레이스 처리와 같은 패턴, user-log.ts 참고).
    if (isPgError(err, '23505')) return { ok: false, error: 'EMAIL_TAKEN' };
    throw err;
  }

  // 🔒 인증 메일 발송 실패가 이메일 변경 자체를 막으면 안 된다(signUpWithEmail과
  // 같은 원칙) — 재발송 버튼이 안전망이다.
  try {
    const token = await createEmailVerificationToken(userId);
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error('verification email send failed (email change still succeeded):', err);
  }

  // 🔒 보안 점검 발견(2026-08-22) — 예전 주소로 알림을 보낸다(있었을 때만 —
  // 소셜 전용 계정이 이메일을 처음 추가하는 경우엔 알릴 "예전 주소"가 없다).
  // 발송 실패도 위와 같은 이유로 변경 자체를 막지 않는다.
  if (current) {
    try {
      await sendEmailChangedNotice(current, email);
    } catch (err) {
      console.error('email-changed notice send failed (email change still succeeded):', err);
    }
  }

  return { ok: true };
}

export type ResendResult = { ok: true } | { ok: false; error: 'ALREADY_VERIFIED' | 'NOT_FOUND' };

export async function resendVerificationEmail(userId: string): Promise<ResendResult> {
  const r = await pool.query<{ email: string; email_verified_at: Date | null }>(
    `SELECT email, email_verified_at FROM auth_credentials WHERE user_id = $1`,
    [userId],
  );
  if (r.rowCount === 0) return { ok: false, error: 'NOT_FOUND' };
  if (r.rows[0].email_verified_at) return { ok: false, error: 'ALREADY_VERIFIED' };

  const token = await createEmailVerificationToken(userId);
  await sendVerificationEmail(r.rows[0].email, token);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 비밀번호 재설정 — §6.1 "찾기(임시 발급)"
//
// 🔒 requestPasswordReset은 이메일 존재 여부와 무관하게 항상 같은 결과를
// 반환한다 — 응답 모양으로 "이 이메일로 가입된 계정이 있는지"가 새면
// 계정 존재 여부 스캐닝에 악용된다.
// ─────────────────────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<void> {
  const r = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM auth_credentials WHERE email = $1 AND password_hash IS NOT NULL`,
    [email],
  );
  if (r.rowCount === 0) return; // 계정 없음 또는 소셜 전용 — 응답은 그래도 동일하게 성공 처리
  const token = await createPasswordResetToken(r.rows[0].user_id);
  await sendPasswordResetEmail(email, token);
}

export type ResetPasswordResult = { ok: true } | { ok: false; error: 'INVALID_OR_EXPIRED_TOKEN' | 'INVALID_INPUT' };

export async function confirmPasswordReset(token: string, newPassword: string): Promise<ResetPasswordResult> {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: 'INVALID_INPUT' };

  const userId = await consumePasswordResetToken(token);
  if (!userId) return { ok: false, error: 'INVALID_OR_EXPIRED_TOKEN' };

  const passwordHash = await hashPassword(newPassword);
  await pool.query(`UPDATE auth_credentials SET password_hash = $1 WHERE user_id = $2`, [passwordHash, userId]);
  // 남은 재설정 토큰(다른 이메일에서 또 눌렀을 수 있음)도 전부 무효화한다
  await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND consumed_at IS NULL`, [userId]);
  // 🔒 /review 발견 — 세션 쿠키를 탈취당한 뒤 "비밀번호를 바꿨으니 안전하다"고
  // 여겨도, 세션을 안 끊으면 공격자가 그대로 로그인 상태를 유지할 수 있었다.
  await destroyAllSessionsForUser(userId);

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 탈퇴 — §6.1 "안내 → 확인 → 완료 3단계"
//
// 하드 삭제, 되돌릴 수 없다(0013_account_deletion.sql 참고 — 유예기간 없음,
// 의도적 선택). "확인" 단계는 되돌릴 수 없는 파괴적 동작의 관례대로 재입력을
// 요구한다 — 비밀번호가 있는 계정은 비밀번호로, 소셜 전용 계정은 확인 문구로.
// ─────────────────────────────────────────────────────────────

export type DeleteAccountResult = { ok: true } | { ok: false; error: 'INVALID_CREDENTIAL' };

const DELETE_CONFIRMATION_PHRASE = '탈퇴합니다';

export type AccountSummary = {
  username: string;
  nickname: string;
  /** users.avatar_url은 NOT NULL DEFAULT ''(0026) — UserLogProfile.avatarUrl과 같은 계약, 비어있으면 이니셜 아바타로 폴백. */
  avatarUrl: string;
  email: string | null;
  joinedAt: string;
  hasPassword: boolean;
  /** 소셜 전용 계정(비밀번호 없음)일 때만 채워진다 — 탈퇴 확인 단계가 재입력을
   * 요구할 문구. 클라이언트가 이 문구를 직접 알 필요 없이 서버가 알려준다. */
  deleteConfirmationPhrase: string | null;
};

/** §6.1 탈퇴 "안내" 단계 — 삭제 전 계정 기본정보를 보여준다. */
export async function getAccountSummary(userId: string): Promise<AccountSummary | null> {
  const [userRow, email, withPassword] = await Promise.all([
    pool.query<{ username: string; nickname: string; avatar_url: string; created_at: Date }>(
      `SELECT username, nickname, avatar_url, created_at FROM users WHERE id = $1`,
      [userId],
    ),
    getUserEmail(userId),
    hasPassword(userId),
  ]);
  const row = userRow.rows[0];
  if (!row) return null;
  return {
    username: row.username,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    email,
    joinedAt: row.created_at.toISOString(),
    hasPassword: withPassword,
    deleteConfirmationPhrase: withPassword ? null : DELETE_CONFIRMATION_PHRASE,
  };
}

export async function deleteAccount(
  userId: string,
  credential: { password?: string; confirmationPhrase?: string },
): Promise<DeleteAccountResult> {
  const r = await pool.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM auth_credentials WHERE user_id = $1`,
    [userId],
  );
  const passwordHash = r.rows[0]?.password_hash ?? null;

  if (passwordHash) {
    if (!credential.password || !(await verifyPassword(credential.password, passwordHash))) {
      return { ok: false, error: 'INVALID_CREDENTIAL' };
    }
  } else {
    // 소셜 전용 계정 — 비밀번호가 없으니 확인 문구로 대신한다
    if (credential.confirmationPhrase !== DELETE_CONFIRMATION_PHRASE) {
      return { ok: false, error: 'INVALID_CREDENTIAL' };
    }
  }

  // 🔒 사용자 지시(2026-08-24, "탈퇴 후 7일간 같은 이메일 재가입 금지") —
  // users를 지우기 전에 이메일을 따로 남겨둔다(소셜 전용 계정은 email이
  // null일 수 있어 그 경우는 건너뛴다 — 재가입 제한 자체가 불필요).
  const email = await getUserEmail(userId);
  if (email) {
    await pool.query(
      `INSERT INTO deleted_account_emails (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET deleted_at = now()`,
      [email],
    );
  }

  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  // 🔒 같은 이유로(/review) — HTTP 라우트가 "지금 이 요청의" 세션 쿠키만
  // 지우고 있었다. 다른 기기에 남아있던 세션은 계정이 없어진 뒤에도
  // Redis TTL이 끝날 때까지(최대 30일) 살아있었다.
  await destroyAllSessionsForUser(userId);
  return { ok: true };
}
