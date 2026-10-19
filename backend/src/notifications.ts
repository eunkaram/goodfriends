/**
 * 알림 — §6.7. `notifications`/`notification_settings` 스키마·RLS는
 * `0010_notification.sql`에 이미 있었지만(수신자 본인만 SELECT/UPDATE/DELETE,
 * INSERT는 발신 주체가 수신자와 다르므로 제약 없음) 지금까지 아무 코드도
 * 읽거나 쓰지 않는 죽은 인프라였다 — 이 파일이 그 첫 사용처.
 *
 * 🔒 사용자 지시(2026-08-26, "notification의 내용을 디비와 연동해서 실제
 * 데이터를 보여줘") — 범위: follow 알림만(지난 라운드에서 "친구는 나중,
 * follow만 지금"으로 좁힌 결정과 같은 선). comment/reaction/friend_request
 * 알림은 type 컬럼상 이미 지원되지만 아직 어디서도 insert하지 않는다 —
 * 다음 라운드 확장 지점.
 */
import type pg from 'pg';
import { appPool, withRelationCtx } from './db.ts';

const pool = appPool('exists');

export type NotificationType = 'comment' | 'reaction' | 'friend_request' | 'follow';

/**
 * 알림 생성 공통 헬퍼 — 호출자가 이미 열어 둔 트랜잭션(client)에 얹는다.
 * intent-execution.ts의 follow 알림이 팔로우 INSERT와 한 트랜잭션으로
 * 묶였던 것과 같은 이유(원본 쓰기와 원자적으로 성공/실패).
 *
 * 🔒 notifications_insert RLS는 `WITH CHECK (true)`다(0010) — 수신자 본인
 * 제약이 없다는 뜻은 "누구에게든 꽂을 수 있다"는 뜻이기도 하다. comment/
 * reaction 알림의 수신자는 댓글/반응이 달리는 대상(글·댓글)의 작성자인데,
 * 그 작성자가 항상 "이미 차단 여부가 검증된 대상"인 건 아니다 — 예를 들어
 * 답글은 부모 댓글 작성자에게 알리지만, 호출부의 재검증(P4와 같은 원칙)은
 * 글 작성자와의 차단만 걸러낸다(포스트 RLS 경유). 그래서 이 헬퍼가 매번
 * app_is_blocked_with()로 actor↔recipient 차단을 직접, 양방향으로 재확인한다
 * (불변식 11) — 어느 호출부가 이미 걸렀든 안 걸렀든 여기서 한 번 더 막는다.
 *
 * 반환값(실제로 행을 만들었는지)은 push-dispatch.ts 호출 여부를 결정하는 데
 * 쓴다 — 자기알림·차단으로 스킵됐으면 푸시도 보내면 안 된다(같은 판정을
 * 두 곳에서 따로 하면 어긋날 위험이 있어 여기 한 곳의 결과를 그대로 신뢰한다).
 */
export async function createNotification(
  client: pg.PoolClient,
  actorId: string,
  recipientId: string,
  type: NotificationType,
  targetType: string,
  targetId: string,
): Promise<boolean> {
  if (actorId === recipientId) return false; // 자기 자신에게는 알리지 않는다
  const blocked = await client.query<{ blocked: boolean }>('SELECT app_is_blocked_with($1) AS blocked', [recipientId]);
  if (blocked.rows[0]?.blocked) return false;
  await client.query(
    `INSERT INTO notifications (user_id, actor_id, type, target_type, target_id) VALUES ($1, $2, $3, $4, $5)`,
    [recipientId, actorId, type, targetType, targetId],
  );
  return true;
}

export type NotificationItem = {
  id: string;
  type: string;
  actorId: string | null;
  actorNickname: string | null;
  actorUsername: string | null;
  targetType: string;
  targetId: string;
  createdAt: string;
  isRead: boolean;
};

/** notifications_select RLS(0010) — user_id = app_current_user_id()만 보인다. */
export async function listNotifications(userId: string, limit = 30): Promise<NotificationItem[]> {
  const r = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{
      id: string;
      type: string;
      actor_id: string | null;
      actor_nickname: string | null;
      actor_username: string | null;
      target_type: string;
      target_id: string;
      created_at: string;
      is_read: boolean;
    }>(
      `SELECT n.id, n.type, n.actor_id, a.nickname AS actor_nickname, a.username AS actor_username,
              n.target_type, n.target_id, n.created_at, (n.read_at IS NOT NULL) AS is_read
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [userId, limit],
    ),
  );
  return r.rows.map((row) => ({
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    actorNickname: row.actor_nickname,
    actorUsername: row.actor_username,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
    isRead: row.is_read,
  }));
}

/** notifications_update RLS — user_id 본인 행만 갱신 가능. */
export async function markNotificationRead(userId: string, id: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [id]),
  );
}

/** 사용자 지시(2026-08-26, "페이지를 나갈때 읽음으로 처리") — Notification 탭 언마운트 시 호출. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`),
  );
}
