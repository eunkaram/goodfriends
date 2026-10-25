/**
 * MessageThread/Message — 참여자 전용 + 모더레이션 접근 경로
 *
 * P11 — 참여자가 아니면 아무것도 못 본다. 공개범위 개념이 없다(전체공개조차 없음).
 * P12 — 모더레이터는 "열린 신고가 걸린 메시지 건"만 본다. 스레드 전체 열람권은
 *       주지 않는다. 신고 없는 스레드는 모더레이터도 못 본다.
 * 🔒 감사 로그(ModerationAccessLog)는 DB가 강제하지 못한다 — SELECT 정책은
 *    부수효과를 낼 수 없다. 아래 마지막 테스트가 그 한계를 명시적으로 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;
let ivan: string;
let judy: string;   // ivan과 같은 스레드
let mallory: string; // 무관계
let modUser: string; // is_moderator = true
let threadId: string;
let reportedMessageId: string;
let unreportedMessageId: string;

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('exists');

  // 🔒 reafy_backend fork 원본 발견(tests/guards/messages.test.ts 신설 후) —
  // 여기 있던 `DELETE FROM message_threads`(WHERE 없음)와 `participants ...
  // LIKE '%'`(뭐든 매치하는 패턴)가 이 테이블들을 이 파일이 유일하게 쓴다고
  // 가정하고 전체를 밀어버리고 있었다 — message_threads를 쓰는 두 번째 테스트
  // 파일이 생기자마자 병렬 실행 중 서로의 픽스처를 지우는 flaky 실패로
  // 드러났다. 이 파일이 이전 실행에서 남긴 것만(msg_* 사용자가 참여자인
  // 스레드만) 정확히 스코프해서 지운다 — CASCADE가 participants/messages/
  // message_requests까지 알아서 정리한다.
  await owner.query(`DELETE FROM reports WHERE reason LIKE 'MSG_TEST::%'`);
  await owner.query(
    `DELETE FROM message_threads WHERE id IN (
       SELECT DISTINCT p.thread_id FROM participants p
       JOIN users u ON u.id = p.user_id
       WHERE u.username LIKE 'msg\\_%' ESCAPE '\\'
     )`,
  );
  await owner.query(`DELETE FROM users WHERE username LIKE 'msg\\_%' ESCAPE '\\'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('msg_ivan'), ('msg_judy'), ('msg_mallory'), ('msg_mod')
     RETURNING id, username`,
  );
  ivan = u.rows.find((r) => r.username === 'msg_ivan')!.id;
  judy = u.rows.find((r) => r.username === 'msg_judy')!.id;
  mallory = u.rows.find((r) => r.username === 'msg_mallory')!.id;
  modUser = u.rows.find((r) => r.username === 'msg_mod')!.id;
  await owner.query(`UPDATE users SET is_moderator = true WHERE id = $1`, [modUser]);

  const t = await owner.query<{ id: string }>(`INSERT INTO message_threads DEFAULT VALUES RETURNING id`);
  threadId = t.rows[0].id;
  await owner.query(
    `INSERT INTO participants (thread_id, user_id) VALUES ($1, $2), ($1, $3)`,
    [threadId, ivan, judy],
  );

  const m1 = await owner.query<{ id: string }>(
    `INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, 'MSG_TEST::reported') RETURNING id`,
    [threadId, ivan],
  );
  reportedMessageId = m1.rows[0].id;
  const m2 = await owner.query<{ id: string }>(
    `INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, 'MSG_TEST::clean') RETURNING id`,
    [threadId, judy],
  );
  unreportedMessageId = m2.rows[0].id;

  await owner.query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, status)
     VALUES ($1, 'message', $2, 'MSG_TEST::abuse', 'open')`,
    [judy, reportedMessageId],
  );
});

afterAll(async () => {
  await owner?.query(`DELETE FROM reports WHERE reason LIKE 'MSG_TEST::%'`);
  await owner?.query(`DELETE FROM messages WHERE body LIKE 'MSG_TEST::%'`);
  await owner?.query(`DELETE FROM message_threads WHERE id = $1`, [threadId]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'msg\\_%' ESCAPE '\\'`);
  await app?.end();
  await owner?.end();
});

async function visibleMessageBodies(userId: string) {
  return withRelationCtx(app, { userId }, async (c) => {
    const r = await c.query<{ body: string }>(`SELECT body FROM messages WHERE body LIKE 'MSG_TEST::%'`);
    return r.rows.map((x) => x.body);
  });
}

describe('P11 — 메시지는 참여자 전용', () => {
  it('참여자(ivan, judy)는 스레드의 메시지를 전부 본다', async () => {
    expect(await visibleMessageBodies(ivan)).toEqual(
      expect.arrayContaining(['MSG_TEST::reported', 'MSG_TEST::clean']),
    );
  });

  it('🔒 무관계(mallory)는 참여자가 아니면 아무것도 못 본다', async () => {
    expect(await visibleMessageBodies(mallory)).toHaveLength(0);
  });

  it('🔒 비로그인은 아무것도 못 본다', async () => {
    const seen = await withRelationCtx(app, { userId: null }, async (c) => {
      const r = await c.query<{ body: string }>(`SELECT body FROM messages WHERE body LIKE 'MSG_TEST::%'`);
      return r.rows;
    });
    expect(seen).toHaveLength(0);
  });
});

describe('P12 — 모더레이터는 신고된 메시지 건만', () => {
  it('모더레이터는 신고된 메시지는 보되, 신고 안 된 메시지는 못 본다', async () => {
    const seen = await visibleMessageBodies(modUser);
    expect(seen).toContain('MSG_TEST::reported');
    expect(seen).not.toContain('MSG_TEST::clean');
  });

  it('🔒 신고가 resolved로 닫히면 모더레이터도 못 본다', async () => {
    await owner.query(`UPDATE reports SET status = 'resolved' WHERE reason = 'MSG_TEST::abuse'`);
    const seen = await visibleMessageBodies(modUser);
    expect(seen).not.toContain('MSG_TEST::reported');
    await owner.query(`UPDATE reports SET status = 'open' WHERE reason = 'MSG_TEST::abuse'`); // 다음 테스트를 위해 복원
  });

  it('일반 모더레이터가 아닌 사용자는 신고 여부와 무관하게 참여자가 아니면 못 본다', async () => {
    expect(await visibleMessageBodies(mallory)).not.toContain('MSG_TEST::reported');
  });

  it('🔒 알려진 한계 — 모더레이터가 열람해도 ModerationAccessLog는 자동으로 남지 않는다', async () => {
    // 이 테스트는 결함이 아니라 설계 한계를 문서화한다. SELECT 정책은 부수효과를
    // 낼 수 없으므로, 감사 로그 기록은 반드시 앱 레이어가 모더레이터 분기로
    // 행이 반환될 때마다 명시적으로 INSERT해야 한다. 여기서 로그가 비어있는 것이
    // "정상" — 이 테스트가 실패하지 않는 한, 향후 트리거·앱 코드가 이 책임을
    // 대신 지지 않았다는 뜻이다. 앱 구현 시 이 assertion을 뒤집는 것이 목표다.
    await visibleMessageBodies(modUser);
    const logged = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM moderation_access_log WHERE target_id = $1`,
      [reportedMessageId],
    );
    expect(Number(logged.rows[0].n)).toBe(0);
  });
});
