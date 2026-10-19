-- 0004 — 관계 판정 헬퍼 함수 + posts 양방향 차단 버그 수정
--
-- 🔒 발견한 버그: posts 정책의 차단 체크가 단방향이었다 —
--   NOT EXISTS (blocks WHERE blocker_id = viewer AND blocked_id = author)
-- 이건 "내가 차단한 사람의 글을 나에게 숨긴다"만 한다. 반대 방향
-- "저 사람이 나를 차단했으면 저 사람 글이 나에게 숨어야 한다"가 빠졌다.
-- §4.2는 "차단" 행을 방향 구분 없이 전부 ❌로 적었다 — 양방향이 맞다.
-- 화면은 정상으로 보인다(차단한 쪽 기준으로는 원하는 대로 동작하므로).
-- 차단당한 쪽이 여전히 상대 글을 보는 건 정확히 차단 기능이 막으려던
-- 괴롭힘 시나리오다.
--
-- 매 정책마다 이 조건을 손으로 반복하면 이런 비대칭 실수가 또 나온다.
-- 헬퍼 함수로 한 곳에 모은다 — 이후 모든 RLS 대상 테이블이 이 함수를 쓴다.

BEGIN;

CREATE OR REPLACE FUNCTION app_is_blocked_with(other_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = app_current_user_id() AND b.blocked_id = other_id)
           OR (b.blocker_id = other_id AND b.blocked_id = app_current_user_id())
    )
$$;

CREATE OR REPLACE FUNCTION app_is_friends_with(other_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = app_current_user_id() AND f.addressee_id = other_id)
            OR (f.addressee_id = app_current_user_id() AND f.requester_id = other_id))
    )
$$;

-- posts 정책을 헬퍼로 재작성 (양방향 차단 수정 포함)
DROP POLICY posts_select_arrays ON posts;
CREATE POLICY posts_select_arrays ON posts
    FOR SELECT TO community_app_arrays
    USING (
        deleted_at IS NULL
        AND NOT (author_id = ANY (app_blocked_ids()))  -- 배열 변형은 비교용으로 유지 (단방향 한계는 알려진 채로 둠 — §9.2-bis에서 이미 폐기된 경로)
        AND (
            category_id IS NOT NULL
            OR (
                app_current_user_id() IS NOT NULL
                AND (
                    visibility = 'public'
                    OR author_id = app_current_user_id()
                    OR (visibility = 'friends' AND author_id = ANY (app_friend_ids()))
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
                )
            )
        )
    );

COMMIT;
