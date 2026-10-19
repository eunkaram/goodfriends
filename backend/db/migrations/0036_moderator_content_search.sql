-- 0036 — 모더레이터의 전체 공개 글/댓글 검색+삭제 (사용자 지시, 2026-08-18 —
-- "관리자페이지에서 글/댓글관리 하는거 아니야?... 유저 관리처럼 신고 여부와
-- 무관하게 검색해서 삭제할 수 있게" — 0035는 신고 큐에 딸린 글/댓글만
-- 다뤘다, 신고 없이 임의의 공개 글을 찾아 지우는 기능은 이번에 추가한다).
--
-- 범위는 사용자가 명시적으로 좁혔다: **전체공개 글만**(커뮤니티 + 전체공개
-- 로그) — 비공개/친구공개/팔로워공개 로그는 여기서 안 보인다, 그건 여전히
-- 신고(app_moderator_can_view, 0035)를 통해서만 접근한다. §4.6 "모더레이터
-- 열람은 신고 건 단위" 원칙을 지키면서, 이미 전체공개인 콘텐츠에 대해서만
-- "신고 없이도" 예외를 둔다 — 사생활 침해 리스크가 없는 범위다.

BEGIN;

DROP POLICY posts_select_arrays ON posts;
CREATE POLICY posts_select_arrays ON posts
    FOR SELECT TO community_app_arrays
    USING (
        (
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
        )
        OR app_moderator_can_view('post', id)
        OR (app_is_moderator() AND visibility = 'public')
    );

DROP POLICY posts_select_exists ON posts;
CREATE POLICY posts_select_exists ON posts
    FOR SELECT TO community_app_exists
    USING (
        (
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
        )
        OR app_moderator_can_view('post', id)
        OR (app_is_moderator() AND visibility = 'public')
    );

-- 🔒 불변식 24(이 세션에서 실측으로 발견) — UPDATE의 WITH CHECK는 결과 행이
-- SELECT 정책도 통과해야 확정된다. 소프트삭제(deleted_at 채움) 직후엔 위
-- SELECT 정책의 기본 절이 깨지므로, `app_moderator_can_view()`(신고 필요)
-- 나 지금 추가하는 `visibility='public'` 카브아웃 둘 중 하나가 새 행에도
-- 계속 참이어야 한다 — visibility 컬럼 자체는 삭제로 안 바뀌니 그대로 유지된다.
DROP POLICY IF EXISTS posts_moderator_delete_arrays ON posts;
CREATE POLICY posts_moderator_delete_arrays ON posts FOR UPDATE TO community_app_arrays
    USING (app_moderator_can_view('post', id) OR (app_is_moderator() AND visibility = 'public'))
    WITH CHECK (app_moderator_can_view('post', id) OR (app_is_moderator() AND visibility = 'public'));
DROP POLICY IF EXISTS posts_moderator_delete_exists ON posts;
CREATE POLICY posts_moderator_delete_exists ON posts FOR UPDATE TO community_app_exists
    USING (app_moderator_can_view('post', id) OR (app_is_moderator() AND visibility = 'public'))
    WITH CHECK (app_moderator_can_view('post', id) OR (app_is_moderator() AND visibility = 'public'));

-- §6.8 패턴 그대로(0001의 posts_title_bigm_idx/posts_body_bigm_idx와 동형) —
-- comments.body엔 이 인덱스가 없었다(0011은 target_type/target_id 인덱스만 만듦).
-- comments는 RLS가 없어(§13) 이 검색 자체는 새 정책이 필요 없다 — posts를
-- 조인해 visibility='public'으로 스코프를 좁히는 건 앱 쿼리(src/comments.ts) 몫.
CREATE INDEX comments_body_bigm_idx ON comments USING gin (lower(body) gin_bigm_ops);

COMMIT;
