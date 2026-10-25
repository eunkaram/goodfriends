/**
 * 라운지 채팅 배선 테스트 — M4("두 브라우저에서 실시간 채팅 확인"의 테스트
 * 대역). 실 ws 서버(attachWsServer → /ws/lounge)에 ws 클라이언트로 붙어 핸드셰이크
 * 세션 인증 / 최근 기록 히스토리 / 전체방 브로드캐스트 / rate limit / 비인증
 * 거부(4001)를 검증한다.
 *
 * 🔒 프레임 순서 안전성 — 소켓별로 수신은 버퍼(connected 있으면 계속)하고
 * "type이 확인될 때까지 다음 프레임 소비"로 검증한다. presence·history가
 * 순서가 뒤섞여도 테스트가 이를 알아서 통해야(실전 소식) 안전하다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type pg from 'pg';
import WebSocket from 'ws';
import { attachWsServer } from '../../src/ws-server.ts';
import { handleLoungeRoutes } from '../../src/lounge-http.ts';
import { ownerPool } from '../../src/db.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let wsUrl: string;
let baseUrl: string;
let owner: pg.Pool;
let aliceToken: string;
let bobToken: string;
let aliceId: string;

type Frame = Record<string, unknown>;

function openSocket(token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = token ? new WebSocket(wsUrl, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }) : new WebSocket(wsUrl);
    socket.on('open', () => resolve(socket));
    socket.on('error', (err) => reject(err));
    socket.on('unexpected-response', (_req, res) => {
      reject(new Error(`connection refused HTTP ${res.statusCode}`));
    });
  });
}

/** type이 맞는 프레임을 그때까지 소비한다 — 이벤트 리스너가 항상 달려 있어야
 *  중간 frame을 누락하지 않는다(위와 같은 레이스의 근본 해결). */
function waitForType(socket: WebSocket, type: string, timeoutMs = 5000): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const seen: Frame[] = [];
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`frame 소진 — ${type} 기다리던 중 받은 기록: ${JSON.stringify(seen).slice(0, 300)}`));
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      const frame = JSON.parse(String(data)) as Frame;
      if (frame.type === type) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(frame);
      } else {
        seen.push(frame);
      }
    };
    socket.on('message', onMessage);
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (await handleLoungeRoutes(req, res)) return;
      res.writeHead(404).end();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  attachWsServer(server); // '/ws/lounge' 외 모든 업그레이드는 onOtherPath 미지정 → 지나친다(레이스 방어 재활용)
  const { port } = server.address() as { port: number };
  wsUrl = `ws://127.0.0.1:${port}/ws/lounge`;
  baseUrl = `http://127.0.0.1:${port}`;
  owner = ownerPool();

  await owner.query(`DELETE FROM chat_messages WHERE body LIKE 'LOUNGE-TEST::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'logetest_%'`);

  const alice = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('logetest_alice') RETURNING id`);
  const bob = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('logetest_bob') RETURNING id`);
  aliceId = alice.rows[0].id;
  aliceToken = (await createSession(aliceId)).token;
  bobToken = (await createSession(bob.rows[0].id)).token;
});

afterAll(async () => {
  await destroySession(aliceToken);
  await destroySession(bobToken);
  await owner?.query(`DELETE FROM chat_messages WHERE body LIKE 'LOUNGE-TEST::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'logetest_%'`);
  await owner?.end();
  server.close();
});

describe('핸드셰이크', () => {
  it('비인증 연결 → 4001로 끊는다', async () => {
    const socket = await openSocket(undefined);
    const closeCode = await new Promise<number>((resolve) => {
      socket.on('close', (code) => resolve(code));
    });
    expect(closeCode).toBe(4001);
  });

  it('세션 쿠키로 연결 → 최근 기록(비어도 프레임)이 온다', async () => {
    const socket = await openSocket(aliceToken);
    const frame = await waitForType(socket, 'history');
    expect(Array.isArray(frame.messages)).toBe(true);
    socket.close();
  });
});

describe('발언 → 전체방 브로드캐스트', () => {
  it('A가 보내면 B에도 실시간 도착, 자기도 도착, REST로 히스토리 가능', async () => {
    const a = await openSocket(aliceToken);
    const b = await openSocket(bobToken);
    await waitForType(a, 'history');
    await waitForType(b, 'history');

    // 🔒 프레임은 리플레이가 없다 — broadcast는 모든 소켓에 '동시에' 도착하므로
    // send 전에 양쪽 웨이터를 먼저 붙여야 한다(await 순서로 붙이면 먼저
    // 기다린 쪽이 해소되는 동안 다른 쪽 프레임이 유실돼 테스트가 멈춘다).
    const pA = waitForType(a, 'message');
    const pB = waitForType(b, 'message');

    const body = 'LOUNGE-TEST::A가 먼저 말한다';
    a.send(JSON.stringify({ type: 'message', body }));

    const messageA = ((await pA).message ?? {}) as { id: string; body: string };
    const messageB = ((await pB).message ?? {}) as { id: string; body: string };
    expect(messageA.id).toBeTruthy();
    expect(messageA.body).toBe(body);
    expect(messageB.id).toBe(messageA.id); // 같은 방 이벤트 = 같은 id가 브로드캐스트

    // REST hydration도 가능해야 한다(alice 쿠키)
    const res = await fetch(`${baseUrl}/api/lounge/messages`, {
      headers: { Cookie: `${SESSION_COOKIE}=${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { messages: Array<{ body: string }> };
    expect(data.messages.some((m) => m.body === body)).toBe(true);

    // REST 비인증 → 401
    const anon = await fetch(`${baseUrl}/api/lounge/messages`);
    expect(anon.status).toBe(401);

    a.close();
    b.close();
  });
});

// 🔒 사용자 지시(2026-10, "댓글 달기하면 내 글에 원글이 일부 포함되어야
// 하고 원글을 클릭하면 원글위치로 옮겨져서") — 0056 reply_to_id.
describe('답장(reply)', () => {
  it('replyToId 없이 보내면 replyTo는 null', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');
    const p = waitForType(a, 'message');
    a.send(JSON.stringify({ type: 'message', body: 'LOUNGE-TEST::reply-none' }));
    const frame = (await p).message as { replyTo: unknown };
    expect(frame.replyTo).toBeNull();
    a.close();
  });

  // 🔒 처음엔 소켓 2개(발신자+관전자)로 "다른 사람도 같은 요약을 받는다"까지
  // 같이 검증했는데, 한 테스트 안에서 같은 소켓에 waitForType을 여러 번
  // 겹쳐 거는 조합이 가끔(약 25% 관측) 타임아웃으로 흔들렸다 — "둘 다 받는다"
  // 자체는 위 "발언 → 전체방 브로드캐스트" 테스트가 이미 증명했으므로
  // (reply_to_id 유무와 무관하게 브로드캐스트 메커니즘은 동일), 여기서는
  // 소켓 하나로 단순화해 reply_to_id 조회·요약 로직만 집중해서 본다.
  it('유효한 replyToId로 보내면 원글 요약(작성자·일부 본문)이 같이 온다', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');

    const pOriginal = waitForType(a, 'message');
    const original = 'LOUNGE-TEST::reply-original';
    a.send(JSON.stringify({ type: 'message', body: original }));
    const originalId = ((await pOriginal).message as { id: string }).id;

    const pReply = waitForType(a, 'message');
    a.send(JSON.stringify({ type: 'message', body: 'LOUNGE-TEST::reply-child', replyToId: originalId }));
    const replyFrame = ((await pReply).message ?? {}) as {
      replyTo: { id: string; authorUsername: string; authorNickname: string | null; bodyExcerpt: string } | null;
    };
    expect(replyFrame.replyTo).toEqual({ id: originalId, authorUsername: 'logetest_alice', authorNickname: null, bodyExcerpt: original });

    a.close();
  });

  it('존재하지 않는 replyToId는 에러 없이 조용히 무시된다(replyTo: null)', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');
    const p = waitForType(a, 'message');
    a.send(JSON.stringify({ type: 'message', body: 'LOUNGE-TEST::reply-dangling', replyToId: '00000000-0000-0000-0000-000000000000' }));
    const frame = (await p).message as { replyTo: unknown };
    expect(frame.replyTo).toBeNull();
    a.close();
  });
});

describe('방어 선', () => {
  it('길이 1,000자+ → INVALID_BODY', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');
    a.send(JSON.stringify({ type: 'message', body: `LOUNGE-TEST::대단히 길다 ${'왕왕'.repeat(600)}` }));
    const frame = await waitForType(a, 'error');
    expect(frame.code).toBe('INVALID_BODY');
    a.close();
  });

  it('malformed JSON → INVALID_FRAME', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');
    a.send('나는 프로토콜 침입자 {');
    const frame = await waitForType(a, 'error');
    expect(frame.code).toBe('INVALID_FRAME');
    a.close();
  });

  it('rate limit — 분당 10을 초과하면 RATE_LIMITED', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');
    // 이전 it(alice 발언 1건) 이후 같은 60초 창 — 카운터는 유저 기준으로 이어진다.
    for (let i = 0; i < 12; i++) {
      a.send(JSON.stringify({ type: 'message', body: `LOUNGE-TEST::bulk-${i}` }));
    }
    const errorFrame = await waitForType(a, 'error');
    expect(errorFrame.code).toBe('RATE_LIMITED');
    a.close();
  });
});

// 🔒 사용자 지시(2026-10, "오른쪽 영역에 접속된 사용자 리스트도... 온라인상태도") —
// lounge-ws.ts의 onlineUsers Map(userId 기준 dedup)을 검증한다.
describe('접속자 목록(presence)', () => {
  it('다른 사람이 접속하면 기존 접속자가 받는 presence에 둘 다 뜬다', async () => {
    const a = await openSocket(aliceToken);
    await waitForType(a, 'history');
    const presenceOnBobJoin = waitForType(a, 'presence');
    const b = await openSocket(bobToken);
    const frame = await presenceOnBobJoin;
    const users = frame.users as Array<{ username: string }>;
    expect(frame.action).toBe('joined');
    expect(users.some((u) => u.username === 'logetest_alice')).toBe(true);
    expect(users.some((u) => u.username === 'logetest_bob')).toBe(true);
    a.close();
    b.close();
  });

  it('같은 유저가 탭을 두 개 열어도 접속자 목록엔 한 번만 뜬다', async () => {
    const a1 = await openSocket(aliceToken);
    await waitForType(a1, 'history');
    const presenceOnSecondTab = waitForType(a1, 'presence');
    const a2 = await openSocket(aliceToken);
    const frame = await presenceOnSecondTab;
    const users = frame.users as Array<{ username: string }>;
    expect(users.filter((u) => u.username === 'logetest_alice')).toHaveLength(1);
    a1.close();
    a2.close();
  });
});

