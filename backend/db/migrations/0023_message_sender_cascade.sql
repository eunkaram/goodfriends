-- 0023 — messages.sender_id에 ON DELETE CASCADE 추가
--
-- 🔒 실전 발견(2026-08, /messages 라운드 실브라우저 검증 중) — 0008이
-- `sender_id uuid NOT NULL REFERENCES users(id)`를 ON DELETE 절 없이
-- 만들어서 기본값 NO ACTION이 걸려 있었다. 메시지를 한 통이라도 보낸
-- 계정은 탈퇴(deleteAccount, §6.1 하드 삭제)가 FK 위반으로 조용히
-- 실패했다 — "탈퇴에 실패했어요"만 뜨고 원인은 화면에 안 보인다.
-- messages_thread_id_fkey는 이미 CASCADE라 스레드 삭제 시엔 문제가 없었고,
-- sender_id 쪽만 빠져 있었다. 이 프로젝트의 계정 탈퇴 원칙(0013 —
-- 소프트 삭제 안 씀, CASCADE로 전부 정리)과 일치시킨다.

BEGIN;

ALTER TABLE messages DROP CONSTRAINT messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
