-- 0048 — 시스템 공지사항 (이슈 #10). 관리자가 작성하면 모든 유저의
-- 메시지창(`/messages`)에 노출된다. users처럼 RLS 없음(0001 전례) —
-- 쓰기는 관리자만(app 레이어 requireModerator()), 읽기는 전체 공개 성격이라
-- 사용자별 분기가 없다. is_active로 노출 토글(하드 삭제 대신 — 감사 이력 보존).

BEGIN;

CREATE TABLE announcements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title       text NOT NULL,
    body        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_by  uuid NOT NULL REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_active_idx ON announcements (is_active, created_at DESC);

ALTER TABLE announcements OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE ON announcements TO community_app_exists;

COMMIT;
