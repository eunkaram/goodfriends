-- 0020 — Media (§13) 북키핑용 최소 슬라이스. 댓글 이미지 업로드(사용자
-- 지시, 2026-08 — "이미지 업로드 가능하게(멀티 이미지파일 선택가능해야함)")를
-- 지원한다. 실제 콘텐츠는 이 테이블이 아니라 댓글 본문에 마커
-- (src/link-detect.ts makeImageMarker)로 URL을 직접 품는다 — posts의 붙여넣기
-- 이미지(0019 이후 라운드)와 같은 방식. 이 테이블은 FK로 참조되지 않고,
-- 업로더 식별·용량 집계(§13 "S6 스토리지 캡" 대비)만 목적인 순수 로그다.
--
-- saved_posts/follows(0014)·subscriptions(0016)와 같은 이유로 RLS를 정상적으로
-- 건다 — 다른 테이블의 정책이 이 테이블을 참조하지 않아 자기 재귀 위험이 없다.
--
-- 🔒 PRD §13 Media 원안(variant_of/variant_kind, EXIF 제거 파생본)은 이번
-- 라운드 범위 밖이다 — 실시간 파생본 생성 파이프라인이 없어 원본을 그대로
-- 저장한다. 필요해지면 이 테이블에 컬럼을 추가하면 된다.

BEGIN;

CREATE TABLE media (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key text NOT NULL,
    public_url  text NOT NULL,
    mime_type   text NOT NULL,
    bytes       integer NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media (owner_id, created_at DESC);

ALTER TABLE media OWNER TO community_schema;
GRANT SELECT, INSERT ON media TO community_app_exists;

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE media FORCE ROW LEVEL SECURITY;

-- 북키핑 전용 — 본인이 올린 것만 보고, 남이 올린 건 볼 필요가 없다(댓글 본문의
-- 마커 URL은 공개 오브젝트라 인증 없이도 브라우저가 직접 연다 — 이 테이블
-- 조회 권한과 무관).
CREATE POLICY media_select ON media
    FOR SELECT TO community_app_exists
    USING (owner_id = app_current_user_id());
CREATE POLICY media_insert ON media
    FOR INSERT TO community_app_exists
    WITH CHECK (owner_id = app_current_user_id());

COMMIT;
