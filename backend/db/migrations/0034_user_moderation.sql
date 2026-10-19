-- 0034 — 유저 밴/정지 (§4.6 모더레이션의 "조치" 절반. 0007이 "보기"
-- 절반(reports/moderation_access_log/is_moderator)만 만들어뒀었다 —
-- /office-hours+/plan-ceo-review+/plan-eng-review 3라운드 리뷰에서 확인).
--
-- users 테이블 자체엔 RLS가 없다(0001) — community_app_arrays/exists/auth
-- 전부 이미 SELECT/UPDATE 권한이 있어 새 GRANT가 필요 없다.

BEGIN;

ALTER TABLE users ADD COLUMN is_banned boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN banned_at timestamptz;
ALTER TABLE users ADD COLUMN banned_by uuid REFERENCES users(id);
ALTER TABLE users ADD COLUMN banned_reason text;
ALTER TABLE users ADD COLUMN unbanned_at timestamptz;
ALTER TABLE users ADD COLUMN unbanned_by uuid REFERENCES users(id);

-- requireModerator() 게이트가 매 요청마다 확인한다 — 로그인 세션 하나당
-- 여러 요청이 몰릴 수 있어 인덱스가 필요하다.
CREATE INDEX users_moderator_active_idx ON users (id) WHERE is_moderator AND NOT is_banned;

COMMIT;
