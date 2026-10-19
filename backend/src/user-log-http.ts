/**
 * 프로필 편집 HTTP 라우트 — Claude Design 확정안(artifact `editOpen`) 신설
 * 기능. albums-http.ts와 같은 패턴. userId는 항상 세션에서만 유도한다 — 클라
 * 이언트가 수정 대상을 지정할 방법 자체가 없어(불변식 19 대상 아님, id를
 * 아예 안 받는다).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { checkRateLimit } from './rate-limit.ts';
import {
  updateProfile,
  isUsernameAvailable,
  previewPostalLocation,
  isValidPostalCodeFormat,
  fetchUserLogByUsername,
  fetchUserLogByUserId,
  fetchLogPosts,
  fetchRelationshipStatus,
  fetchFollowStatus,
  fetchOwnLocationFields,
  type UpdateProfileInput,
} from './user-log.ts';
import { fetchPostsCommentedByUser, fetchMediaPostsForLog } from './feed.ts';
import { fetchFollowers } from './relationships.ts';

export async function handleUserLogRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 🔒 사용자 지시(2026-08, "아이디 변경시 비동기로 중복여부 확인해야해") —
  // ProfileEditModal이 아이디 입력을 debounce해서 부르는 실시간 확인. 실제
  // 소유권 변경은 하지 않는 순수 조회라 세션만 요구하고(로그인 안 한 사람이
  // 무제한으로 아이디를 훑는 걸 막는다), isUsernameAvailable()을 그대로
  // 재사용해 저장 시점 재확인(updateProfile)과 판정 로직이 절대 갈라지지
  // 않게 한다.
  if (req.method === 'GET' && url.pathname === '/api/profile/username-available') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!(await checkRateLimit(`username-check:${userId}`, 60, 600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const username = url.searchParams.get('username') ?? '';
    const available = await isUsernameAvailable(username, userId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ available }));
    return true;
  }

  // 🔒 사용자 지시(2026-08, "zipcode를 입력하면 국가와 zipcode로 위치정보...
  // 입력창 오른쪽에 보여줘") — username-available과 같은 패턴(로그인
  // 필수 + 레이트리밋, 저장 전 실시간 확인).
  // 🔒 사용자 발견(2026-08, "미국 zipcode 19134를 입력했는데 일치하는
  // 위치가 없대. 정상적인 zipcode야") — postal_code_index는 대표값 8곳뿐
  // 이라(§17.3) "표에 없음"이 "형식이 틀림"과 같은 의미가 아니다. `validFormat`
  // (updateProfile의 저장 판정과 같은 isValidPostalCodeFormat)과
  // `label`(있으면 보너스 정보)을 분리해서 내려준다 — 프론트가 형식
  // 오류(빨강)와 "형식은 맞는데 상세 정보가 없음"(중립, 저장은 가능)을
  // 구분해서 보여줄 수 있게.
  if (req.method === 'GET' && url.pathname === '/api/profile/location-preview') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!(await checkRateLimit(`location-preview:${userId}`, 60, 600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const country = url.searchParams.get('country') ?? '';
    const postalCode = url.searchParams.get('postalCode') ?? '';
    const validFormat = isValidPostalCodeFormat(country, postalCode);
    const label = validFormat ? await previewPostalLocation(country, postalCode) : null;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ validFormat, label }));
    return true;
  }

  // GitHub #3 — 로그인 직후 자기 프로필을 열 방법이 없었다(세션은 userId만
  // 주고, 조회 함수는 username 기준). 정적 경로라 아래 :username 라우트보다
  // 먼저 둘 필요는 없지만(정확히 "/api/profile"만 매치, 세그먼트 없음) 읽는
  // 순서상 여기 둔다.
  if (req.method === 'GET' && url.pathname === '/api/profile') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const profile = await fetchUserLogByUserId(userId);
    if (!profile) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    // 이슈 #5(프론트) — 프론트가 이 화면(본인 프로필)에서만 우편번호 편집
    // 폼을 미리 채우는 원본 country/postalCode가 필요하다(fetchOwnLocationFields
    // 자체엔 경계가 없어 본인 세션에서만 노출).
    const ownLocation = await fetchOwnLocationFields(userId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ ...profile, ...ownLocation }));
    return true;
  }

  // GitHub #3 — fetchUserLogByUsername이 이미 프로필에 필요한 데이터를 전부
  // 반환하는데(웹이 SSR로 직접 호출) JSON 라우트가 없었다. 인증 선택 —
  // 비로그인도 공개 프로필은 봐야 한다(§4.3). 비공개(private/friends) 처리는
  // fetchUserLogByUsername 내부 RLS를 그대로 신뢰 — 뷰어 권한이 없으면 그냥
  // null(=404)이 되므로 여기서 따로 판단하지 않는다(§10.2와 같은 원칙).
  // username-available·location-preview 같은 고정 경로 다음에 둬서, 그
  // 경로들이 실수로 이 패턴에 먹히지 않게 한다.
  const profileMatch = req.method === 'GET' && url.pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (profileMatch) {
    const sessionToken = resolveSessionToken(req);
    const viewerId = await getSessionUserId(sessionToken);
    const username = decodeURIComponent(profileMatch[1]);
    const profile = await fetchUserLogByUsername(viewerId, username);
    if (!profile) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    // 이슈 #5(프론트) — 프론트(UserLogView.tsx)가 팔로우/친구 버튼 상태와
    // "팔로워 공개 여부"(§10.2 재검증 원칙) 판정에 필요한데 이 응답에
    // 빠져 있었다. fetchUserLogByUsername의 RLS 게이트를 이미 통과했다는
    // 뜻이라(위 주석) viewerId가 null이어도 두 함수 모두 안전하게 처리한다.
    const [relationshipStatus, isFollowing] = await Promise.all([
      fetchRelationshipStatus(viewerId, profile.userId),
      fetchFollowStatus(viewerId, profile.userId),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ ...profile, relationshipStatus, isFollowing }));
    return true;
  }

  // GitHub #4 — ProfileTabs.tsx의 Post/Replies/Media/Follower 4탭, 지금까지
  // UserLogView.tsx(SSR)만 직접 호출하던 서버 함수를 그대로 감싼다. 인증·404
  // 패턴은 바로 위 GET /api/profile/:username과 동일 — app_can_view_tier()
  // (0031)가 app_current_user_id() IS NOT NULL을 요구해서 비로그인은 log가
  // 항상 null(=404)이 되므로(user-log-http.test.ts의 §4.3 테스트 참고), 여기
  // 이 4개 라우트에 도달한 시점엔 viewerId가 이미 non-null임이 보장된다.
  const profileSubMatch = req.method === 'GET' && url.pathname.match(/^\/api\/profile\/([^/]+)\/(posts|replies|media|followers)$/);
  if (profileSubMatch) {
    const sessionToken = resolveSessionToken(req);
    const viewerId = await getSessionUserId(sessionToken);
    const username = decodeURIComponent(profileSubMatch[1]);
    const log = await fetchUserLogByUsername(viewerId, username);
    if (!log) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: Number.MAX_SAFE_INTEGER });

    const tab = profileSubMatch[2];
    if (tab === 'posts') {
      const posts = await fetchLogPosts(viewerId, log.userId, limit, offset);
      json(res, 200, { posts });
      return true;
    }
    if (tab === 'replies') {
      const items = await fetchPostsCommentedByUser(viewerId, log.userId, limit, offset);
      json(res, 200, { items });
      return true;
    }
    if (tab === 'media') {
      const posts = await fetchMediaPostsForLog(viewerId, log.userId, limit, offset);
      json(res, 200, { posts });
      return true;
    }
    // tab === 'followers'
    if (!viewerId) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    const followers = await fetchFollowers(log.userId, viewerId, limit);
    json(res, 200, { followers });
    return true;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/profile') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const input = JSON.parse(await readBody(req)) as UpdateProfileInput;
    const result = await updateProfile(userId, input);
    if (!result.ok) {
      // 🔒 사용자 지시(2026-08, "목업UI와 완벽하게 싱크") — username 필드가
      // 새로 편집 가능해지며 추가된 결과 — auth-http.ts의 이메일 중복(409)과
      // 같은 관례로 매핑한다.
      json(res, result.error === 'USERNAME_TAKEN' ? 409 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
