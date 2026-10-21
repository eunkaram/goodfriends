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
import { recentMessages, insertMessage, chatBodyTooLong, MAX_CHAT_BODY_LENGTH, type ChatMessage } from './lounge.ts';
import { checkRateLimit } from './rate-limit.ts';

const SESSION_RECHECK_MS = 60_000;
const CHAT_RATE_LIMIT = 10;
const CHAT_RATE_WINDOW_SECONDS = 60;

type Frame = string;

const connected = new Set<ClientSocket>();
const socketUserIds = new Map<ClientSocket, string>();

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

/** 발언 삽입 → 브로드캐스트. 도메인 실패는 {type:'error'}로 응답한다. */
async function handleMessage(ws: ClientSocket, raw: string): Promise<void> {
  const userId = socketUserIds.get(ws);
  if (!userId) return; // 재검증이 이미 끝났을 경우(정리 경쟁)

  let parsed: { type?: string; body?: unknown };
  try {
    parsed = JSON.parse(raw) as { type?: string; body?: unknown };
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
  if (!(await checkRateLimit(`lounge:${userId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_SECONDS))) {
    ws.send(safeJsonEnvelope({ type: 'error', code: 'RATE_LIMITED', max: CHAT_RATE_LIMIT, windowSeconds: CHAT_RATE_WINDOW_SECONDS }));
    return;
  }

  let message: ChatMessage;
  try {
    message = await insertMessage(userId, body);
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
    broadcast({ type: 'presence', action: 'joined', count: connected.size });

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
      broadcast({ type: 'presence', action: 'left', count: connected.size });
    });

    ws.on('error', () => {
      // ping/pong이 끊긴 소켓은 close에 정리된다 — error는 여기서 조용히 묵인한다
    });
  });

  return wss;
}
