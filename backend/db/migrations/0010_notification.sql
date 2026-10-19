-- 0010 — Notification · NotificationSetting (§6.7, §4.5 "수신자 본인만")

BEGIN;

CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 수신자
    actor_id    uuid REFERENCES users(id),                             -- 유발한 사람 (시스템 알림이면 NULL)
    type        text NOT NULL,  -- 'comment' | 'reaction' | 'friend_request' | 'follow' 등
    target_type text NOT NULL,
    target_id   uuid NOT NULL,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_settings (
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          text NOT NULL,
    email_enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (user_id, type)
);

ALTER TABLE notifications        OWNER TO community_schema;
ALTER TABLE notification_settings OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications, notification_settings TO community_app_exists;

ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications
    FOR SELECT TO community_app_exists
    USING (user_id = app_current_user_id());

CREATE POLICY notifications_insert ON notifications FOR INSERT TO community_app_exists
    WITH CHECK (true);  -- 시스템/다른 사용자의 행동이 발신하므로 수신자 본인 제약을 걸지 않는다
CREATE POLICY notifications_update ON notifications FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());  -- read_at 갱신
CREATE POLICY notifications_delete ON notifications FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

CREATE POLICY notification_settings_select ON notification_settings
    FOR SELECT TO community_app_exists
    USING (user_id = app_current_user_id());
CREATE POLICY notification_settings_insert ON notification_settings FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY notification_settings_update ON notification_settings FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY notification_settings_delete ON notification_settings FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

COMMIT;
