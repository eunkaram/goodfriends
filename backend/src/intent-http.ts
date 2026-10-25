/**
 * §11.9.2 의도 보존 라우트 — goodfriends 이관본.
 * 원본 Reafy에선 http-server.ts에 있었지만, 그 파일은 커스텀 Next 합성 서버라
 * 1차 이관에서 제외했다 — 라우트 3개만 뽑아 별도 모듈로 재작성했다.
 * 두 파일(intent-session.ts·intent-execution.ts)과 한 트리오.
 *
 * 처리했으면 true, 아니면 false를 반환한다 — server.ts가 false일 때 404를 낸다.
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { readBody, json } from './http-utils.ts';
import { isUuid } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId, parseCookieHeader } from './session.ts';
import { isEmailVerified } from './auth.ts';
import { resolvePostId } from './posts.ts';
import {
  createIntentSession,
  consumeIntentSession,
  readIntentSession,
  type Intent,
} from './intent-session.ts';
import { executeIntent } from './intent-execution.ts';

const INTENT_ACTIONS = new Set<Intent['action']>(['reaction', 'save', 'comment', 'friend_request', 'follow']);

/** targetId가 글(posts)을 가리키는 action만 — friend_request/follow는 유저 대상이라 users에 없는 public_id 해석이 의미 없다. */
const POST_TARGET_ACTIONS = new Set<Intent['action']>(['reaction', 'save', 'comment']);

/**
 * 🔒 /review 발견(red-team) — /api/intent/execute는 intent를 `JSON.parse(...)
 * as Intent` 타입 단언만 거치고 executeIntent에 그대로 넘겼다. 모르는 action은
 * executeIntent의 switch를 전부 빠져나가 undefined를 반환하고, 그걸
 * json(res, 200, undefined)에 넘기면 JSON.stringify(undefined)가 undefined를
 * 내놓아 Buffer.byteLength가 터진다 — 깔끔한 400 대신 잡히지 않는 예외였다.
 * targetId도 각 case 안에서 uuid 컬럼 비교에 바로 들어가므로 형식이 깨지면
 * 마찬가지로 잡히지 않는 500이 났다. emoticonType은 여기서 걸지 않는다 —
 * executeIntent의 reaction 분기가 이미 없거나 잘못된 값을 안전하게
 * blocked로 처리한다(크래시 경로가 아니다).
 *
 * /api/intent(저장)엔 이 검증을 적용하지 않는다 — 그 라우트는 DB에 아무것도
 * 쓰지 않고 Redis에 그대로 저장만 하며, 실제 실행 직전엔 여기서 다시 검증되므로
 * 저장 시점에 막을 이유가 없다(T22 테스트가 아직 존재하지 않는 게시물 id로
 * 저장만 해보는 것도 이 때문에 유효한 시나리오다).
 */
function isValidIntent(v: unknown): v is Intent {
  if (typeof v !== 'object' || v === null) return false;
  const intent = v as Partial<Intent>;
  if (!intent.action || !INTENT_ACTIONS.has(intent.action)) return false;
  if (!isUuid(intent.targetId)) return false;
  return true;
}

function parseCookie(req: IncomingMessage, name: string): string | null {
  return parseCookieHeader(req.headers.cookie, name);
}

export async function handleIntentRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 게이트 트리거 — 여기서만 세션이 생긴다(비로그인 방문자 전용).
  if (req.method === 'POST' && url.pathname === '/api/intent') {
    const body = JSON.parse(await readBody(req)) as Intent;
    const { token, setCookie } = await createIntentSession(body);
    res.writeHead(201, {
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie,
      'Cache-Control': 'private, no-store', // §9.1.1과 같은 원칙 — 개인화 응답은 캐시하지 않는다
    });
    res.end(JSON.stringify({ token }));
    return true;
  }

  // 로그인 직후 1회 소비. 실제 실행(반응 등록 등)은 여기서 하지 않는다 —
  // 저장된 intent만 반환하고, 실행과 권한 재검증은 /api/intent/execute 몫이다.
  if (req.method === 'POST' && url.pathname === '/api/intent/consume') {
    const token = parseCookie(req, 'aic_intent');
    if (!token) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    const intent = await consumeIntentSession(token);
    json(res, intent ? 200 : 404, intent ?? { error: 'NOT_FOUND' });
    return true;
  }

  // P4 — /api/intent/consume이 넘겨준 intent를 실제로 수행한다. 클라이언트가
  // action/targetId를 다시 보내오지만 "허용 여부"는 절대 클라이언트를 믿지
  // 않는다 — 여기서 §4.5 권한을 처음부터 다시 통과시킨다.
  if (req.method === 'POST' && url.pathname === '/api/intent/execute') {
    // §26(모바일) — 헤더(Authorization: Bearer)·쿠키 둘 다 받는다. 이 라우트는
    // 로그인 사용자가 반응/팔로우를 직접 실행할 때도 쓰는 공용 경로다
    // (relationships-http.ts 주석 참고).
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { intent, confirmed } = JSON.parse(await readBody(req)) as { intent: Intent; confirmed?: boolean };
    // 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을
    // 처리하는데 계속 에러가 뜬다") — 0038이 글 URL을 public_id로 바꾼 뒤로
    // 외부에 노출되는 유일한 글 식별자가 public_id(11자, uuid 아님)가 됐다.
    // 아래 isValidIntent()의 isUuid() 게이트(불변식 19)는 그대로 지키되, 글
    // 대상 action에 한해 uuid가 아닌 targetId를 먼저 public_id로 해석해본다.
    // 해석 실패(존재하지 않는 id)는 그대로 isValidIntent에서 걸려 400이 난다 —
    // 여기서 조용히 통과시키지 않는다.
    if (
      typeof intent?.targetId === 'string' &&
      POST_TARGET_ACTIONS.has(intent.action) &&
      !isUuid(intent.targetId)
    ) {
      const resolvedId = await resolvePostId(intent.targetId);
      if (resolvedId) intent.targetId = resolvedId;
    }
    // 🔒 사용자 지시(2026-08-24, "이메일 미인증 유저 공감하기 제한") — 반응만
    // 대상(save/follow/friend_request는 이번 제한 대상 아님). executeIntent의
    // ExecuteResult 유니언은 안 건드리고, 그 앞에서 별도 상태로 반환한다.
    if (intent?.action === 'reaction' && !(await isEmailVerified(userId))) {
      json(res, 200, { status: 'email_not_verified' });
      return true;
    }
    if (!isValidIntent(intent)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await executeIntent(userId, intent, confirmed === true);
    json(res, 200, result);
    return true;
  }

  return false;
}

/** T22 검증용 최소 서버 — 의도 보존 라우트만 있다. 프로덕션은 server.ts가 합성한다. */
export function createHttpServer(): Server {
  return createServer(async (req, res) => {
    try {
      const handled = await handleIntentRoutes(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
  });
}

export { readIntentSession };
