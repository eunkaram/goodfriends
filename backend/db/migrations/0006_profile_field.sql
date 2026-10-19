-- 0006 — ProfileField (§13, §6.4 항목별 공개설정)
--
-- birth_date는 users 테이블이 유일한 진실 공급원이라 여기 없다 (§13 주석).
-- 로그인 필수 + 공개범위 3단계는 UserLog와 동일한 패턴 — app_can_view_tier 재사용.

BEGIN;

CREATE TABLE profile_fields (
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key            text NOT NULL,  -- 'location' | 'intro' | 'mobile' | 'messenger' | 'homepage' 등
    value          text NOT NULL DEFAULT '',
    messenger_type text,           -- key='messenger'일 때만 사용
    visibility     text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
    PRIMARY KEY (user_id, key)
);

ALTER TABLE profile_fields OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_fields TO community_app_exists;
ALTER TABLE profile_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_fields FORCE ROW LEVEL SECURITY;

CREATE POLICY profile_fields_select ON profile_fields
    FOR SELECT TO community_app_exists
    USING (app_can_view_tier(user_id, visibility));

CREATE POLICY profile_fields_insert ON profile_fields FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY profile_fields_update ON profile_fields FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY profile_fields_delete ON profile_fields FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

COMMIT;
