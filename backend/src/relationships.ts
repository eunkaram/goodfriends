/**
 * 친구 신청 수락 — §6.5 상태 머신의 "신청대기 → 친구" 전이.
 *
 * P4(intent-execution.ts)의 friend_request 액션은 새 신청을 "보내는" 것만
 * 다룬다 — 이미 온 신청을 수락하는 건 별개의 동작(status UPDATE)이라
 * §11.9.2 의도 보존 대상도 아니다(로그인 상태에서만 일어나는 일이라 소프트
 * 게이트가 필요 없다). friendships는 RLS가 없으므로(불변식 12) 여기서도
 * 본인이 addressee인 행만 골라 앱 레이어에서 직접 검증한다.
 */
import { appPool, withRelationCtx } from './db.ts';

const pool = appPool('exists');

export type AcceptResult = { ok: true } | { ok: false; error: 'NOT_FOUND' };

function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === code;
}

/**
 * 🔒 /review 발견(security, confidence 88) — 원래는 차단 여부를 전혀 확인하지
 * 않고 friendships를 'accepted'로 커밋한 뒤에야 follows INSERT를 시도했다.
 * B가 A에게 신청 → B가 A를 차단 → A가 수락하면: friendships UPDATE는
 * 무조건 성공(자기 트랜잭션이라 롤백 안 됨)하고, follows INSERT만 RLS
 * (42501)로 막혀 500이 났다 — 화면엔 에러가 뜨지만 DB엔 차단 관계인 두
 * 사람이 영구히 '친구'로 남는, 불변식 11(양방향 차단)을 정면으로 어기는
 * 상태가 만들어졌다.
 *
 * 고친 순서: (1) 아직 pending인지 조회만 한다 (2) 차단 여부를 명시적으로
 * 재검증한다(P4와 같은 원칙 — 신청 시점 이후 차단이 걸렸을 수 있다) (3) 팔로우
 * 두 건을 먼저 넣는다 — 여기서 뭔가 실패해도 friendships는 아직 안 건드렸으니
 * 그대로 안전하다 (4) 마지막에 조건부 UPDATE로 상태를 전이한다. friendships가
 * RLS 밖이라(불변식 12) 하나의 DB 트랜잭션으로 전부 묶을 순 없지만, 이 순서가
 * "차단당한 사이가 친구로 남는" 실패 모드 자체를 구조적으로 없앤다.
 */
export async function acceptFriendRequest(userId: string, requesterId: string): Promise<AcceptResult> {
  const pending = await withRelationCtx(pool, { userId }, (client) =>
    client.query(
      `SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [requesterId, userId],
    ),
  );
  if ((pending.rowCount ?? 0) === 0) return { ok: false, error: 'NOT_FOUND' };

  const blocked = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ blocked: boolean }>(`SELECT app_is_blocked_with($1) AS blocked`, [requesterId]),
  );
  if (blocked.rows[0]?.blocked) return { ok: false, error: 'NOT_FOUND' }; // 사유 비공개(§10.2) — NOT_FOUND와 동일하게 보인다

  // §6.5 R1 — 친구 수락 시 상호 자동 팔로우.
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, requesterId]),
  );
  try {
    await withRelationCtx(pool, { userId: requesterId }, (client) =>
      client.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [requesterId, userId]),
    );
  } catch (err) {
    // 🔒 /review 발견(red-team) — 위 첫 팔로우 INSERT와 이 두 번째 INSERT
    // 사이의 찰나에 차단이 새로 걸리면 follows RLS(42501)가 여기서만 막는다.
    // 안 잡으면 첫 팔로우 행만 고아로 남고 friendships는 영원히 pending에
    // 머문다 — 보상 삭제로 방금 넣은 첫 팔로우 행을 되돌린다.
    if (isPgError(err, '42501')) {
      await withRelationCtx(pool, { userId }, (client) =>
        client.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [userId, requesterId]),
      );
      return { ok: false, error: 'NOT_FOUND' };
    }
    throw err;
  }

  const result = await withRelationCtx(pool, { userId }, (client) =>
    client.query(
      `UPDATE friendships SET status = 'accepted'
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [requesterId, userId],
    ),
  );
  if ((result.rowCount ?? 0) === 0) return { ok: false, error: 'NOT_FOUND' };

  return { ok: true };
}

/** §6.5 R3 "친구를 끊어도 팔로우는 유지" — 반대로 팔로우 해제는 언제든 단독으로 가능해야 한다. follows DELETE RLS(0014)가 그대로 보호한다. */
export async function unfollow(userId: string, followeeId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [userId, followeeId]),
  );
}

/**
 * 친구 삭제("unfriend") — 사용자 지시(2026-08, "목업UI와 완벽하게 싱크")로
 * 새로 노출된 Friends 탭 메뉴 액션(artifact showProfile 친구 카드 "···" 메뉴).
 * §6.5 R3와 같은 원칙으로 팔로우는 안 건드린다 — 친구 관계만 끊는다.
 * friendships는 RLS가 없어(불변식 12) 이 WHERE 절 자체가 유일한 권한 경계다 —
 * 본인이 requester/addressee 둘 중 하나인 accepted 행만 지워진다.
 */
export async function unfriend(userId: string, friendId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(
      `DELETE FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [userId, friendId],
    ),
  );
}

/** 🔒 사용자 발견(2026-08-26, "팔로워 페이지에서 아바타 아이콘 안나옴") —
 * avatarUrl이 없어 ProfileTabs의 FollowerCard가 빈 색상 원만 그리고 있었다
 * (PostCard 등 다른 화면은 authorAvatarUrl로 실제 사진/이니셜을 그린다).
 * 세 조회 함수(fetchFollowing/fetchFollowers/fetchConnectedUsers) 전부 이
 * 타입을 공유해서 한 곳만 넓혔다. */
export type FollowingUser = { id: string; username: string; nickname: string; avatarUrl: string };

/** §11.7.1 좌 사이드바 "팔로잉" 위젯 — follows_select RLS(0014)가 본인 관련 행만 보이게 이미 막아준다. */
export async function fetchFollowing(userId: string, limit = 5): Promise<FollowingUser[]> {
  const r = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; username: string; nickname: string; avatar_url: string }>(
      `SELECT u.id, u.username, u.nickname, u.avatar_url
       FROM follows f JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [userId, limit],
    ),
  );
  return r.rows.map((row) => ({ id: row.id, username: row.username, nickname: row.nickname, avatarUrl: row.avatar_url }));
}

export type FollowerListItem = FollowingUser & {
  /** 뷰어 자신이 이 팔로워를 팔로우하고 있는지 — "팔로잉 취소" 메뉴 노출 조건(ProfileTabs.tsx). */
  isFollowedByViewer: boolean;
};

/**
 * 🔒 사용자 지시(2026-08-26, "프로필 페이지의 친구 탭을 folower로 변경하고,
 * 내용도 follower들의 리스트를 보여줘") — fetchFollowing과 방향만 반대
 * (follower_id/followee_id를 서로 바꿔치기). ProfileTabs.tsx의 Follower
 * 탭에서 쓴다.
 *
 * 🔒 후속(2026-08-27, /qa 코드 리뷰 발견 — "팔로잉 취소" 메뉴가 팔로워
 * 카드마다 무조건 떴는데 실제로는 뷰어가 그 사람을 팔로우 중일 때만 의미가
 * 있다(아니면 DELETE가 0건 삭제로 조용히 끝나 아무 반응 없는 버튼처럼
 * 보인다) → 사용자 확인("실제로 팔로우중일때만 버튼을 보여줘. 내 페이지에서는
 * 팔로워 확인만 가능해야 할것 같은데?") — 카드마다 "뷰어가 이 사람을
 * 팔로우하는지" 여부를 같이 내려준다.
 *
 * ownerId 기준 RLS 세션(팔로워 목록 자체를 읽으려면 owner가 이 관계의 당사자여야
 * follows_select RLS(0014)를 통과한다 — follower_id=me OR followee_id=me)과
 * viewerId 기준 RLS 세션(뷰어의 팔로우 여부를 읽으려면 이번엔 뷰어가 당사자여야
 * 한다)은 서로 다른 신원이 필요해 한 세션으로 합칠 수 없다 — 두 번째 조회를
 * 별도 트랜잭션으로 분리했다(§10.2 재검증 관례처럼 신뢰하지 않고 다시 조회).
 * viewerId===ownerId(본인 프로필)면 UI가 이 값 자체를 안 쓰므로(항상 메뉴
 * 숨김) 호출부에서 스킵할 수 있다.
 */
export async function fetchFollowers(ownerId: string, viewerId: string, limit = 50): Promise<FollowerListItem[]> {
  const r = await withRelationCtx(pool, { userId: ownerId }, (client) =>
    client.query<{ id: string; username: string; nickname: string; avatar_url: string }>(
      `SELECT u.id, u.username, u.nickname, u.avatar_url
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [ownerId, limit],
    ),
  );
  if (r.rows.length === 0) return [];

  const followerIds = r.rows.map((row) => row.id);
  const followedSet =
    viewerId === ownerId
      ? new Set<string>()
      : new Set(
          (
            await withRelationCtx(pool, { userId: viewerId }, (client) =>
              client.query<{ followee_id: string }>(
                `SELECT followee_id FROM follows WHERE follower_id = $1 AND followee_id = ANY($2::uuid[])`,
                [viewerId, followerIds],
              ),
            )
          ).rows.map((row) => row.followee_id),
        );

  return r.rows.map((row) => ({
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    isFollowedByViewer: followedSet.has(row.id),
  }));
}

/**
 * 🔒 사용자 지시(2026-08-26, "메세지 작성 아이콘 클릭시 following/follower
 * 처럼 나와 연결된 모든 사용자 대상으로 수정") — 메시지 작성 대상 목록을
 * 친구(fetchFriends, user-log.ts)에서 팔로잉·팔로워 합집합으로 교체.
 * follows_select RLS(0014)가 이미 "내가 follower거나 followee인 행"만
 * 보이게 막아줘서 앱 레이어 필터 없이 그대로 UNION하면 된다(UNION 자체가
 * 맞팔 등 중복을 제거한다).
 */
export async function fetchConnectedUsers(userId: string, limit = 100): Promise<FollowingUser[]> {
  const r = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; username: string; nickname: string; avatar_url: string }>(
      `SELECT u.id, u.username, u.nickname, u.avatar_url
       FROM (
         SELECT followee_id AS other_id FROM follows WHERE follower_id = $1
         UNION
         SELECT follower_id AS other_id FROM follows WHERE followee_id = $1
       ) x
       JOIN users u ON u.id = x.other_id
       ORDER BY u.nickname
       LIMIT $2`,
      [userId, limit],
    ),
  );
  return r.rows.map((row) => ({ id: row.id, username: row.username, nickname: row.nickname, avatarUrl: row.avatar_url }));
}
