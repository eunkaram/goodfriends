/**
 * 메시징 — reafy_backend(forked 전 원본) src/messages.ts를 그대로 이식했다.
 * `message_threads`/`participants`/`messages`/`message_requests` 스키마·RLS는
 * 이 fork의 0008_messaging.sql에도 동일하게 있었다(앱 레이어만 비어 있었다) —
 * `/saved`와 같은 패턴으로 그 위에 얹는다.
 *
 * 🔒 artifact 카피와 실제 구현이 다른 지점 — goodfriends 시안의 메시지 요청
 * 안내문("3개까지 보낼 수 있어요")은 이 구현과 다르다. 발송 제한은 스팸·악용
 * 방지를 위한 제품 스펙이라 순수 스타일이 아니다 — 이 파일은 1건 제한을
 * 따르고, 화면 카피도 실제 동작과 일치하게 "1건"으로 쓴다.
 *
 * 🔒 이번 라운드에서 뺀 것:
 * - 그룹 스레드 — 1:1만.
 * - 이미지 첨부 — `messages.image_media_id` 컬럼은 있지만 이번엔 텍스트만.
 * - `accept_from`(수신 설정: 전체/팔로워만/친구만/차단) — 기본값은 "전체"와
 *   같게 동작한다(요청함 자체가 이미 스팸 방지 역할을 한다).
 * - 마켓 기원 메시지(origin='market') — 이 fork엔 마켓 자체가 없다.
 * - 포스트/댓글 작성자에서 바로 메시지 보내기 — 진입점은 프로필 헤더 하나로 좁혔다.
 *
 * 🔒 "수락"의 정의 — "받은 사람이 답장하면 그 자체가 수락"으로 해석한다
 * (카카오톡 등 실제 메시징 앱의 통상적 동작과 일치, 별도 "수락" 버튼 없음) —
 * `sendMessage()`의 "상대가 처음 답장하면 status를 accepted로 전이" 분기 참고.
 */
import { randomUUID } from 'node:crypto';
import { appPool, withRelationCtx } from './db.ts';
import { publishNewMessage, subscribeSocketsToThread } from './ws-server.ts';

const pool = appPool('exists');

export type ThreadSummary = {
  id: string;
  otherUser: { id: string; username: string; nickname: string };
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
  isRequest: boolean;
  /** 좌측 메뉴 Messages 배지용. */
  isUnread: boolean;
};

export type MessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type FindOrCreateThreadResult = { ok: true; threadId: string } | { ok: false; error: 'BLOCKED' | 'SELF' };

/**
 * 스레드는 있으면 재사용, 없으면 생성한다("중복 금지").
 *
 * 전부 한 트랜잭션 안에서, 맨 앞에 advisory lock으로 같은 쌍의 동시 호출을
 * 직렬화한 뒤 순서대로 처리한다 — (1) 스레드가 생긴 이후 차단해도 차단 여부를
 * 매번 재확인하고, (2) 두 사람이 동시에 처음 대화를 시작해도 스레드가
 * 중복 생성되지 않는다.
 */
export async function findOrCreateDirectThread(userId: string, otherUserId: string): Promise<FindOrCreateThreadResult> {
  if (userId === otherUserId) return { ok: false, error: 'SELF' };

  const result = await withRelationCtx(pool, { userId }, async (client) => {
    // 같은 두 사람 쌍에 대한 동시 호출을 직렬화한다 — hashtext는 int4라
    // 서로 무관한 쌍끼리 충돌할 확률이 극히 낮고(약 1/40억), 트랜잭션 종료
    // 시 자동 해제되니 별도 unlock이 필요 없다.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext(least($1, $2)::text || ':' || greatest($1, $2)::text)::bigint)`,
      [userId, otherUserId],
    );

    const existing = await client.query<{ thread_id: string }>(
      `SELECT p1.thread_id
       FROM participants p1
       JOIN participants p2 ON p2.thread_id = p1.thread_id AND p2.user_id = $2
       WHERE p1.user_id = $1
         AND (SELECT count(*) FROM participants p3 WHERE p3.thread_id = p1.thread_id) = 2`,
      [userId, otherUserId],
    );

    const blocked = await client.query<{ blocked: boolean }>(`SELECT app_is_blocked_with($1) AS blocked`, [otherUserId]);
    if (blocked.rows[0]?.blocked) return { ok: false as const, error: 'BLOCKED' as const };

    if (existing.rows.length > 0) return { ok: true as const, threadId: existing.rows[0].thread_id, isNew: false };

    const friends = await client.query<{ friends: boolean }>(`SELECT app_is_friends_with($1) AS friends`, [otherUserId]);
    const isFriend = friends.rows[0]?.friends === true;

    // 🔒 `INSERT ... RETURNING id`를 쓰면 RLS 위반 에러가 난다 — message_threads_insert
    // 정책 자체는 `WITH CHECK (true)`라 항상 통과해야 하는데, RETURNING이 그
    // 새 행을 다시 읽어오면서 SELECT 정책(`app_is_participant(id) OR ...`)까지
    // 함께 평가된다 — 이 시점엔 아직 participants를 하나도 안 넣었으니
    // `app_is_participant`가 false라 SELECT가 막힌다. id를 서버가 미리 만들어
    // RETURNING 없이 INSERT하면 이 함정을 피할 수 있다.
    const newThreadId = randomUUID();
    await client.query(`INSERT INTO message_threads (id) VALUES ($1)`, [newThreadId]);
    await client.query(`INSERT INTO participants (thread_id, user_id) VALUES ($1, $2)`, [newThreadId, userId]);
    await client.query(`INSERT INTO participants (thread_id, user_id) VALUES ($1, $2)`, [newThreadId, otherUserId]);
    // "친구=즉시 스레드 / 비친구=요청" — 친구 사이엔 message_requests 행 자체를
    // 안 만든다. 그 행의 존재 여부가 곧 "요청함이냐 아니냐"다.
    if (!isFriend) {
      await client.query(`INSERT INTO message_requests (thread_id, status, origin) VALUES ($1, 'pending', 'direct')`, [newThreadId]);
    }
    return { ok: true as const, threadId: newThreadId, isNew: true };
  });

  if (result.ok && result.isNew) {
    // 두 참여자가 지금 소켓을 열어두고 있다면 새 스레드 채널을 즉시 구독시킨다
    // — 안 그러면 재연결 전까지 이 스레드의 실시간 신호를 못 받는다.
    await subscribeSocketsToThread(result.threadId, [userId, otherUserId]);
  }

  if (!result.ok) return result;
  return { ok: true, threadId: result.threadId };
}

export type SendMessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'LIMIT_REACHED' | 'NOT_PARTICIPANT' | 'INVALID_INPUT' | 'BLOCKED' };

const MAX_BODY_LENGTH = 2000;
/** "미수락: 발신자는 추가 발송 불가(1건 제한)". artifact의 "3"이 아니다 — 파일 헤더 주석 참고. */
const MAX_MESSAGES_BEFORE_ACCEPT = 1;

export async function sendMessage(userId: string, threadId: string, body: string): Promise<SendMessageResult> {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_BODY_LENGTH) return { ok: false, error: 'INVALID_INPUT' };

  const result = await withRelationCtx(pool, { userId }, async (client) => {
    const member = await client.query(`SELECT 1 FROM participants WHERE thread_id = $1 AND user_id = $2`, [threadId, userId]);
    if ((member.rowCount ?? 0) === 0) return { ok: false as const, error: 'NOT_PARTICIPANT' as const };

    // 🔒 차단 여부를 스레드 생성 시점에만 확인하면 안 된다 — 이미 존재하는
    // 스레드에서 이후에 차단해도 매번 재확인한다(messages_insert RLS에도
    // 같은 체크가 있지만, 여기서 먼저 확인해 원인이 분명한 에러를 돌려준다).
    const other = await client.query<{ user_id: string; blocked: boolean }>(
      `SELECT p.user_id, app_is_blocked_with(p.user_id) AS blocked
       FROM participants p WHERE p.thread_id = $1 AND p.user_id != $2 LIMIT 1`,
      [threadId, userId],
    );
    if (other.rows[0]?.blocked) return { ok: false as const, error: 'BLOCKED' as const };

    // 🔒 이 SELECT에 잠금이 없으면, 미수락 상태에서 같은 발신자가 동시에 두 번
    // 보낼 때 둘 다 "아직 1건도 안 보냈다"로 읽고 통과해 "1건 제한"을 우회할
    // 수 있다. FOR UPDATE로 행을 잠가 직렬화한다 — message_requests 행이
    // 없는(친구 사이) 스레드는 0행이라 잠글 것도 없다.
    const request = await client.query<{ status: string }>(`SELECT status FROM message_requests WHERE thread_id = $1 FOR UPDATE`, [threadId]);
    const pending = request.rows[0]?.status === 'pending';

    if (pending) {
      const senders = await client.query<{ sender_id: string }>(`SELECT DISTINCT sender_id FROM messages WHERE thread_id = $1`, [threadId]);
      const priorSenderIds = senders.rows.map((r) => r.sender_id);

      if (priorSenderIds.length > 0 && !priorSenderIds.includes(userId)) {
        // 상대가 처음 답장하는 순간 — 그 자체가 수락이다(파일 헤더 주석 참고).
        await client.query(`UPDATE message_requests SET status = 'accepted' WHERE thread_id = $1`, [threadId]);
      } else if (priorSenderIds.includes(userId)) {
        const mine = await client.query(`SELECT count(*) AS n FROM messages WHERE thread_id = $1 AND sender_id = $2`, [threadId, userId]);
        if (Number(mine.rows[0].n) >= MAX_MESSAGES_BEFORE_ACCEPT) {
          return { ok: false as const, error: 'LIMIT_REACHED' as const };
        }
      }
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [threadId, userId, trimmed],
    );
    return { ok: true as const, messageId: inserted.rows[0].id };
  });

  if (result.ok) {
    // 본문 없이 ID만 푸시한다. 실패해도 메시지 자체는 이미 저장됐으니 무시.
    publishNewMessage(threadId, result.messageId).catch((err) => console.error('publishNewMessage failed', err));
  }
  return result;
}

/** "메시지함" — inbox(수락됨·요청 아님)와 requests(미수락) 두 목록으로 나눠 반환한다. */
export async function fetchThreads(userId: string): Promise<{ inbox: ThreadSummary[]; requests: ThreadSummary[] }> {
  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{
      thread_id: string;
      other_id: string;
      other_username: string;
      other_nickname: string | null;
      last_body: string | null;
      last_created_at: string | null;
      last_sender_id: string | null;
      request_status: string | null;
      my_last_read_at: string | null;
    }>(
      `SELECT
         me.thread_id,
         u.id AS other_id, u.username AS other_username, u.nickname AS other_nickname,
         lm.body AS last_body, lm.created_at AS last_created_at, lm.sender_id AS last_sender_id,
         mr.status AS request_status,
         me.last_read_at AS my_last_read_at
       FROM participants me
       JOIN participants other ON other.thread_id = me.thread_id AND other.user_id != me.user_id
       JOIN users u ON u.id = other.user_id
       LEFT JOIN message_requests mr ON mr.thread_id = me.thread_id
       LEFT JOIN LATERAL (
         SELECT body, created_at, sender_id FROM messages m
         WHERE m.thread_id = me.thread_id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       WHERE me.user_id = $1
         -- participants는 RLS가 없어 여기서 직접 스코프해야 한다 — 차단
         -- 관계면 이미 있던 대화도 인박스/요청함 양쪽에서 숨긴다.
         AND NOT app_is_blocked_with(other.user_id)
       ORDER BY COALESCE(lm.created_at, '1970-01-01') DESC`,
      [userId],
    ),
  );

  const inbox: ThreadSummary[] = [];
  const requests: ThreadSummary[] = [];
  for (const row of rows.rows) {
    const summary: ThreadSummary = {
      id: row.thread_id,
      otherUser: { id: row.other_id, username: row.other_username, nickname: row.other_nickname ?? row.other_username },
      lastMessage: row.last_body === null || row.last_created_at === null || row.last_sender_id === null
        ? null
        : { body: row.last_body, createdAt: row.last_created_at, senderId: row.last_sender_id },
      isRequest: row.request_status === 'pending',
      isUnread:
        row.last_sender_id !== null &&
        row.last_sender_id !== userId &&
        row.last_created_at !== null &&
        (row.my_last_read_at === null || new Date(row.last_created_at) > new Date(row.my_last_read_at)),
    };
    (summary.isRequest ? requests : inbox).push(summary);
  }
  return { inbox, requests };
}

export async function fetchMessages(userId: string, threadId: string, limit = 50, offset = 0): Promise<MessageItem[]> {
  const rows = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; sender_id: string; body: string; created_at: string }>(
      `SELECT id, sender_id, body, created_at FROM messages
       WHERE thread_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [threadId, limit, offset],
    ),
  );
  // 최신 N개를 가져온 뒤 화면 표시는 시간순(오래된 것 먼저)이 자연스럽다.
  return rows.rows.reverse().map((r) => ({ id: r.id, senderId: r.sender_id, body: r.body, createdAt: r.created_at }));
}

export async function markThreadRead(userId: string, threadId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`UPDATE participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2`, [threadId, userId]),
  );
}

/** 좌측 메뉴 "Messages" 옆 안 읽음 표시용 — 스레드마다 마지막 메시지가
 * 내가 아닌 상대가 보낸 것이면서, 내 last_read_at보다 새 것인지만 본다. */
export async function hasUnreadMessages(userId: string): Promise<boolean> {
  const result = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ has_unread: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM participants me
         JOIN LATERAL (
           SELECT sender_id, created_at FROM messages m
           WHERE m.thread_id = me.thread_id ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
         WHERE me.user_id = $1
           AND lm.sender_id != $1
           AND (me.last_read_at IS NULL OR lm.created_at > me.last_read_at)
           AND NOT app_is_blocked_with(lm.sender_id)
       ) AS has_unread`,
      [userId],
    ),
  );
  return result.rows[0]?.has_unread ?? false;
}
