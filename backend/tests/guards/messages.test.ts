/**
 * 메시징 — 스키마·RLS는 0008_messaging.sql에 이미 있었고(reafy_backend fork
 * 원본과 동일), 이 테스트는 그 위에 얹은 앱 레이어(src/messages.ts)를
 * 검증한다. 특히 "미수락 1건 제한 + 답장하면 수락" 로직을 집중 검증한다 —
 * goodfriends 시안 카피("3통")와 실제 구현(1건)이 다르다는 걸 messages.ts
 * 헤더에 이미 기록해뒀다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { findOrCreateDirectThread, sendMessage, fetchThreads, fetchMessages, markThreadRead, hasUnreadMessages } from '../../src/messages.ts';

let owner: pg.Pool;
let alice: string;
let bob: string; // alice와 친구
let carol: string; // 무관계
let dave: string; // alice가 차단
let erin: string; // 동시성 테스트 전용 — 다른 픽스처와 얽히지 않은 신규 무관계 사용자
let frank: string; // 동시성 테스트 전용 — 위와 동일한 이유
let grace: string; // hasUnreadMessages 전용 — bob은 alice와의 스레드에 이미 안 읽은 메시지가 있어(alice만 markThreadRead함) 오염된 픽스처라 새로 판다
let henry: string; // 위와 동일한 이유

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM users WHERE username LIKE 'msgtest_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('msgtest_alice'), ('msgtest_bob'), ('msgtest_carol'), ('msgtest_dave'), ('msgtest_erin'), ('msgtest_frank'), ('msgtest_grace'), ('msgtest_henry') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'msgtest_alice')!.id;
  bob = u.rows.find((r) => r.username === 'msgtest_bob')!.id;
  carol = u.rows.find((r) => r.username === 'msgtest_carol')!.id;
  dave = u.rows.find((r) => r.username === 'msgtest_dave')!.id;
  erin = u.rows.find((r) => r.username === 'msgtest_erin')!.id;
  frank = u.rows.find((r) => r.username === 'msgtest_frank')!.id;
  grace = u.rows.find((r) => r.username === 'msgtest_grace')!.id;
  henry = u.rows.find((r) => r.username === 'msgtest_henry')!.id;

  await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`, [alice, bob]);
  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [alice, dave]);
});

afterAll(async () => {
  const all = [alice, bob, carol, dave, erin, frank, grace, henry];
  await owner?.query(`DELETE FROM messages WHERE sender_id = ANY($1::uuid[])`, [all]);
  await owner?.query(`DELETE FROM message_requests WHERE thread_id IN (SELECT thread_id FROM participants WHERE user_id = ANY($1::uuid[]))`, [
    all,
  ]);
  await owner?.query(`DELETE FROM participants WHERE user_id = ANY($1::uuid[])`, [all]);
  await owner?.query(`DELETE FROM message_threads WHERE id NOT IN (SELECT thread_id FROM participants)`);
  await owner?.query(`DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [alice, bob]);
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [alice, dave]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'msgtest_%'`);
  await owner?.end();
});

describe('findOrCreateDirectThread', () => {
  it('친구 사이엔 message_requests 없이(=즉시 스레드) 만든다', async () => {
    const result = await findOrCreateDirectThread(alice, bob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mr = await owner.query(`SELECT status FROM message_requests WHERE thread_id = $1`, [result.threadId]);
    expect(mr.rowCount).toBe(0);
  });

  it('있으면 재사용한다 — 같은 두 사람이 다시 호출해도 같은 thread_id', async () => {
    const first = await findOrCreateDirectThread(alice, bob);
    const second = await findOrCreateDirectThread(alice, bob);
    expect(first.ok && second.ok && first.threadId === second.threadId).toBe(true);
  });

  it('비친구 사이엔 pending message_requests와 함께 만든다', async () => {
    const result = await findOrCreateDirectThread(alice, carol);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mr = await owner.query<{ status: string; origin: string }>(`SELECT status, origin FROM message_requests WHERE thread_id = $1`, [
      result.threadId,
    ]);
    expect(mr.rows[0]?.status).toBe('pending');
    expect(mr.rows[0]?.origin).toBe('direct');
  });

  it('차단 관계면 스레드를 안 만든다', async () => {
    const result = await findOrCreateDirectThread(alice, dave);
    expect(result.ok).toBe(false);
  });

  it('본인과의 스레드는 거부한다', async () => {
    const result = await findOrCreateDirectThread(alice, alice);
    expect(result.ok).toBe(false);
  });

  it('🔒 실전 발견(불변식 11) — 기존 스레드가 있어도 차단 관계면 BLOCKED를 반환한다', async () => {
    const thread = await findOrCreateDirectThread(bob, carol);
    if (!thread.ok) throw new Error('setup failed');
    await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [bob, carol]);
    try {
      const result = await findOrCreateDirectThread(bob, carol);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('BLOCKED');
    } finally {
      await owner.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [bob, carol]);
    }
  });

  it('🔒 실전 발견 — 동시 호출에도 스레드가 하나만 생긴다(advisory lock)', async () => {
    const [r1, r2] = await Promise.all([findOrCreateDirectThread(bob, erin), findOrCreateDirectThread(erin, bob)]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.threadId).toBe(r2.threadId);

    const count = await owner.query<{ n: string }>(`SELECT count(*) AS n FROM participants WHERE user_id = $1`, [erin]);
    expect(Number(count.rows[0].n)).toBe(1); // 스레드가 중복 생성됐다면 erin이 두 스레드의 참여자였을 것
  });
});

describe('sendMessage — "미수락 1건 제한 + 답장하면 수락"', () => {
  it('친구 사이(요청 아님)는 제한 없이 여러 통 보낼 수 있다', async () => {
    const thread = await findOrCreateDirectThread(alice, bob);
    if (!thread.ok) throw new Error('setup failed');
    const first = await sendMessage(alice, thread.threadId, '안녕 밥!');
    const second = await sendMessage(alice, thread.threadId, '한 번 더!');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('비친구에게 보낸 첫 메시지는 성공하고, 상대가 답장하기 전 두 번째는 LIMIT_REACHED', async () => {
    const thread = await findOrCreateDirectThread(alice, carol);
    if (!thread.ok) throw new Error('setup failed');
    const first = await sendMessage(alice, thread.threadId, '처음 뵙겠습니다');
    expect(first.ok).toBe(true);
    const second = await sendMessage(alice, thread.threadId, '한 번 더 보내볼게요');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('LIMIT_REACHED');
  });

  it('상대가 답장하면 message_requests가 accepted로 바뀌고, 이후엔 양쪽 다 제한 없이 보낼 수 있다', async () => {
    const thread = await findOrCreateDirectThread(bob, carol); // bob·carol은 무관계
    if (!thread.ok) throw new Error('setup failed');
    await sendMessage(bob, thread.threadId, '첫 메시지');

    const beforeReply = await owner.query<{ status: string }>(`SELECT status FROM message_requests WHERE thread_id = $1`, [thread.threadId]);
    expect(beforeReply.rows[0]?.status).toBe('pending');

    const reply = await sendMessage(carol, thread.threadId, '답장!');
    expect(reply.ok).toBe(true);

    const afterReply = await owner.query<{ status: string }>(`SELECT status FROM message_requests WHERE thread_id = $1`, [thread.threadId]);
    expect(afterReply.rows[0]?.status).toBe('accepted');

    // 수락 후엔 원래 요청자(bob)도 더 이상 1건 제한에 안 걸린다.
    const bobAgain = await sendMessage(bob, thread.threadId, '수락됐으니 또 보낼게요');
    expect(bobAgain.ok).toBe(true);
  });

  it('빈 본문이나 참여자가 아닌 사용자는 거부한다', async () => {
    const thread = await findOrCreateDirectThread(alice, bob);
    if (!thread.ok) throw new Error('setup failed');
    const empty = await sendMessage(alice, thread.threadId, '   ');
    expect(empty.ok).toBe(false);
    const outsider = await sendMessage(dave, thread.threadId, '난 이 방 사람이 아닌데');
    expect(outsider.ok).toBe(false);
    if (!outsider.ok) expect(outsider.error).toBe('NOT_PARTICIPANT');
  });

  it('🔒 실전 발견(불변식 11) — 스레드 생성 이후 차단하면 그 즉시 발송이 막힌다', async () => {
    const thread = await findOrCreateDirectThread(bob, erin);
    if (!thread.ok) throw new Error('setup failed');
    const before = await sendMessage(bob, thread.threadId, '차단 전 메시지');
    expect(before.ok).toBe(true);

    await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [erin, bob]);
    try {
      const after = await sendMessage(bob, thread.threadId, '차단 후 메시지');
      expect(after.ok).toBe(false);
      if (!after.ok) expect(after.error).toBe('BLOCKED');
    } finally {
      await owner.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [erin, bob]);
    }
  });

  it('🔒 실전 발견 — 동시 미수락 발송에도 1건 제한이 지켜진다(FOR UPDATE)', async () => {
    const thread = await findOrCreateDirectThread(bob, frank);
    if (!thread.ok) throw new Error('setup failed');

    const [r1, r2] = await Promise.all([
      sendMessage(bob, thread.threadId, '동시 발송 1'),
      sendMessage(bob, thread.threadId, '동시 발송 2'),
    ]);
    const results = [r1, r2];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) expect(failed.error).toBe('LIMIT_REACHED');
  });
});

describe('fetchThreads — inbox/requests 분리', () => {
  it('요청함(pending)과 받은편지함(accepted·친구)을 정확히 나눈다', async () => {
    const { inbox, requests } = await fetchThreads(alice);
    const inboxIds = inbox.map((t) => t.otherUser.username);
    const requestIds = requests.map((t) => t.otherUser.username);
    expect(inboxIds).toContain('msgtest_bob'); // 친구 — inbox
    expect(requestIds).toContain('msgtest_carol'); // 비친구, 아직 답장 안 함 — requests
  });
});

describe('fetchMessages / markThreadRead', () => {
  it('시간순(오래된 것 먼저)으로 반환한다', async () => {
    const thread = await findOrCreateDirectThread(alice, bob);
    if (!thread.ok) throw new Error('setup failed');
    const messages = await fetchMessages(alice, thread.threadId, 100, 0);
    for (let i = 1; i < messages.length; i++) {
      expect(new Date(messages[i].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(messages[i - 1].createdAt).getTime());
    }
  });

  it('본인이 참여한 스레드가 아니면 빈 배열(RLS)', async () => {
    const thread = await findOrCreateDirectThread(alice, bob);
    if (!thread.ok) throw new Error('setup failed');
    const messages = await fetchMessages(dave, thread.threadId, 100, 0);
    expect(messages).toEqual([]);
  });

  it('읽음 처리는 에러 없이 끝난다', async () => {
    const thread = await findOrCreateDirectThread(alice, bob);
    if (!thread.ok) throw new Error('setup failed');
    await expect(markThreadRead(alice, thread.threadId)).resolves.not.toThrow();
  });
});

describe('hasUnreadMessages — 좌측 메뉴 안 읽음 표시', () => {
  // 🔒 grace/henry는 이 describe 전용 — bob 등 공용 픽스처는 다른 테스트에서
  // 이미 서로에게 안 읽은 메시지를 남겨둔 상태라(예: alice→bob은 bob이 한 번도
  // markThreadRead 안 함) 오염 없는 새 쌍이 필요하다.
  it('상대가 보낸 메시지가 있으면 true, 읽음 처리하면 false로 바뀐다', async () => {
    const thread = await findOrCreateDirectThread(grace, henry);
    if (!thread.ok) throw new Error('setup failed');
    const first = await sendMessage(henry, thread.threadId, '헨리의 첫 메시지');
    expect(first.ok).toBe(true);

    expect(await hasUnreadMessages(grace)).toBe(true);
    await markThreadRead(grace, thread.threadId);
    expect(await hasUnreadMessages(grace)).toBe(false);
  });

  it('내가 마지막으로 보낸 메시지뿐이면 안 읽음으로 치지 않는다', async () => {
    const thread = await findOrCreateDirectThread(grace, henry);
    if (!thread.ok) throw new Error('setup failed');
    await sendMessage(grace, thread.threadId, '내가 마지막으로 보낸 메시지');
    expect(await hasUnreadMessages(grace)).toBe(false);
  });

  it('fetchThreads가 스레드별 isUnread를 정확히 반환한다(메시지함 목록 배지용)', async () => {
    const thread = await findOrCreateDirectThread(grace, frank);
    if (!thread.ok) throw new Error('setup failed');
    const sent = await sendMessage(frank, thread.threadId, '프랭크가 그레이스에게');
    expect(sent.ok).toBe(true);

    const { requests } = await fetchThreads(grace);
    expect(requests.find((t) => t.id === thread.threadId)?.isUnread).toBe(true);

    await markThreadRead(grace, thread.threadId);
    const { requests: afterRead } = await fetchThreads(grace);
    expect(afterRead.find((t) => t.id === thread.threadId)?.isUnread).toBe(false);
  });
});

describe('🔒 실전 발견 — messages.sender_id ON DELETE CASCADE(0023)', () => {
  it('메시지를 보낸 계정도 탈퇴(hard delete)할 수 있다 — FK가 삭제를 막지 않는다', async () => {
    const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('msgtest_ephemeral') RETURNING id`);
    const ephemeralId = u.rows[0].id;
    const thread = await findOrCreateDirectThread(ephemeralId, carol);
    if (!thread.ok) throw new Error('setup failed');
    await sendMessage(ephemeralId, thread.threadId, '탈퇴 테스트용 메시지');

    // 하드 삭제. 0008이 처음 만들 때 sender_id에 ON DELETE CASCADE가 빠져
    // 있으면, 메시지를 하나라도 보낸 계정은 탈퇴가 FK 위반으로 조용히
    // 실패한다(reafy_backend에서 실브라우저 검증 중 실제로 겪은 결함).
    await expect(owner.query(`DELETE FROM users WHERE id = $1`, [ephemeralId])).resolves.not.toThrow();

    const remaining = await owner.query(`SELECT 1 FROM messages WHERE sender_id = $1`, [ephemeralId]);
    expect(remaining.rowCount).toBe(0);
  });
});
