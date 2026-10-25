/**
 * 익명 세션 지연 발급 — 의도 보존 (PRD §11.9.2, T22) — goodfriends 이관본
 *
 * 🔒 공개 GET 응답에는 이 모듈이 절대 관여하지 않는다. 게이트를 실제로
 * 건드린 POST 1회에서만 세션이 생긴다 — §11.7.4 SEO 캐싱을 살리는 전제.
 *
 * 세션은 로그인 세션이 아니다. 비로그인 방문자가 게이트(반응·저장·댓글)를
 * 건드렸을 때 "무엇을 하려 했는지"만 30분간 기억해두는 1회성 저장소다.
 */
import { randomBytes } from 'node:crypto';
import { redis } from './redis.ts';

export const INTENT_COOKIE = 'aic_intent';
const TTL_SECONDS = 30 * 60; // §11.9.2 만료 30분

/** §11.10.1 반응 6종. reactions.emoticon_type CHECK 제약과 값이 일치해야 한다(0001_schema.sql). */
export type EmoticonType = 'empathy' | 'cheer' | 'funny' | 'surprise' | 'sad' | 'helpful';

export type Intent = {
  action: 'reaction' | 'save' | 'comment' | 'friend_request' | 'follow';
  targetId: string;
  returnTo: string;
  /** 댓글 초안 — §11.9.2 "본문 복원 + 포커스. 자동 제출 금지" */
  draft?: string;
  /** action === 'reaction'일 때만 — §11.10.1 6종 중 어떤 걸 눌렀는지 */
  emoticonType?: EmoticonType;
};

export const INTENT_ACTIONS = ['reaction', 'save', 'comment', 'friend_request', 'follow'] as const;

function keyFor(token: string) {
  return `intent:${token}`;
}

/** 게이트 POST에서만 호출한다. 공개 GET 경로에서 호출하면 P3가 깨진다. */
export async function createIntentSession(intent: Intent): Promise<{ token: string; setCookie: string }> {
  const token = randomBytes(24).toString('base64url');
  await redis().set(keyFor(token), JSON.stringify(intent), 'EX', TTL_SECONDS);
  // Secure 는 HTTPS 필수 — localhost/127.0.0.1은 브라우저가 예외 처리해 평문
  // HTTP에서도 저장된다(실측: browse cookies). 프로덕션 전 HTTPS로 재검증할 것.
  const setCookie = `${INTENT_COOKIE}=${token}; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}; Path=/`;
  return { token, setCookie };
}

export async function readIntentSession(token: string): Promise<Intent | null> {
  const raw = await redis().get(keyFor(token));
  return raw ? (JSON.parse(raw) as Intent) : null;
}

/**
 * 로그인 직후 1회 소비. §11.9.2: 반응·저장은 자동 실행, 댓글은 본문만
 * 복원(자동 제출 금지), 친구신청/팔로우는 확인 후 실행 — 이 함수는 저장된
 * 의도를 반환할 뿐 실행하지 않는다. 실행 여부와 방식은 호출부(라우트 핸들러)
 * 책임이다.
 *
 * 🔒 실행 직전 §4.5 권한 함수를 다시 통과시켜야 한다(P4) — 저장 시점과
 * 실행 시점 사이에 차단·삭제가 있을 수 있다. 이 함수는 그 재검증을 하지
 * 않는다 — 호출부가 반환된 targetId로 RLS 쿼리를 다시 태워야 한다.
 */
export async function consumeIntentSession(token: string): Promise<Intent | null> {
  const key = keyFor(token);
  const raw = await redis().get(key);
  if (!raw) return null;
  await redis().del(key);
  return JSON.parse(raw) as Intent;
}

export const CLEAR_INTENT_COOKIE = `${INTENT_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
