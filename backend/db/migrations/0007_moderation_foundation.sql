-- 0007 — 모더레이션 기반 (§4.6, §13 Report)
--
-- Message RLS가 §4.6 "열린 신고 건에 연결된 대상에 한해 열람 허용"을 쓰려면
-- is_moderator 플래그와 Report 테이블이 먼저 있어야 한다. 0001에서 users를
-- 최소 슬라이스로 줄였을 때 빠졌던 컬럼을 여기서 추가한다.

BEGIN;

ALTER TABLE users ADD COLUMN is_moderator boolean NOT NULL DEFAULT false;

CREATE TABLE reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id uuid NOT NULL REFERENCES users(id),
    target_type text NOT NULL,
    target_id   uuid NOT NULL,
    reason      text NOT NULL,
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    handled_by  uuid REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_target_open_idx ON reports (target_type, target_id) WHERE status = 'open';

-- §4.6 감사 로그. 🔒 이 테이블에 쓰는 것은 DB가 강제하지 못한다 — SELECT 정책은
-- 부수효과(INSERT)를 낼 수 없다. 모더레이터가 아래 app_moderator_can_view()
-- 분기로 행을 봤다면, **앱이 그 즉시 여기 기록해야 한다.** 이건 앱 레이어
-- 책임이며 코드리뷰·린트로만 지킬 수 있다 — G1/G2와 달리 DB 가드가 없다는
-- 뜻이다. tests/guards에서 이 한계를 명시적으로 검증해둔다.
CREATE TABLE moderation_access_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id uuid NOT NULL REFERENCES users(id),
    target_type  text NOT NULL,
    target_id    uuid NOT NULL,
    report_id    uuid REFERENCES reports(id),
    accessed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reports OWNER TO community_schema;
ALTER TABLE moderation_access_log OWNER TO community_schema;
GRANT SELECT, INSERT ON reports TO community_app_exists;
GRANT SELECT, INSERT ON moderation_access_log TO community_app_exists;
-- reports/moderation_access_log 자체는 RLS 대상이 아니다 — 접근 제어는
-- 이 테이블을 참조하는 쪽(messages 등)의 정책이 담당한다. 모더레이터 큐
-- UI가 reports를 직접 읽을 땐 앱 레이어가 is_moderator를 확인한다.

CREATE OR REPLACE FUNCTION app_is_moderator() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT COALESCE(
        (SELECT is_moderator FROM users WHERE id = app_current_user_id()),
        false
    )
$$;

CREATE OR REPLACE FUNCTION app_moderator_can_view(t_type text, t_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT app_is_moderator() AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.target_type = t_type AND r.target_id = t_id AND r.status = 'open'
    )
$$;

COMMIT;
