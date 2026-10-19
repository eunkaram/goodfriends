-- 0037 — 감사로그에 "어떤 게시물을 어떻게 처리했는지" 정보 추가 (사용자 지시,
-- 2026-08-19 — "감사로그는 어떤 게시물을 어떻게 처리 했는지 정보가 나와줘야
-- 할것 같고, report도 글/댓글의 링크가 필요해. 새창으로 열수 있게")
--
-- post_delete(소프트삭제)·report_resolve(reports/posts/comments 전부 안 지워짐)는
-- 조회 시점에 라이브 조인으로 충분하다 — 행이 그대로 남아있다. comment_delete만
-- 예외다: 댓글은 하드삭제라(§13, deleted_at 자체가 없음) 지운 뒤엔 내용을 복원할
-- 방법이 없다 — 지우기 "직전"에 스냅샷을 남겨야 한다.

BEGIN;

ALTER TABLE moderation_access_log ADD COLUMN detail text;
ALTER TABLE moderation_access_log ADD COLUMN target_post_id uuid;

COMMIT;
