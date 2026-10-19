-- 0031 — 프로필(user_logs) 공개범위에 "팔로워 공개" 추가
--
-- 사용자 지시(2026-08, "프로필 수정에서 프로필 공개를 비공개/follower/공개
-- 로 토글버튼으로 수정해줘") — user_logs.visibility는 지금까지
-- public/friends/private 3단계였는데(0005_userlog_album_photo.sql) app
-- 레이어(updateProfile)는 그중 public/private만 쓰게 해뒀다. 0029가 posts에
-- 이미 같은 확장을 했다 — "친구"와 "팔로우"는 이 프로젝트에서 확정된 별개
-- 개념(§8 "친구 ≠ 팔로우")이라 'friends'를 재활용하지 않고 그때 추가한
-- 4번째 값 'followers'와 판정 함수 app_is_followed_by()를 그대로 재사용한다.
--
-- app_can_view_tier()는 user_logs 외에 profile_fields(0006)·albums·photos
-- (0005)·profile_links(0027)도 같이 쓰는 공용 함수라 이 함수만 고치면 네
-- 테이블 전부 'followers' tier를 판정할 수 있게 된다 — 하지만 이번 요청은
-- "프로필 공개"(user_logs)만 다루므로 CHECK 제약은 user_logs 하나만 넓힌다
-- (나머지 세 테이블의 CHECK는 그대로 public/friends/private만 허용 —
-- 그쪽 편집 UI가 아직 없어 'followers' 값 자체가 들어갈 경로가 없다).

BEGIN;

CREATE OR REPLACE FUNCTION app_can_view_tier(owner_id uuid, tier text) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT
        app_current_user_id() IS NOT NULL
        AND NOT app_is_blocked_with(owner_id)
        AND (
            owner_id = app_current_user_id()
            OR tier = 'public'
            OR (tier = 'friends' AND app_is_friends_with(owner_id))
            OR (tier = 'followers' AND app_is_followed_by(owner_id))
        )
$$;

ALTER TABLE user_logs DROP CONSTRAINT user_logs_visibility_check;
ALTER TABLE user_logs ADD CONSTRAINT user_logs_visibility_check
    CHECK (visibility IN ('public', 'friends', 'private', 'followers'));

COMMIT;
