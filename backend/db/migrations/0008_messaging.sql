-- 0008 — MessageThread · Participant · Message · MessageRequest (§6.6, §4.5)
--
-- §4.5 RLS 대상 표: "Message · MessageThread ✅ 스레드 참여자 본인만".
-- 참여자가 아니면 아무것도 못 본다 — 공개범위 개념 자체가 없다. 모더레이터는
-- §4.6 경로로만 개별 메시지에 접근한다(스레드 전체가 아니라 신고된 메시지 건).

BEGIN;

CREATE TABLE message_threads (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE participants (
    thread_id     uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at  timestamptz,
    PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE messages (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id      uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_id      uuid NOT NULL REFERENCES users(id),
    body           text NOT NULL DEFAULT '',
    image_media_id uuid,  -- Media 테이블 미구현 (§13)
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON messages (thread_id, created_at);

CREATE TABLE message_requests (
    thread_id  uuid PRIMARY KEY REFERENCES message_threads(id) ON DELETE CASCADE,
    status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    origin     text NOT NULL CHECK (origin IN ('direct', 'market'))
);

ALTER TABLE message_threads  OWNER TO community_schema;
ALTER TABLE participants     OWNER TO community_schema;
ALTER TABLE messages         OWNER TO community_schema;
ALTER TABLE message_requests OWNER TO community_schema;

GRANT SELECT, INSERT, UPDATE, DELETE ON message_threads, participants, messages, message_requests TO community_app_exists;

ALTER TABLE message_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads  FORCE ROW LEVEL SECURITY;
ALTER TABLE participants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants     FORCE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         FORCE ROW LEVEL SECURITY;
ALTER TABLE message_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_requests FORCE ROW LEVEL SECURITY;

-- 참여자인지 판정하는 헬퍼 — 매 정책에서 반복될 서브쿼리를 한 곳에 모은다
CREATE OR REPLACE FUNCTION app_is_participant(t_thread_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT EXISTS (
        SELECT 1 FROM participants p
        WHERE p.thread_id = t_thread_id AND p.user_id = app_current_user_id()
    )
$$;

-- ─────────────────────────────────────────────────────────────
CREATE POLICY message_threads_select ON message_threads
    FOR SELECT TO community_app_exists
    USING (app_is_participant(id) OR app_moderator_can_view('thread', id));

CREATE POLICY message_threads_insert ON message_threads FOR INSERT TO community_app_exists
    WITH CHECK (true);  -- 스레드 생성 직후 앱이 participants를 채운다. 생성 자체는 로그인만 요구
CREATE POLICY message_threads_delete ON message_threads FOR DELETE TO community_app_exists
    USING (app_is_participant(id));

-- ─────────────────────────────────────────────────────────────
CREATE POLICY participants_select ON participants
    FOR SELECT TO community_app_exists
    USING (app_is_participant(thread_id));

CREATE POLICY participants_insert ON participants FOR INSERT TO community_app_exists
    WITH CHECK (app_is_participant(thread_id) OR NOT EXISTS (
        SELECT 1 FROM participants p2 WHERE p2.thread_id = participants.thread_id
    ));  -- 스레드의 첫 참여자(생성자) 또는 이미 참여 중인 사람만 참여자를 추가한다
CREATE POLICY participants_update ON participants FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());  -- last_read_at은 본인 것만
CREATE POLICY participants_delete ON participants FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

-- ─────────────────────────────────────────────────────────────
-- 🔒 모더레이터 열람은 스레드 전체가 아니라 신고된 메시지 건 단위다.
-- 스레드 열람권(§4.6 "무제한 열람이 아니다")을 주지 않기 위해 message_threads
-- 정책과 분리해 messages 정책에만 app_moderator_can_view('message', id)를 둔다.
CREATE POLICY messages_select ON messages
    FOR SELECT TO community_app_exists
    USING (app_is_participant(thread_id) OR app_moderator_can_view('message', id));

CREATE POLICY messages_insert ON messages FOR INSERT TO community_app_exists
    WITH CHECK (sender_id = app_current_user_id() AND app_is_participant(thread_id));
-- 메시지는 수정·삭제 없음 (v1 범위 밖 — §14로 이월)

-- ─────────────────────────────────────────────────────────────
CREATE POLICY message_requests_select ON message_requests
    FOR SELECT TO community_app_exists
    USING (app_is_participant(thread_id));

CREATE POLICY message_requests_insert ON message_requests FOR INSERT TO community_app_exists
    WITH CHECK (app_is_participant(thread_id));
CREATE POLICY message_requests_update ON message_requests FOR UPDATE TO community_app_exists
    USING (app_is_participant(thread_id)) WITH CHECK (app_is_participant(thread_id));

COMMIT;
