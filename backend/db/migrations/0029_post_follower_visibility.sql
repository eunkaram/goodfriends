-- 0029 — 로그 전용 글에 "팔로워 공개" 노출범위 추가
--
-- 사용자 지시(2026-08, "글쓰기 팝업... Post Option을 넣어야 할것 같아.
-- 게시판에 글을 쓸건지 내 로그(프로파일)에만 글을 쓸건지 선택이 필요해,
-- 그리고 내로그에만 쓴 글일경우 읽기 권한을 전체, follower 설정을 할수
-- 있어야 할것 같아") — posts.visibility는 지금까지 public/friends/private
-- 3단계였다(0001_schema.sql). "친구"와 "팔로우"는 이 프로젝트에서 이미
-- 확정된 별개 개념(§8 "친구 ≠ 팔로우") — 사용자가 명시적으로 "follower"를
-- 요청했으므로 'friends'를 재활용하지 않고 새 4번째 값 'followers'를
-- 추가한다. 판정은 friendships 대신 이미 있는 follows 테이블(0014)을 쓴다.

BEGIN;

-- 🔒 category_id가 있는(커뮤니티) 글은 posts_community_is_public이 여전히
-- visibility='public'을 강제한다 — 'followers'는 log_id 전용 글에서만
-- 실질적으로 의미를 가진다(앱 레이어에서도 이렇게 검증한다, src/posts.ts).
ALTER TABLE posts DROP CONSTRAINT posts_visibility_check;
ALTER TABLE posts ADD CONSTRAINT posts_visibility_check
    CHECK (visibility IN ('public', 'friends', 'private', 'followers'));

-- app_is_friends_with()(0004)와 같은 패턴 — EXISTS로 follows를 직접 찌른다
-- (불변식 4, 배열 세션 주입 금지). "지금 보는 사람이 글쓴이를 팔로우하는가"
-- 여부라 방향이 하나뿐이다(app_is_friends_with처럼 양방향 OR가 필요 없다).
CREATE OR REPLACE FUNCTION app_is_followed_by(other_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = app_current_user_id() AND f.followee_id = other_id
    )
$$;

-- posts_select_arrays/exists(0004에서 마지막으로 재정의됨)에 'followers' 분기 추가.
-- 🔒 _arrays 역할은 §9.2-bis 실측 비교 이후로 앱이 실제로 안 쓴다(appPool('exists')만
-- 쓴다) — 그래도 두 정책이 갈라지면 나중에 "왜 다르지"라는 혼란을 낳으므로 짝을
-- 맞춰 같이 고친다(0004가 이미 그렇게 해왔다).
DROP POLICY posts_select_arrays ON posts;
CREATE POLICY posts_select_arrays ON posts
    FOR SELECT TO community_app_arrays
    USING (
        deleted_at IS NULL
        AND NOT (author_id = ANY (app_blocked_ids()))
        AND (
            category_id IS NOT NULL
            OR (
                app_current_user_id() IS NOT NULL
                AND (
                    visibility = 'public'
                    OR author_id = app_current_user_id()
                    OR (visibility = 'friends' AND author_id = ANY (app_friend_ids()))
                    OR (visibility = 'followers' AND app_is_followed_by(author_id))
                )
            )
        )
    );

DROP POLICY posts_select_exists ON posts;
CREATE POLICY posts_select_exists ON posts
    FOR SELECT TO community_app_exists
    USING (
        deleted_at IS NULL
        AND NOT app_is_blocked_with(author_id)
        AND (
            category_id IS NOT NULL
            OR (
                app_current_user_id() IS NOT NULL
                AND (
                    visibility = 'public'
                    OR author_id = app_current_user_id()
                    OR (visibility = 'friends' AND app_is_friends_with(author_id))
                    OR (visibility = 'followers' AND app_is_followed_by(author_id))
                )
            )
        )
    );

COMMIT;
