-- 0025 — 프로필 화면 목업 완전 동기화 (사용자 지시, 2026-08 — "profile페이지를
-- 목업페이지의 profile페이지를 분석하고 UI를 똑같이 구성해줘. 목업UI와
-- 완벽하게 싱크되어야해")
--
-- artifact showProfile/showOtherProfile/editOpen 실측 결과 이 앱에 없던 필드
-- 4개(링크·인스타그램·트위터·자유텍스트 위치)와, RLS 구조상 앱 레이어의
-- 평범한 쿼리로는 정확히 못 세는 집계 하나(팔로워 수)가 필요했다.

BEGIN;

-- link_url/instagram_url/twitter_url/location은 intro와 같은 자리(user_logs)에
-- 둔다 — 0006의 profile_fields(EAV 키-값 테이블)가 이미 있지만 실제로 쓰인 적이
-- 없고, intro 자체도 그 테이블을 안 쓰고 user_logs에 직접 컬럼으로 들어가 있어
-- 기존 패턴과 일관되게 여기 컬럼으로 추가한다.
ALTER TABLE user_logs ADD COLUMN link_url text NOT NULL DEFAULT '';
ALTER TABLE user_logs ADD COLUMN instagram_url text NOT NULL DEFAULT '';
ALTER TABLE user_logs ADD COLUMN twitter_url text NOT NULL DEFAULT '';
-- 🔒 가입 시 국가+우편번호에서 자동 계산되는 기존 위치 표시(fetchUserLocationLabel)
-- 와는 별개의 자유 텍스트 오버라이드다 — 비어있으면 앱 레이어가 그 자동 계산값으로
-- 폴백한다. 목업은 위치를 자유 텍스트로 다루고(가입 국가/우편번호 개념 자체가 없다)
-- 이 앱은 신규 가입자에게 필요한 자동 계산 폴백을 잃지 않으면서 편집 가능하게 하려면
-- 이 방식이 가장 안전했다.
ALTER TABLE user_logs ADD COLUMN location text NOT NULL DEFAULT '';

-- 🔒 팔로워 수 — follows SELECT RLS(0014)는 "follower_id = 본인 OR followee_id =
-- 본인"이라 남의 프로필의 진짜 총 팔로워 수를 절대 셀 수 없다(자기 자신과의
-- 관계 행 1개만 보인다, 이전 라운드에서 실측 확인해 통계 자체를 뺐던 이유).
-- 개별 팔로워가 누구인지는 여전히 절대 안 내보낸다 — 오직 개수 하나만 반환하는
-- 좁은 SECURITY DEFINER 함수로 RLS를 우회한다(이 프로젝트 최초의 SECURITY
-- DEFINER 함수 — app_is_blocked_with 등 기존 헬퍼들은 friendships/blocks가
-- 애초에 RLS가 없는 테이블이라 SECURITY DEFINER가 필요 없었다). search_path를
-- 고정해 search_path 하이재킹을 막는다(SECURITY DEFINER 함수의 표준 방어).
--
-- 🔒 실전 발견 — 처음엔 이 함수 OWNER를 community_schema로 뒀다가 실측(테스트)에서
-- 카운트가 항상 0으로 나오는 버그를 잡았다. community_schema는 NOBYPASSRLS이고,
-- follows는 FORCE ROW LEVEL SECURITY가 걸려 있다 — FORCE는 정확히 "테이블
-- 소유자에게도 RLS를 강제한다"는 뜻이라, SECURITY DEFINER로 community_schema
-- "행세"를 해도 follows_select 정책(본인 관련 행만)이 그대로 걸려 아무것도
-- 안 보였다. SECURITY DEFINER는 GRANT 권한 우회일 뿐 RLS 우회가 아니다 —
-- RLS까지 진짜로 우회하려면 실행 주체가 BYPASSRLS 속성을 가져야 한다.
-- 그래서 이 함수 하나만을 위한 전용 NOLOGIN 역할을 새로 만든다 — community_schema
-- 자체에 BYPASSRLS를 주면 그 역할이 소유한 모든 테이블에서 RLS가 뚫려버려서
-- (G2 소유자 우회 게이트가 지키는 바로 그 경계) 절대 안 된다. 이 역할은
-- 테이블을 하나도 소유하지 않고, follows에 대한 SELECT 권한 하나만 받는다 —
-- BYPASSRLS의 노출 범위를 이 함수 하나로 최대한 좁힌 것.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reafy_rls_bypass') THEN
        CREATE ROLE reafy_rls_bypass NOLOGIN NOSUPERUSER BYPASSRLS;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO reafy_rls_bypass;
GRANT SELECT ON follows TO reafy_rls_bypass;

CREATE FUNCTION app_follower_count(target_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*) FROM follows WHERE followee_id = target_id
$$;
ALTER FUNCTION app_follower_count(uuid) OWNER TO reafy_rls_bypass;
GRANT EXECUTE ON FUNCTION app_follower_count(uuid) TO community_app_exists;

-- 좋아요 총합은 posts JOIN reactions로 셀 수 있다 — posts는 RLS가 있어 "이
-- 뷰어가 볼 수 있는 글의 좋아요"만 세어진다(postCount와 같은 철학, §4.3과
-- 일관). reactions 자체는 RLS가 없는 테이블이라(다형성, §13) SECURITY DEFINER가
-- 필요 없다 — 일반 STABLE 함수로 충분하다.
CREATE FUNCTION app_post_like_count(owner_id uuid) RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT count(*) FROM reactions r
    JOIN posts p ON p.id = r.target_id
    WHERE r.target_type = 'post' AND p.author_id = owner_id
$$;

-- 친구 카드의 "N명의 공통 친구" — friendships는 RLS가 없어(불변식 12) 일반
-- STABLE 함수로 충분하다. a·b 두 사람의 accepted 친구 집합의 교집합 크기.
CREATE FUNCTION app_mutual_friend_count(a uuid, b uuid) RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT count(*)::integer FROM (
        SELECT CASE WHEN requester_id = a THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships WHERE status = 'accepted' AND (requester_id = a OR addressee_id = a)
    ) fa
    JOIN (
        SELECT CASE WHEN requester_id = b THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships WHERE status = 'accepted' AND (requester_id = b OR addressee_id = b)
    ) fb ON fa.friend_id = fb.friend_id
$$;

COMMIT;
