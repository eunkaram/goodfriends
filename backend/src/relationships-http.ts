/**
 * 관계 HTTP 라우트 — 친구 신청 "수락"만 다룬다. 신청 "보내기"·팔로우는
 * §11.9.2 의도 실행(POST /api/intent/execute, intent-execution.ts)이 이미 맡고 있다 —
 * 로그인 사용자가 직접 눌러도 같은 엔드포인트를 그대로 쓴다(§4.5 CLAUDE.md 참고).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { acceptFriendRequest, unfollow, unfriend, fetchFollowing, fetchConnectedUsers } from './relationships.ts';
import { fetchFriends } from './user-log.ts';

export async function handleRelationshipsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // #5 — 좌 사이드바 "팔로잉" 위젯(fetchFollowing)을 모바일 드로어에서도 쓰려면
  // HTTP로 노출돼야 한다. username 파라미터 없음 — 항상 요청자 본인 팔로잉만
  // (RLS도 이미 그렇게만 허용).
  if (req.method === 'GET' && url.pathname === '/api/relationships/following') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 5, { min: 1, max: 50 });
    const following = await fetchFollowing(userId, limit);
    json(res, 200, { following });
    return true;
  }

  // 이슈 #1 — 메시지 작성 "받는 사람" 후보 목록. fetchConnectedUsers는 팔로우
  // 방향 무관 팔로잉+팔로워 합집합, 항상 요청자 본인 기준.
  if (req.method === 'GET' && url.pathname === '/api/relationships/connected') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 100, { min: 1, max: 500 });
    const connected = await fetchConnectedUsers(userId, limit);
    json(res, 200, { connected });
    return true;
  }

  // 이슈 #2 — "친구" 탭 목록. friendships는 RLS가 없어 fetchFriends가 이미
  // 본인 관련 행만 걸러 읽는다 — 라우트는 감싸기만 한다.
  if (req.method === 'GET' && url.pathname === '/api/friends') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 50, { min: 1, max: 200 });
    const friends = await fetchFriends(userId, limit);
    json(res, 200, { friends });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/friend-requests/accept') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { requesterId } = JSON.parse(await readBody(req)) as { requesterId: string };
    // 🔒 /review 발견(api-contract) — id 형식이 깨지면 아래 uuid 컬럼 비교가
    // 잡히지 않은 500으로 새어나갔다.
    if (!isUuid(requesterId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await acceptFriendRequest(userId, requesterId);
    json(res, result.ok ? 200 : 404, result.ok ? { ok: true } : { error: result.error });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/follows') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { followeeId } = JSON.parse(await readBody(req)) as { followeeId: string };
    if (!isUuid(followeeId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await unfollow(userId, followeeId);
    json(res, 200, { ok: true });
    return true;
  }

  // 사용자 지시(2026-08, "목업UI와 완벽하게 싱크") — Friends 탭 카드 "···" 메뉴의
  // "삭제" 액션. DELETE /api/follows와 같은 형태(body에 대상 id, 204 아님 200).
  if (req.method === 'DELETE' && url.pathname === '/api/friends') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { friendId } = JSON.parse(await readBody(req)) as { friendId?: string };
    if (!isUuid(friendId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await unfriend(userId, friendId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
