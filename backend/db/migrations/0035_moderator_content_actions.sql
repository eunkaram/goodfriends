-- 0035 — 모더레이터의 글/댓글 조치 (§4.6 이어서, "글/댓글 관리는 어디서 해?"
-- 사용자 발견 2026-08-18 — /admin/reports가 지금까지 읽기 전용이었다)
--
-- 0007이 만든 app_moderator_can_view()는 지금까지 messages/message_threads
-- (0008)에만 연결돼 있었다 — posts 정책엔 안 걸려 있어서, 신고된 글이
-- private/friends/followers 공개범위거나 이미 소프트삭제 상태면 모더레이터도
-- 못 봤다. /admin/reports 미리보기가 동작하려면 이 확장이 필요하다.
--
-- 🔒 실수로 한 번 깰 뻔한 것 — posts_select_arrays/exists는 0002 이후
-- 0003(로그 전용 글 비로그인 차단)·0004(양방향 차단 헬퍼)·0029(followers
-- 공개범위)에서 세 번 더 재정의됐다. 이 파일은 그 마지막(0029) 버전 전체를
-- 그대로 베이스로 삼고 `OR app_moderator_can_view(...)` 한 줄만 얹는다 —
-- 0002 시절 정의로 되돌아가면 로그 전용 글 비로그인 차단(0003)·팔로워
-- 공개범위(0029)가 조용히 사라진다(테스트가 이 회귀를 잡았다).

BEGIN;

-- 0007은 reports에 SELECT/INSERT를 community_app_exists에만 GRANT했다(community_app_arrays는
-- 아예 빠져 있었다 — 그땐 reports를 직접 읽는 코드가 exists 변형뿐이었다).
-- app_moderator_can_view()가 이제 posts_select_arrays 정책 안에서도 reports를
-- 읽으므로(호출자 권한으로 실행 — SECURITY DEFINER 아님) arrays 쪽에도 SELECT가
-- 있어야 한다. UPDATE는 resolveReport()(community_app_exists만 씀)가 필요로 한다.
GRANT SELECT ON reports TO community_app_arrays;
GRANT UPDATE ON reports TO community_app_exists;

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
    );

-- 🔒 모더레이터의 글 삭제는 posts.deleted_at을 쓰는 소프트삭제다 — 사용자
-- 본인의 deletePost()(posts.ts)는 하드 삭제지만, 그건 §10.2 "본인 글이
-- 아니거나 이미 없음, 구분 안 함"이 이유였고 여긴 다르다: 신고 대응 삭제는
-- 이의제기·감사 대비로 내용을 남겨야 한다.
--
-- 🔒 실측으로 발견 — 처음엔 이 UPDATE 정책을 `app_is_moderator()`(신고
-- 무관, ban/unban과 같은 원칙)로 만들었다가 "new row violates row-level
-- security policy"로 막혔다. UPDATE의 WITH CHECK는 명시한 정책뿐 아니라
-- **결과 행이 SELECT 정책도 통과해야** 확정된다(Postgres 문서화된 동작,
-- FORCE ROW LEVEL SECURITY 여부와 무관) — deleted_at을 막 채운 새 행은
-- 위 SELECT 정책의 기본 절(deleted_at IS NULL)이 이미 깨져 있어, 오직
-- `app_moderator_can_view()`(열린 신고 필요)만 새 행을 계속 보이게 할 수
-- 있다. 그래서 이 UPDATE 정책도 `app_is_moderator()`가 아니라
-- `app_moderator_can_view('post', id)`를 써야 한다 — 결과적으로 "삭제는
-- 열린 신고가 있는 글에만" 이라는, 실은 바람직한 제약이 공짜로 걸린다.
-- (앱 레이어: 신고를 먼저 resolve하면 그 후엔 같은 글을 이 정책으로 못
-- 지운다 — /admin/reports UI가 신고가 open인 동안만 삭제 버튼을 보여줘서
-- 이 순서를 자연스럽게 유도한다.)
DROP POLICY IF EXISTS posts_moderator_delete_arrays ON posts;
CREATE POLICY posts_moderator_delete_arrays ON posts FOR UPDATE TO community_app_arrays
    USING (app_moderator_can_view('post', id)) WITH CHECK (app_moderator_can_view('post', id));
DROP POLICY IF EXISTS posts_moderator_delete_exists ON posts;
CREATE POLICY posts_moderator_delete_exists ON posts FOR UPDATE TO community_app_exists
    USING (app_moderator_can_view('post', id)) WITH CHECK (app_moderator_can_view('post', id));

COMMIT;
