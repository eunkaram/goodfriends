/**
 * 라운지 채팅 WS 서버 — M4. `/ws/lounge` 업그레이드(Redis 와 피어 소켓 현황은
 * ws-server.ts): 단일 전체방, 접속(인증) → 최근 기록 히스토리 전송 → 발언을
 * insert → 브로드캐스트.
 *
 * 🔒 재사용된 안전장치(원본 ws-server.ts가 실전 발견으로 세운 것 — 모두 이 모듈에
 *도 동일세면이 적용된다):
 *  1. 연결 값 60초마다 세션 재검증 — 세션 삭제(로그아웃·비밃i되 재설정) 후
 *     열린 탭이 계속 수신하는 노출 창을 유한으로 줄인다.
 *  2. 발언은 Redis 고정 윈도우 레이트리밋(분당 10건) — 채팅 스팸 1차 방어.
 *     429를 준다 대신 WS는 {type:'error', code:'RATE_LIMITED'} 프레임.
 *  3. 발언 author는 세션 유도 값 외에 받지 않는다(0052 장부 조작 방지 로직).
 */
import type { WebSocket as ClientSocket } from 'ws';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { getSessionUserId, parseCookieHeader, SESSION_COOKIE } from './session.ts';
import { recentMessages, insertMessage, chatBodyTooLong, MAX_CHAT_BODY_LENGTH, fetchPresenceInfo, type ChatMessage, type PresenceUserInfo } from './lounge.ts';
import { checkRateLimit } from './rate-limit.ts';
import { isUuid } from './http-utils.ts';

const SESSION_RECHECK_MS = 60_000;
const CHAT_RATE_LIMIT = 10;
const CHAT_RATE_WINDOW_SECONDS = 60;
/** 🔒 실전 발견(2026-10, 사용자 질문 "다른 페이지로 가면 여기 접속 목록에서
 * 빠지나?" 확인 중) — 평범한 `<a href>`(Next `<Link>` 아님)로 페이지를
 * 떠나는 전체 새로고침 내비게이션은 브라우저가 WebSocket close 프레임을
 * 안정적으로 보내지 않을 수 있다(관찰: 30초 넘게 기다려도 서버가 close
 * 이벤트를 못 받아 접속자 목록에 유령으로 계속 남음). ws/pong 핑퐁 하트비트가
 * 없으면 서버는 이 "죽은 소켓"을 영영 모른다 — 표준 `ws` 라이브러리 관례
 * (README의 "소켓 생존 확인" 패턴)대로 주기적으로 ping을 쏘고, 직전 주기에
 * pong이 안 왔으면 그 소켓을 강제로 끊는다(close 핸들러가 presence 정리를
 * 그대로 맡는다 — 정상 종료와 같은 경로). */
const HEARTBEAT_INTERVAL_MS = 30_000;

type Frame = string;
type PresenceUser = PresenceUserInfo & { userId: string };

const connected = new Set<ClientSocket>();
const socketUserIds = new Map<ClientSocket, string>();
const socketAlive = new Map<ClientSocket, boolean>();
/** 🔒 사용자 지시(2026-10, "접속된 사용자 리스트도... 온라인상태도") — 같은
 * 사람이 탭 여러 개/기기 여러 개로 열어도 접속자 목록엔 한 번만 뜨게
 * userId로 묶는다(socketCount는 마지막 탭이 닫힐 때만 그 사람을 뺀다).
 * 이전엔 count가 connected.size(소켓 수)였는데, 그러면 같은 사람이 탭 2개를
 * 열었을 때 "2명 접속"으로 틀리게 보였다 — 이제 onlineUsers.size(실제 인원). */
const onlineUsers = new Map<string, { info: PresenceUser; socketCount: number }>();

function safeJsonEnvelope(envelope: Record<string, unknown>): Frame {
  return JSON.stringify(envelope);
}

function broadcast(envelope: Record<string, unknown>, except?: ClientSocket): void {
  const frame = safeJsonEnvelope(envelope);
  for (const ws of connected) {
    if (ws === except) continue;
    if (ws.readyState === ws.OPEN) ws.send(frame);
  }
}

function broadcastPresence(action: 'joined' | 'left'): void {
  broadcast({ type: 'presence', action, count: onlineUsers.size, users: [...onlineUsers.values()].map((v) => v.info) });
}

/** 발언 삽입 → 브로드캐스트. 도메인 실패는 {type:'error'}로 응답한다. */
async function handleMessage(ws: ClientSocket, raw: string): Promise<void> {
  const userId = socketUserIds.get(ws);
  if (!userId) return; // 재검증이 이미 끝났을 경우(정리 경쟁)

  let parsed: { type?: string; body?: unknown; replyToId?: unknown };
  try {
    parsed = JSON.parse(raw) as { type?: string; body?: unknown; replyToId?: unknown };
  } catch {
    ws.send(safeJsonEnvelope({ type: 'error', code: 'INVALID_FRAME' }));
    return;
  }
  if (parsed.type !== 'message' || typeof parsed.body !== 'string') {
    ws.send(safeJsonEnvelope({ type: 'error', code: 'INVALID_FRAME' }));
    return;
  }
  const body = parsed.body.trim();
  if (body.length === 0 || chatBodyTooLong(body)) {
    ws.send(safeJsonEnvelope({ type: 'error', code: 'INVALID_BODY', max: MAX_CHAT_BODY_LENGTH }));
    return;
  }
  // 🔒 0056 — 형식만 여기서 거른다(UUID 아니면 애초에 insertMessage까지
  // 안 보낸다). 존재·숨김 여부 확인은 lounge.ts(DB를 아는 계층)의 책임.
  const replyToId = isUuid(parsed.replyToId) ? parsed.replyToId : null;
  if (!(await checkRateLimit(`lounge:${userId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_SECONDS))) {
    ws.send(safeJsonEnvelope({ type: 'error', code: 'RATE_LIMITED', max: CHAT_RATE_LIMIT, windowSeconds: CHAT_RATE_WINDOW_SECONDS }));
    return;
  }

  let message: ChatMessage;
  try {
    message = await insertMessage(userId, body, replyToId);
  } catch (err) {
    // DB 이상(장애/제약 위반)은 사용자 프레임으로 응답해 소켓이 조용히 멈추지 않게 한다.
    console.error('[lounge] 발언 INSERT 실패:', err);
    ws.send(safeJsonEnvelope({ type: 'error', code: 'INVALID_MESSAGE' }));
    return;
  }
  broadcast({ type: 'message', message });
}

export function createLoungeWsServer() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws: ClientSocket, req: IncomingMessage) => {
    const token = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
    const userId = await getSessionUserId(token);
    if (!userId) {
      ws.close(4001, 'authentication required');
      return;
    }

    connected.add(ws);
    socketUserIds.set(ws, userId);
    socketAlive.set(ws, true);
    ws.on('pong', () => socketAlive.set(ws, true));

    const existing = onlineUsers.get(userId);
    if (existing) {
      existing.socketCount += 1;
    } else {
      const info = await fetchPresenceInfo(userId);
      // 🔒 세션은 유효한데 계정이 DB에서 지워진 비정상 상태(다른 라우트의
      // "계정 삭제 후 세션만 남음" 전례와 같은 상황) — 목록에 못 넣어도
      // 접속 자체(히스토리 수신·발언)는 막지 않는다, 표시만 못 할 뿐이다.
      if (info) onlineUsers.set(userId, { info: { userId, ...info }, socketCount: 1 });
    }
    broadcastPresence('joined');

    // 최근 기록(접속 시점의 스냅샷 50건) — 접속 직후에 보낸다.
    try {
      const history = await recentMessages();
      if (ws.readyState === ws.OPEN) ws.send(safeJsonEnvelope({ type: 'history', messages: history }));
    } catch (err) {
      console.error('[lounge] 히스토리 조회 실패:', err);
    }

    const recheck = setInterval(async () => {
      const stillValid = await getSessionUserId(token);
      if (!stillValid) ws.close(4001, 'session revoked');
    }, SESSION_RECHECK_MS);

    ws.on('message', (data) => {
      if (ws.readyState !== ws.OPEN) return;
      void handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      clearInterval(recheck);
      connected.delete(ws);
      socketUserIds.delete(ws);
      socketAlive.delete(ws);
      const entry = onlineUsers.get(userId);
      if (entry) {
        entry.socketCount -= 1;
        if (entry.socketCount <= 0) onlineUsers.delete(userId);
      }
      broadcastPresence('left');
    });

    ws.on('error', () => {
      // ping/pong이 끊긴 소켓은 close에 정리된다 — error는 여기서 조용히 묵인한다
    });
  });

  // 🔒 위 HEARTBEAT_INTERVAL_MS 주석 — 매 주기마다 "직전 주기에 pong을
  // 못 받은" 소켓을 끊는다. 순서가 중요하다: 이번 틱에서 먼저 죽은 소켓을
  // 걸러낸 다음, 살아남은 소켓엔 alive를 false로 내려놓고 ping을 쏜다 —
  // 다음 틱까지 pong이 오면 위 'pong' 리스너가 다시 true로 되돌린다.
  // 연결당 타이머를 따로 두지 않고 wss 하나당 인터벌 하나만 쓴다.
  const heartbeat = setInterval(() => {
    for (const ws of connected) {
      if (socketAlive.get(ws) === false) {
        ws.terminate(); // 'close' 핸들러가 presence 정리를 맡는다
        continue;
      }
      socketAlive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  return wss;
}
