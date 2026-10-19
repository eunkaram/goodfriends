-- 0045 — 모바일 푸시 토큰 등록. media(0020)와 같은 이유로 RLS를 정상적으로
-- 건다(자기참조 테이블 아님, 다른 테이블 정책이 이 테이블을 참조하지 않아
-- 재귀 위험 없음).
--
-- UNIQUE는 (user_id, platform)이다 — token 전역 UNIQUE로 잡고 ON CONFLICT(token)
-- DO UPDATE SET user_id=...로 "기기가 다른 유저로 재로그인"을 처리하려 했으나,
-- 그 경로는 UPDATE RLS 정책의 USING(user_id = app_current_user_id())이 기존
-- 행의 소유자(이전 유저)와 세션 유저가 달라 막힌다 — per-user-per-platform
-- UNIQUE로 이 문제를 아예 피한다. 한 유저가 새 기기에 로그인하면 같은
-- (user_id, platform) 행이 그냥 갱신된다(디바이스 여러 대 동시 푸시는 이번
-- 라운드 범위 밖 — 필요해지면 UNIQUE를 (user_id, platform, token)으로 완화).

BEGIN;

CREATE TABLE push_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   text NOT NULL CHECK (platform IN ('ios', 'android')),
    token      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, platform)
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

ALTER TABLE push_tokens OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO community_app_exists;

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY push_tokens_select ON push_tokens
    FOR SELECT TO community_app_exists
    USING (user_id = app_current_user_id());
CREATE POLICY push_tokens_insert ON push_tokens
    FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY push_tokens_update ON push_tokens
    FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY push_tokens_delete ON push_tokens
    FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

COMMIT;
