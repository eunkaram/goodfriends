/**
 * 얇은 푸시 — 실시간 팬아웃 (PRD §9.1.1, T23, T12 해소)
 *
 * 🔒 페이로드는 {threadId, messageId, at} 뿐이다. 본문·발신자명·이미지를
 * 절대 싣지 않는다. 권한 판정은 클라이언트가 신호를 받은 뒤 별도의 인증된
 * 조회(§4.5 RLS를 통과하는 그 경로 — tests/guards/messaging.test.ts가 이미
 * 검증했다)로만 이뤄진다. 푸시 경로 자체는 권한을 판단하지 않는다 — 그래서
 * 낡은 구독이 안전하고(차단 직후에도 조회가 막힘), 팬아웃 경로가 RLS 밖에
 * 있어도 §4.5의 "코드가 까먹어도 DB가 막는다"가 깨지지 않는다.
 *
 * Redis pub/sub로 팬아웃한다(§17.1 "Redis — WS 팬아웃") — 지금은 단일
 * 프로세스지만, 앱 인스턴스가 늘어나도 이 경로는 그대로 확장된다.
 *
 * userId는 §6.1 로그인 세션 쿠키에서 유도한다 — 이전엔 `?userId=` 쿼리
 * 파라미터를 그대로 믿는 자리표시자였다(검증되지 않은 사용자 식별자를
 * 받아들이는 것과 같았다). 세션이 없거나 만료됐으면 연결을 거부한다.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { redis } from './redis.ts';
import { appPool } from './db.ts';
import { getSessionUserId, parseCookieHeader, SESSION_COOKIE } from './session.ts';

type ThinSignal = { threadId: string; messageId: string; at: string };

const channelSubscribers = new Map<string, Set<WebSocket>>();
// 🔒 소켓별로 지금 구독 중인 채널을 추적한다 — close 시 정리뿐 아니라, 연결된
// 이후에 새로 생긴 스레드를 그 소켓에 동적으로 추가 구독시키는 데도 쓴다
// (subscribeSocketsToThread 참고. 이전엔 connection 핸들러 클로저 안의
// 지역 배열이라 바깥에서 손댈 수 없었다 — 그래서 연결 중 생긴 새 스레드는
// 재연결 전까지 실시간 신호를 못 받았다).
const socketChannels = new Map<WebSocket, Set<string>>();
// userId별 현재 열려 있는 소켓들 — subscribeSocketsToThread가 "이 사용자가
// 지금 연결돼 있다면 그 소켓들에 새 채널을 구독시킨다"를 하기 위해 필요하다.
const userSockets = new Map<string, Set<WebSocket>>();
const subscriber = redis().duplicate();

// 🔒 성능 점검 발견(2026-08-22) — threadIdsFor()가 WS 연결마다 ownerPool()을
// 새로 불러 매번 새 pg.Pool을 만들고 절대 안 닫았다(불변식 20과 같은
// 문제). ownerPool(슈퍼유저)일 이유도 없었다 — participants는 RLS 자체가
// 없는 테이블이라(아래 주석) 어느 역할로 붙어도 결과가 같다. 다른
// src/*.ts 파일들과 같은 모듈 스코프 패턴 + 최소권한 원칙에 맞춰
// appPool('exists')로 바꿨다.
const pool = appPool('exists');

subscriber.on('message', (channel: string, raw: string) => {
  const sockets = channelSubscribers.get(channel);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
});

function channelFor(threadId: string) {
  return `thread:${threadId}`;
}

/** 새 메시지가 저장된 직후 호출한다. 본문을 넘기지 않는다 — 그게 이 전체 설계의 요점이다. */
export async function publishNewMessage(threadId: string, messageId: string) {
  const signal: ThinSignal = { threadId, messageId, at: new Date().toISOString() };
  await redis().publish(channelFor(threadId), JSON.stringify(signal));
}

/** 소켓 하나를 특정 스레드 채널에 구독시킨다 — 연결 시점과, 연결 이후 새로 생긴
 * 스레드를 동적으로 추가할 때(subscribeSocketsToThread) 양쪽에서 재사용한다. */
async function addSubscription(ws: WebSocket, threadId: string): Promise<void> {
  if (ws.readyState !== ws.OPEN) return; // 구독 처리 중 소켓이 끊겼을 수 있다
  const channel = channelFor(threadId);
  if (!channelSubscribers.has(channel)) {
    channelSubscribers.set(channel, new Set());
    await subscriber.subscribe(channel);
  }
  channelSubscribers.get(channel)!.add(ws);
  socketChannels.get(ws)?.add(channel);
}

/**
 * 🔒 실전 발견 — 새 스레드가 생겨도 이미 연결된 소켓은 connection 시점에
 * 스냅샷한 채널만 구독하고 있어서 재연결 전까지 그 스레드의 실시간 신호를
 * 못 받았다(예: 낯선 사람의 첫 메시지 요청). findOrCreateDirectThread()가
 * 새 스레드를 만든 직후 이 함수를 호출해, 두 참여자가 지금 연결돼 있다면
 * 그 소켓들에 새 채널을 즉시 추가 구독시킨다.
 */
export async function subscribeSocketsToThread(threadId: string, userIds: string[]): Promise<void> {
  await Promise.all(
    userIds.flatMap((userId) => [...(userSockets.get(userId) ?? [])].map((ws) => addSubscription(ws, threadId))),
  );
}

async function threadIdsFor(userId: string): Promise<string[]> {
  // participants는 RLS가 없다(§9.2-bis-3 결함5 — 자기 재귀 방지). 여기서
  // userId로 직접 스코프하는 것이 바로 그 "앱 레이어가 스스로 제한해야
  // 한다"는 책임이다.
  const r = await pool.query<{ thread_id: string }>(
    `SELECT thread_id FROM participants WHERE user_id = $1`,
    [userId],
  );
  return r.rows.map((row) => row.thread_id);
}

/**
 * 🔒 noServer 모드로 만든다. `{server, path}` 자동 연결 모드는 경로가 안
 * 맞는 업그레이드 요청(예: Next.js HMR의 `/_next/webpack-hmr`)을 조용히
 * 지나치는 게 아니라 **400으로 응답하고 소켓을 끊어버린다**(ws 라이브러리
 * shouldHandle → abortHandshake). 그 결과 Next dev 클라이언트의 HMR
 * 웹소켓이 매번 400을 맞았고, 그로 인해 하이드레이션 자체가 멈춰
 * 폼 제출이 전부 네이티브 GET으로 새는 버그로 이어졌다(실측 발견).
 * server.ts가 경로를 보고 `/ws`만 이 wss로, 나머지는 Next 업그레이드
 * 핸들러로 명시적으로 분기한다.
 */
// 🔒 /review 발견(red-team) — 연결 시점에만 세션을 확인하고 이후 한 번도
// 재확인하지 않았다. destroyAllSessionsForUser()(비밀번호 재설정·탈퇴 시
// 호출, 세션 쿠키 탈취 대응으로 이번 라운드에 추가한 바로 그 방어)가
// Redis 세션 키는 지워도 이미 열려 있는 WS 소켓은 전혀 모른다 — 로그아웃·
// 비밀번호 재설정·탈퇴 이후에도 훔친 쿠키로 연 탭이 계속 푸시 신호를 받는다.
// 완전한 해법(Redis kill-signal로 즉시 강제 종료)은 새 인프라가 필요해
// 범위가 크다 — 대신 주기적 재검증으로 노출 창을 유한하게 줄인다.
const SESSION_RECHECK_MS = 60_000;

export function createWsServer() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws, req) => {
    const token = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
    const userId = await getSessionUserId(token);
    if (!userId) {
      ws.close(4001, 'authentication required');
      return;
    }

    socketChannels.set(ws, new Set());
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(ws);

    const threadIds = await threadIdsFor(userId);
    for (const threadId of threadIds) {
      await addSubscription(ws, threadId);
    }

    const recheck = setInterval(async () => {
      const stillValid = await getSessionUserId(token);
      if (!stillValid) ws.close(4001, 'session revoked');
    }, SESSION_RECHECK_MS);

    ws.on('close', () => {
      clearInterval(recheck);
      // 🔒 성능 점검 발견(2026-08-22) — Set에서 소켓을 빼기만 하고 빈 Set이 된
      // Map 항목 자체와 Redis 구독은 절대 안 지웠다 — 서버가 오래 돌수록
      // channelSubscribers가 무한정 자라고 공유 Redis subscriber 커넥션도
      // 한 번 구독한 채널을 영원히 물고 있었다. 마지막 구독자가 나가면
      // Map 항목과 Redis 구독 둘 다 정리한다.
      for (const channel of socketChannels.get(ws) ?? []) {
        const sockets = channelSubscribers.get(channel);
        if (!sockets) continue;
        sockets.delete(ws);
        if (sockets.size === 0) {
          channelSubscribers.delete(channel);
          subscriber.unsubscribe(channel).catch(() => {});
        }
      }
      socketChannels.delete(ws);
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) userSockets.delete(userId);
      }
    });
  });

  return wss;
}

/**
 * `/ws`가 아닌 업그레이드 요청(Next dev HMR의 `/_next/webpack-hmr` 등)을
 * 처리할 콜백을 선택적으로 받는다 — server.ts는 `app.getUpgradeHandler()`를
 * 넘긴다. 안 넘기면(테스트용 createHttpServer()) 그냥 지나친다(400으로
 * 걷어차지 않는다).
 */
export function attachWsServer(httpServer: Server, onOtherPath?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) {
  const wss = createWsServer();

  // 🔒 이 정리를 upgradeListener 밖에서 재사용 — 'request'와 'upgrade' 두
  // 이벤트 모두에서 부른다(아래 주석).
  function stripForeignUpgradeListeners() {
    for (const fn of httpServer.listeners('upgrade')) {
      if (fn !== upgradeListener) httpServer.removeListener('upgrade', fn as (...args: unknown[]) => void);
    }
  }

  function upgradeListener(req: IncomingMessage, socket: Duplex, head: Buffer) {
    // 🔒 실전 발견(2026-08-26, "탭이 컨텐츠 없을때 이동이 안됨" 조사 중,
    // 회원가입 폼이 네이티브 GET으로 새는 걸로 재현) — 아래 'request' 기반
    // 정리만으로는, Next가 자기 HMR 리스너를 마지막 'request' 이후·이번
    // upgrade 시도 사이의 좁은 틈에 다시 붙이는 경우를 못 잡는 레이스가
    // 남아 있었다. 업그레이드 시도 직전에도 한 번 더 정리해 그 틈을 좁힌다
    // (완전히 닫히진 않는다 — Node의 EventEmitter가 emit 시작 시점의
    // 리스너 스냅샷으로 도는 버전에서는 "바로 이번" 이벤트에 이미 붙어있던
    // 리스너까지 막지는 못한다. 그래도 다음 시도부터는 반드시 막힌다).
    stripForeignUpgradeListeners();
    const { pathname } = new URL(req.url ?? '/', 'http://internal');
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      onOtherPath?.(req, socket, head);
    }
  }
  httpServer.on('upgrade', upgradeListener);

  // 🔒 실전 발견(2026-08-24, "메세지에서 실시간 채팅이 안돼" 실브라우저 검증
  // 중) — Next dev 모드가 이 http.Server에 자기 HMR용 ws 서버를 `{server,
  // path}` 자동 연결 모드로 몰래 붙인다(app.prepare() 시점엔 아직 없고,
  // 첫 페이지 요청을 처리하며 지연 등록됨). 그 내부 서버도 위 주석의 같은
  // `ws` 라이브러리 결함을 갖고 있어서 — path가 안 맞는 업그레이드
  // 요청(우리 `/ws`)을 조용히 지나치지 않고 abortHandshake(400 + 소켓
  // 종료)로 처리한다. 'upgrade' 이벤트엔 리스너 여러 개가 전부 불려서,
  // 우리가 이미 완료한 WS 핸드셰이크를 이 리스너가 뒤늦게 끊어버렸다
  // (실측: 연결 직후 code 1006 — 기존 스레드에 온 메시지조차 실시간으로
  // 안 보임). Next 내부 구현이 리스너를 "언제" 붙이는지는 버전마다 달라질
  // 수 있어 그 시점에 맞춰 막을 수 없다 — 대신 매 HTTP 요청마다(실제
  // 브라우저라면 WS를 열기 전에 페이지·에셋 요청이 먼저 여러 번 온다)
  // "우리가 등록한 리스너가 아니면 지운다"는 불변식으로 방어한다.
  httpServer.on('request', stripForeignUpgradeListeners);

  return wss;
}
