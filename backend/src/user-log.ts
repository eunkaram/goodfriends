/**
 * 개인 로그 — §6.4, §11.7.6, §4.3(비로그인 전면 차단). user_logs/albums/photos는
 * T30(0005_userlog_album_photo.sql)에서 이미 RLS까지 완성돼 있었다 — 이번엔
 * 그 위에 앱 레이어(조회 함수·화면)만 얹는다.
 *
 * user_logs는 users와 1:1이지만 가입 시 자동 생성되지 않았다(실측 발견 —
 * auth.ts는 authPool()을 쓰고 그 역할엔 user_logs GRANT가 없다, 의도적 격리).
 * 그래서 가입 직후 별도 호출로 기본 로그를 만든다(아래 createDefaultUserLog) —
 * auth 트랜잭션과 역할을 분리해 §6.1 "자격증명 격리" 원칙을 지킨다.
 */
import { appPool, withRelationCtx, queryRaw } from './db.ts';
import { fetchHomeFeedForLog } from './feed.ts';
import { fetchProfileLinks, type ProfileLink } from './profile-links.ts';
import { RESERVED_USERNAMES } from './reserved-usernames.ts';
import { isReservedNickname } from './reserved-nicknames.ts';

function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === code;
}

export type UserLogProfile = {
  userId: string;
  username: string;
  nickname: string;
  title: string;
  intro: string;
  visibility: 'public' | 'friends' | 'private' | 'followers';
  joinedAt: string;
  postCount: number;
  /** users.country/postal_code에서 자동 계산된 표시용 문자열("서울, 대한민국"). */
  location: string | null;
  /** 사용자 지시(2026-08, "링크... 여러개 입력 받고 싶어") — 고정 3필드(링크/
   * 인스타그램/트위터)를 대체하는 임의 개수 목록. src/profile-links.ts 참고. */
  profileLinks: ProfileLink[];
  /** 사용자 지시(2026-08, "프로필 편집 팝업... 이미지 업로드 기능") — 비어있으면 이니셜 아바타로 폴백. */
  avatarUrl: string;
  /** RLS 밖에서 SECURITY DEFINER 집계(app_follower_count)로 정확히 센 값 — 개별 팔로워는 절대 안 나간다. */
  followerCount: number;
  /** posts RLS 안에서 센 값(postCount와 같은 철학) — 뷰어가 볼 수 있는 글의 좋아요만 집계된다. */
  likeCount: number;
  /** likeCount와 같은 패턴 — 뷰어가 볼 수 있는 내 글들이 받은 댓글 총합. */
  commentCount: number;
};

export type RelationshipStatus = 'self' | 'none' | 'pending_sent' | 'pending_received' | 'friends';

const pool = appPool('exists');

/** 가입 직후 1회 호출. 실패해도 가입 자체는 막지 않는다(이메일 발송 실패와 같은 원칙) — 호출부가 try/catch로 감싼다. */
export async function createDefaultUserLog(userId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`INSERT INTO user_logs (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]),
  );
}

/**
 * RLS(user_logs, app_can_view_tier)가 로그인 여부·차단·공개범위를 전부
 * 걸러준다 — 비로그인이면 이 함수는 항상 null을 반환한다(§4.3).
 * 🔒 postCount는 posts RLS 안에서 COUNT하므로 "이 뷰어가 볼 수 있는 글 수"다 —
 * 소유자 본인이 보면 전체, 타인이 보면 그 타인 눈에 보이는 글만 세어진다.
 * 이 앱의 RLS 철학과 일관된 동작이라 별도 "진짜 총 글 수" 집계는 안 만들었다.
 *
 * 🔒 실전 버그(2026-08, 사용자 발견 — "프로필 페이지의 글... 데이터가 제대로
 * 잘 나오는지 확인해줘. 잘 안나오는것 같아") — postCount가 `p.log_id =
 * ul.user_id`로 세고 있었다. log_id는 "My Post"(로그 전용) 글에만 채워지고
 * 커뮤니티 게시판 글(category_id 있는 글)은 항상 NULL이라, 게시판에 쓴 글이
 * 전부 이 숫자에서 빠지고 있었다(실측 — 전체 13개 글 중 1개만 잡힌 계정
 * 발견). app_post_like_count(0025)처럼 author_id 기준으로 고쳤다 — 이제
 * 게시판+My Post 합산이 "글" 수다.
 */
export async function fetchUserLogByUsername(viewerId: string | null, username: string): Promise<UserLogProfile | null> {
  const r = await withRelationCtx(pool, { userId: viewerId }, (client) =>
    client.query<{
      user_id: string;
      nickname: string | null;
      title: string;
      intro: string;
      visibility: UserLogProfile['visibility'];
      joined_at: string;
      post_count: string;
      avatar_url: string;
      follower_count: string;
      like_count: string;
      comment_count: string;
    }>(
      `SELECT ul.user_id, u.nickname, ul.title, ul.intro, ul.visibility, u.created_at AS joined_at,
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = ul.user_id) AS post_count,
              u.avatar_url,
              app_follower_count(ul.user_id) AS follower_count,
              app_post_like_count(ul.user_id) AS like_count,
              app_post_comment_count(ul.user_id) AS comment_count
       FROM user_logs ul JOIN users u ON u.id = ul.user_id
       WHERE u.username = $1`,
      [username],
    ),
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  // 🔒 사용자 지시(2026-08, "zipcode를 입력하면 자동으로 지역을 처리해야해") —
  // 0025의 자유 텍스트 오버라이드(user_logs.location)를 이 라운드에서
  // 완전히 대체했다(0028이 컬럼 자체를 드롭) — 이제 위치는 항상
  // users.country/postal_code에서 자동 계산된다.
  const [location, profileLinks] = await Promise.all([fetchUserLocationLabel(row.user_id), fetchProfileLinks(viewerId, row.user_id)]);
  return {
    userId: row.user_id,
    username,
    nickname: row.nickname ?? username,
    title: row.title,
    intro: row.intro,
    visibility: row.visibility,
    joinedAt: row.joined_at,
    postCount: Number(row.post_count),
    location,
    profileLinks,
    avatarUrl: row.avatar_url,
    followerCount: Number(row.follower_count),
    likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count),
  };
}

/**
 * GitHub #3 — 세션은 `{ userId, emailVerified }`만 주고 signup에도 username이
 * 없어서(자동 생성, PATCH /api/profile로만 나중에 변경) 로그인 직후 "내
 * 프로필"을 열 방법이 없었다. users엔 RLS가 없다(0001, 0043 주석 참고) —
 * username만 먼저 조회한 뒤 기존 fetchUserLogByUsername을 그대로 재사용해서
 * 판정 로직(공개범위·차단 등)이 두 곳으로 갈라지지 않게 한다.
 */
export async function fetchUserLogByUserId(userId: string): Promise<UserLogProfile | null> {
  const u = await queryRaw<{ username: string }>(pool, `SELECT username FROM users WHERE id = $1`, [userId]);
  if (u.rows.length === 0) return null;
  return fetchUserLogByUsername(userId, u.rows[0].username);
}

export type UpdateProfileInput = {
  nickname?: string;
  intro?: string;
  visibility?: 'public' | 'followers' | 'private';
  /** 사용자 지시(2026-08, "목업UI와 완벽하게 싱크") — URL(`/@{username}`) 정체성을
   * 바꾸는 필드라 이번에 처음 편집 가능해졌다. 형식 검증 + 중복확인을 거친다. */
  username?: string;
  /** 사용자 지시(2026-08, "zipcode를 입력하면 자동으로 지역을 처리해야해") —
   * 자유 텍스트 location을 대체. 둘 다 같이 온다고 가정한다(편집 UI가
   * zipcode+국가 select를 한 쌍으로 제출) — postalCode가 비어있지 않은데
   * country가 없으면 검증 자체가 불가능해 거부한다. */
  country?: string;
  postalCode?: string;
  /** POST /api/media/upload가 돌려준 공개 URL을 그대로 받는다. 빈 문자열이면 이니셜로 되돌린다. */
  avatarUrl?: string;
};
export type UpdateProfileResult = { ok: true } | { ok: false; error: 'INVALID_INPUT' | 'USERNAME_TAKEN' | 'INVALID_LOCATION' };

const MAX_NICKNAME_LENGTH = 30;
const MAX_INTRO_LENGTH = 300;
const MAX_URL_LENGTH = 300;
// signUpWithEmail의 uniqueUsernameFrom()이 자동 생성하는 아이디와 같은 문자셋(auth.ts) — 최소 길이 3만 이번에 추가.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const URL_RE = /^https?:\/\//i;

/**
 * 🔒 사용자 발견(2026-08, "미국 zipcode 19134를 입력했는데 일치하는 위치가
 * 없대. 정상적인 zipcode야") — 처음엔 postal_code_index에 실제로 존재하는
 * 조합만 저장을 허용했는데, 그 표는 §17.3에 이미 문서화된 대로 "실측
 * 데이터가 아니다 — 미국 5곳 + 한국 3곳만 시드한 대표값"이라, 이 검증이
 * 사실상 거의 모든 실제 사용자의 정상적인 우편번호를 거부하고 있었다.
 * 존재 여부가 아니라 형식만 검증하도록 낮췄다 — 도시/주 표시는 매치될
 * 때만 보너스로 붙고(fetchUserLocationLabel의 "city 없으면 국가명만"
 * 폴백이 이미 이 경우를 처리한다), 없다고 저장 자체를 막지 않는다.
 */
const POSTAL_CODE_FORMAT: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  KR: /^\d{5}$/,
};

export function isValidPostalCodeFormat(country: string, postalCode: string): boolean {
  const re = POSTAL_CODE_FORMAT[country];
  return re ? re.test(postalCode) : postalCode.length > 0; // 형식 규칙이 없는 국가는 비어있지만 않으면 통과
}

/**
 * 🔒 사용자 지시(2026-08, "아이디 변경시 비동기로 중복여부 확인해야해. 그리고
 * 저장시에도 중복여부 한번더 확인하고 저장해야해") — `updateProfile()`이
 * 저장 직전에 쓰던 인라인 중복확인 쿼리를 재사용 가능한 함수로 뽑았다.
 * `src/user-log-http.ts`의 `GET /api/profile/username-available`(편집 중
 * 실시간 확인)과 `updateProfile()`(저장 시점 재확인) 둘 다 이 함수 하나를
 * 공유한다 — 로직이 갈라지면 "편집 중엔 가능하다고 나왔는데 저장은
 * 막힌다" 같은 불일치가 생길 수 있어서다. 형식이 잘못됐으면 그 자체로
 * "사용 불가"로 취급한다(빈 문자열 등 검색해서 아무것도 안 걸리는 걸
 * "가능"으로 오판하지 않도록).
 */
export async function isUsernameAvailable(username: string, excludeUserId: string): Promise<boolean> {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_RE.test(normalized)) return false;
  if (RESERVED_USERNAMES.has(normalized)) return false;
  const taken = await queryRaw(pool, `SELECT 1 FROM users WHERE username = $1 AND id <> $2`, [normalized, excludeUserId]);
  return (taken.rowCount ?? 0) === 0;
}

/**
 * 🔒 사용자 지시(2026-08, "profile페이지를... 목업UI와 완벽하게 싱크되어야해") —
 * artifact `editOpen`의 "아이디"·"링크" 필드(이전 라운드에서 스코프 밖으로
 * 뺐던 것)와 "위치"(가입 시 국가+우편번호에서 자동 계산되던 값)를 이번에
 * 전부 편집 가능하게 열었다. `userId`는 항상 세션에서 유도된 본인 id만 받는다
 * (클라이언트가 대상을 지정할 방법이 없다) — 그래서 소유권 검증이 따로
 * 필요 없다.
 *
 * 🔒 아바타는 `<img src>`로 그대로 렌더링된다(ProfileHeader) — 빈 문자열이
 * 아니면 반드시 `http(s)://`로 시작해야 한다는 검증이 단순 스타일 규칙이
 * 아니라 `javascript:` 스킴을 통한 XSS를 막는 보안 경계다.
 *
 * 🔒 사용자 지시(2026-08, "zipcode저장시 국가와 zip코드를 확인하고 잘못된
 * 경우 에러를 띄워줘야해") — country는 `COUNTRIES`(src/countries.ts, 가입
 * 폼과 같은 목록)에 있는 코드인지, postalCode는 `isValidPostalCodeFormat()`
 * 으로 그 국가의 우편번호 형식에 맞는지 검증한다. 🔒 처음엔 postal_code_
 * index에 실제로 존재하는지까지 요구했다가, 그 표가 미국 5곳+한국 3곳뿐인
 * 대표값이라(§17.3) 실제 사용자 대부분의 정상적인 우편번호를 거부하는
 * 문제가 실사용자 리포트로 드러나 형식 검증으로 낮췄다(위 POSTAL_CODE_
 * FORMAT 주석 참고). 국가 없이 우편번호만 온 경우 검증 대상 자체가 없어
 * 거부한다 — 편집 UI가 항상 둘을 한 쌍으로 보내므로 실사용 경로에선
 * 발생하지 않는다.
 */
export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<UpdateProfileResult> {
  const nickname = input.nickname?.trim();
  if (nickname !== undefined && (nickname.length === 0 || nickname.length > MAX_NICKNAME_LENGTH)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  if (nickname !== undefined && isReservedNickname(nickname)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const intro = input.intro?.trim();
  if (intro !== undefined && intro.length > MAX_INTRO_LENGTH) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  // 🔒 사용자 지시(2026-08, "프로필 공개를 비공개/follower/공개로 토글버튼으로
  // 수정해줘") — user_logs.visibility 자체는 0005부터 public/friends/private
  // 였지만 여긴 public/private만 받았다. 0029가 posts에 이미 추가한
  // 'followers'(친구와는 별개 개념, §8)를 그대로 재사용 — 'friends'는 이
  // 경로로 여전히 들어올 수 없다(토글 UI에 없다, DB엔 하위호환으로만 남음).
  if (
    input.visibility !== undefined &&
    input.visibility !== 'public' &&
    input.visibility !== 'followers' &&
    input.visibility !== 'private'
  ) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const username = input.username?.trim().toLowerCase();
  if (username !== undefined && !USERNAME_RE.test(username)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const country = input.country?.trim().toUpperCase();
  if (country !== undefined && !/^[A-Z]{2}$/.test(country)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const postalCode = input.postalCode?.trim();
  if (postalCode !== undefined && postalCode.length > 0) {
    if (country === undefined) return { ok: false, error: 'INVALID_INPUT' };
    if (!isValidPostalCodeFormat(country, postalCode)) return { ok: false, error: 'INVALID_LOCATION' };
  }
  const avatarUrl = input.avatarUrl?.trim();
  if (avatarUrl !== undefined && avatarUrl.length > 0 && (avatarUrl.length > MAX_URL_LENGTH || !URL_RE.test(avatarUrl))) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  if (username !== undefined) {
    if (!(await isUsernameAvailable(username, userId))) return { ok: false, error: 'USERNAME_TAKEN' };
  }

  let usernameRace = false;
  await withRelationCtx(pool, { userId }, async (client) => {
    if (nickname !== undefined || username !== undefined || avatarUrl !== undefined || country !== undefined || postalCode !== undefined) {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (nickname !== undefined) {
        values.push(nickname);
        sets.push(`nickname = $${values.length}`);
      }
      if (username !== undefined) {
        values.push(username);
        sets.push(`username = $${values.length}`);
      }
      if (avatarUrl !== undefined) {
        values.push(avatarUrl);
        sets.push(`avatar_url = $${values.length}`);
      }
      if (country !== undefined) {
        values.push(country);
        sets.push(`country = $${values.length}`);
      }
      if (postalCode !== undefined) {
        values.push(postalCode);
        sets.push(`postal_code = $${values.length}`);
      }
      values.push(userId);
      // 🔒 위의 SELECT 중복확인과 이 UPDATE 사이의 찰나에 다른 요청이 같은
      // 아이디를 먼저 가져갈 수 있다(TOCTOU) — users.username UNIQUE 제약이
      // 최종 방어선이라 그 위반(23505)을 여기서 잡아 같은 USERNAME_TAKEN으로
      // 정리한다(예외를 밖으로 새어나가게 두지 않는다).
      if (username !== undefined) {
        try {
          await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
        } catch (err) {
          if (isPgError(err, '23505')) {
            usernameRace = true;
            return;
          }
          throw err;
        }
      } else {
        await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      }
    }
    if (intro !== undefined || input.visibility !== undefined) {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (intro !== undefined) {
        values.push(intro);
        sets.push(`intro = $${values.length}`);
      }
      if (input.visibility !== undefined) {
        values.push(input.visibility);
        sets.push(`visibility = $${values.length}`);
      }
      values.push(userId);
      await client.query(`UPDATE user_logs SET ${sets.join(', ')} WHERE user_id = $${values.length}`, values);
    }
  });

  if (usernameRace) return { ok: false, error: 'USERNAME_TAKEN' };
  return { ok: true };
}

/** §11.7.6 1번 — 이 로그의 포스트(log_id = 이 사용자). posts RLS가 그대로 적용된다. */
export async function fetchLogPosts(viewerId: string | null, logUserId: string, limit = 20, offset = 0) {
  return fetchHomeFeedForLog(viewerId, logUserId, limit, offset);
}

/** §6.5 상태 머신 — 무관계/신청대기(양방향 구분)/친구. friendships는 RLS가 없어(불변식 12) 앱 레이어에서 본인 관련 행만 걸러 읽는다. */
export async function fetchRelationshipStatus(viewerId: string | null, otherUserId: string): Promise<RelationshipStatus> {
  if (!viewerId) return 'none';
  if (viewerId === otherUserId) return 'self';
  const r = await queryRaw<{ requester_id: string; status: string }>(
    pool,
    `SELECT requester_id, status FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [viewerId, otherUserId],
  );
  if (r.rows.length === 0) return 'none';
  const row = r.rows[0];
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === viewerId ? 'pending_sent' : 'pending_received';
}

export async function fetchFollowStatus(viewerId: string | null, otherUserId: string): Promise<boolean> {
  if (!viewerId) return false;
  const r = await withRelationCtx(pool, { userId: viewerId }, (client) =>
    client.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [viewerId, otherUserId]),
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * §11.7.1 좌 사이드바 "프로필 요약" 위치 표시("서울, 대한민국" 형태).
 * 우편번호가 있고 postal_code_index에 매치되면 도시까지, 아니면 국가명만,
 * 국가 자체가 없으면(예: 온보딩 미완료) null — 위치 줄 자체를 생략한다.
 */
export async function fetchUserLocationLabel(userId: string): Promise<string | null> {
  const r = await queryRaw<{ country: string | null; city: string | null }>(
    pool,
    `SELECT u.country, pci.city
     FROM users u
     LEFT JOIN postal_code_index pci ON pci.country_code = u.country AND pci.postal_code = u.postal_code
     WHERE u.id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row?.country) return null;
  return row.city ? `${row.city}, ${row.country}` : row.country;
}

/**
 * 🔒 사용자 지시(2026-08, "zipcode를 입력하면 국가와 zipcode로 위치정보
 * (california, san jose)를 입력창 오른쪽에 보여줘") — 저장 전 편집 폼에서
 * 실시간으로 보여주는 미리보기. `fetchUserLocationLabel()`은 이미 저장된
 * `users.country`/`postal_code`를 읽지만, 이건 아직 저장 안 된 입력값
 * (country/postalCode 파라미터)을 그대로 조회한다는 점이 다르다.
 * 🔒 `postal_code_index.state`는 미국은 실제 주(CA·NY), 한국은 구/군
 * (강남구·분당구)이 들어있다 — 있으면 "도시, state"로, 없으면
 * `fetchUserLocationLabel()`과 같은 "도시, 국가명"으로 폴백한다. 매치되는
 * 행이 없으면 null(호출부가 이걸 "아직 확인 불가/불일치"로 보여준다).
 */
export async function previewPostalLocation(country: string, postalCode: string): Promise<string | null> {
  const r = await queryRaw<{ city: string; state: string | null }>(
    pool,
    `SELECT city, state FROM postal_code_index WHERE country_code = $1 AND postal_code = $2`,
    [country, postalCode],
  );
  const row = r.rows[0];
  if (!row) return null;
  return row.state ? `${row.city}, ${row.state}` : `${row.city}, ${country}`;
}

/**
 * 🔒 사용자 지시(2026-08, "zipcode 인풋 폼 옆에 국가 선택폼을 같이 넣어줘") —
 * 편집 폼이 원본 코드값(표시용 label이 아니라)을 미리 채워야 해서 신설.
 * `fetchUserLocationLabel()`과 달리 원본 우편번호를 그대로 반환한다 — 이건
 * `fetchUserLogByUsername()`처럼 아무 뷰어에게나 노출되면 안 된다(정밀한
 * 우편번호는 도시 이름보다 훨씬 구체적인 개인정보다). 호출부(app/[category]/
 * UserLogView.tsx)가 `isSelf`일 때만 불러야 한다 — 이 함수 자체엔 그
 * 경계가 없다(users 테이블엔 RLS가 없어 앱 레이어가 유일한 방어선).
 */
export async function fetchOwnLocationFields(userId: string): Promise<{ country: string | null; postalCode: string | null }> {
  const r = await queryRaw<{ country: string | null; postal_code: string | null }>(
    pool,
    `SELECT country, postal_code FROM users WHERE id = $1`,
    [userId],
  );
  const row = r.rows[0];
  return { country: row?.country ?? null, postalCode: row?.postal_code ?? null };
}

export type FriendUser = { id: string; username: string; nickname: string; mutual: number };

/**
 * §11.7.1 "나의 로그 > Friends" — friendships는 RLS가 없어(불변식 12) 본인 관련
 * accepted 행만 앱 레이어에서 걸러 읽는다.
 * 🔒 사용자 지시(2026-08, "목업UI와 완벽하게 싱크") — artifact 친구 카드의
 * "N명의 공통 친구"를 `app_mutual_friend_count(userId, u.id)`로 채운다 — "나와
 * 이 친구가 공통으로 아는 친구 수"(친구인 것과 무관하게 항상 계산 가능한 값).
 */
export async function fetchFriends(userId: string, limit = 50): Promise<FriendUser[]> {
  const r = await queryRaw<FriendUser & { mutual: string | number }>(
    pool,
    `SELECT u.id, u.username, u.nickname, app_mutual_friend_count($1, u.id) AS mutual
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
     ORDER BY f.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => ({ ...row, mutual: Number(row.mutual) }));
}
