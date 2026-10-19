-- 0042 — 메시징: 스레드 생성 이후엔 차단이 전혀 안 먹히던 결함 수정
--
-- 🔒 실전 발견 — findOrCreateDirectThread()의 차단 체크는 "새 스레드를
-- 만들 때"만 돌았다. 이미 있는 스레드는 존재 확인 즉시 반환돼 차단 체크를
-- 아예 건너뛰었고, messages_insert/messages_select/message_threads_select/
-- message_requests_select 정책 자체도 app_is_blocked_with()를 부르지 않았다
-- (posts/profile/follows는 전부 부른다 — 불변식 11). 즉 이미 만들어진
-- 스레드에서는 차단해도 상대가 계속 메시지를 보낼 수 있었다. 지금은 차단
-- 기능의 앱단 진입점이 아직 없어(P2 화면) 실사용 경로로 터지지 않지만,
-- §4.5 "코드가 까먹어도 DB가 막는다" 원칙에 맞춰 RLS 레벨에서 막아둔다.
--
-- message_threads_select/messages_select/messages_insert/message_requests_select
-- 는 0008_messaging.sql이 유일한 정의이고 그 뒤로 손댄 적이 없다(불변식 25
-- 확인 완료) — 그 정의를 그대로 베이스로 삼는다.

BEGIN;

CREATE OR REPLACE FUNCTION app_thread_blocked(t_thread_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT EXISTS (
        SELECT 1 FROM participants p
        WHERE p.thread_id = t_thread_id
          AND p.user_id != app_current_user_id()
          AND app_is_blocked_with(p.user_id)
    )
$$;

DROP POLICY message_threads_select ON message_threads;
CREATE POLICY message_threads_select ON message_threads
    FOR SELECT TO community_app_exists
    USING ((app_is_participant(id) AND NOT app_thread_blocked(id)) OR app_moderator_can_view('thread', id));

DROP POLICY messages_select ON messages;
CREATE POLICY messages_select ON messages
    FOR SELECT TO community_app_exists
    USING ((app_is_participant(thread_id) AND NOT app_thread_blocked(thread_id)) OR app_moderator_can_view('message', id));

DROP POLICY messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT TO community_app_exists
    WITH CHECK (sender_id = app_current_user_id() AND app_is_participant(thread_id) AND NOT app_thread_blocked(thread_id));

DROP POLICY message_requests_select ON message_requests;
CREATE POLICY message_requests_select ON message_requests
    FOR SELECT TO community_app_exists
    USING (app_is_participant(thread_id) AND NOT app_thread_blocked(thread_id));

COMMIT;
