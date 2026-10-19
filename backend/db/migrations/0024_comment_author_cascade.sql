-- 0024 — comments.author_id에 ON DELETE CASCADE 추가
--
-- 🔒 실전 발견(2026-08, "댓글 부분도 목업 디자인으로 마이그레이션 해줘"
-- 라운드 실브라우저 검증 중) — 0011이 `author_id uuid NOT NULL
-- REFERENCES users(id)`를 ON DELETE 절 없이 만들어서 기본값 NO ACTION이
-- 걸려 있었다. 댓글을 한 번이라도 쓴 계정은 탈퇴(deleteAccount, §6.1
-- 하드 삭제)가 FK 위반으로 조용히 실패했다 — "탈퇴에 실패했어요"만 뜨고
-- 원인은 화면에 안 보인다. 0023(messages.sender_id)과 정확히 같은
-- 패턴의 재발 — posts.author_id(0001)·market_posts.author_id(0017)는
-- 처음부터 CASCADE가 있었는데 comments만 빠져 있었다. 이 프로젝트의
-- 계정 탈퇴 원칙(0013 — 소프트 삭제 안 씀, CASCADE로 전부 정리)과
-- 일치시킨다.

BEGIN;

ALTER TABLE comments DROP CONSTRAINT comments_author_id_fkey;
ALTER TABLE comments ADD CONSTRAINT comments_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
