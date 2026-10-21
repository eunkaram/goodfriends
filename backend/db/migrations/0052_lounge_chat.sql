-- 0052 — 라운지 채팅 (M4, "ws 기반 라운지 채팅 — 전체방 1개, 접속/발言/최근 기록").
-- 방(room)은 1차에 하나뿐이라 room_id를 두지 않는다 — 2개째가 필요해지는
-- 시점에 마이그레이션으로 추가하는 것이 싱글테이블 시절의 '한 파일 고침'
-- 비용보다 싸다(문서의 "1차는 전체방 하나만" 원칙, PLAN 리스크표).
-- hidden_at — 스팸 대응(신고→숨김 플로우)의 부채. 지금은 앱 레이어가 안 다루지만
-- 컬럼은 미리 두면 아무것도 안 바꾸고 관리자 숨김을 붙일 수 있다.
-- 🔒 0048 전례 — 채팅은 전체 공개 성격(로그인 유저 전원 동일 접근)이라 RLS 없다.
-- 쓰기는 앱 레이어가 로그인 유저만 통과시킨다(ws 핸드셰이크 세션 검증).

BEGIN;

CREATE TABLE chat_messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
    hidden_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_recent_idx ON chat_messages (created_at DESC);

ALTER TABLE chat_messages OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE ON chat_messages TO community_app_exists;

COMMIT;
