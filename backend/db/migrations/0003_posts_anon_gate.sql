-- 0003 — posts: 로그 전용 글은 비로그인에게 숨긴다 (§4.3 정정)
--
-- §4.3 표: "로그 포스트 (유효 공유 토큰 동반) ✅" / "로그 홈 · 앨범 · 프로필 · 친구 목록 ❌"
-- 커뮤니티 카테고리 피드·포스트는 비로그인도 읽는다(공개). 로그 전용 글(category_id
-- 없음)은 `전체공개`여도 로그인이 없으면 막혀야 한다 — 공유 토큰 경로만 예외이며,
-- 그건 HMAC 서명 검증이라 RLS가 판단할 수 있는 사실이 아니다(§4.4). 그 경로는
-- 앱 레이어가 토큰을 먼저 검증한 뒤 해당 postId 하나로 한정된 별도 조회를 쓴다
-- (§4.5 "계층 1이 UX 분기를 담당"과 같은 원리).
--
-- 0002 커밋 당시 이 구분이 빠져 있었다. category_id 유무로 커뮤니티/로그를
-- 가르는 CHECK 제약(§5.2)은 있었지만, RLS 정책에는 반영되지 않았다 — 즉
-- **비로그인이 개인 로그의 `전체공개` 글을 그대로 읽을 수 있는 상태**였다.
-- 실측 없이 문서를 재검토하다 발견. G1/G2 테스트는 항상 로그인 사용자로만
-- 검증했으므로 이 결함을 못 잡았다.

BEGIN;

DROP POLICY posts_select_arrays ON posts;
CREATE POLICY posts_select_arrays ON posts
    FOR SELECT TO community_app_arrays
    USING (
        deleted_at IS NULL
        AND NOT (author_id = ANY (app_blocked_ids()))
        AND (
            category_id IS NOT NULL  -- 커뮤니티 글(크로스포스팅 포함) — §5.2로 전체공개 고정, 비로그인도 읽는다
            OR (
                app_current_user_id() IS NOT NULL  -- 로그 전용 글은 로그인 필수 (§4.3)
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
        AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE b.blocker_id = app_current_user_id() AND b.blocked_id = posts.author_id
        )
        AND (
            category_id IS NOT NULL
            OR (
                app_current_user_id() IS NOT NULL
                AND (
                    visibility = 'public'
                    OR author_id = app_current_user_id()
                    OR (visibility = 'friends' AND EXISTS (
                            SELECT 1 FROM friendships f
                            WHERE f.status = 'accepted'
                              AND ((f.requester_id = app_current_user_id() AND f.addressee_id = posts.author_id)
                                OR (f.addressee_id = app_current_user_id() AND f.requester_id = posts.author_id))
                        ))
                )
            )
        )
    );

COMMIT;
