/**
 * 이메일 인증 · 비밀번호 재설정 토큰 — §6.1 "재발송 UI 필수", "찾기(임시 발급)"
 *
 * DB엔 토큰 원문이 아니라 SHA-256 해시만 저장한다(0012_auth.sql 설계 그대로) —
 * DB가 유출돼도 토큰을 재사용할 수 없게. 토큰 자체는 randomBytes(32) 기반
 * 고엔트로피 값이라 빠른 해시(SHA-256)로도 충분하다 — 비밀번호와 달리
 * 사용자가 고르는 값이 아니라 브루트포스 사전공격 대상이 아니다.
 */
import { randomBytes, createHash } from 'node:crypto';
import { authPool } from './db.ts';

// 🔒 /review 발견(red-team) — authPool()을 함수마다 새로 부르면 매번 새
// pg.Pool(최대 4커넥션)이 생긴다. auth.ts와 같은 이유로 모듈 스코프에서 한 번만 만든다.
const pool = authPool();

const EMAIL_TOKEN_TTL = '24 hours';
const RESET_TOKEN_TTL = '1 hour'; // 비밀번호 재설정은 더 짧게 — 탈취 시 악용 창구를 줄인다

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = newToken();
  await pool.query(
    `INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + $3::interval)`,
    [hashToken(token), userId, EMAIL_TOKEN_TTL],
  );
  return token;
}

/** 유효하면(만료 전·미소비) 소비하고 userId를 반환한다. 그 외엔 null. */
export async function consumeEmailVerificationToken(token: string): Promise<string | null> {
  const r = await pool.query<{ user_id: string }>(
    `UPDATE email_verification_tokens SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [hashToken(token)],
  );
  return r.rows[0]?.user_id ?? null;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = newToken();
  await pool.query(
    `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + $3::interval)`,
    [hashToken(token), userId, RESET_TOKEN_TTL],
  );
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const r = await pool.query<{ user_id: string }>(
    `UPDATE password_reset_tokens SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [hashToken(token)],
  );
  return r.rows[0]?.user_id ?? null;
}
