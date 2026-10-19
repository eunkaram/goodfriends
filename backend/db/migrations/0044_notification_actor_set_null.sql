-- 0044 — notifications.actor_id에 ON DELETE SET NULL 추가
--
-- 🔒 실전 발견(2026-08-28, comment/reaction 알림 신설 라운드) — 0010이
-- `actor_id uuid REFERENCES users(id)`를 ON DELETE 절 없이 만들어서 기본값
-- NO ACTION이 걸려 있었다. follow 알림만 있던 동안은 잘 안 드러났지만,
-- comment/reaction까지 알림을 만들기 시작하니 "댓글 한 번이라도 단 계정은
-- 탈퇴(hard delete)가 FK 위반으로 실패한다"는 0023(messages.sender_id)·
-- 0024(comments.author_id)와 정확히 같은 패턴이 notifications.actor_id에서도
-- 재현됐다.
--
-- comments/messages와 달리 CASCADE(알림 자체를 지움)가 아니라 SET NULL을
-- 쓴다 — 0010의 컬럼 주석이 이미 "actor_id ... 시스템 알림이면 NULL"이라고
-- NULL을 정상 상태로 문서화해뒀고, listNotifications()도 LEFT JOIN으로
-- actor_id NULL을 이미 처리한다. 탈퇴한 사람이 남긴 알림 자체(수신자
-- 입장에서 "누군가 댓글을 달았다")는 실제로 있었던 일이라 지울 이유가 없다.

BEGIN;

ALTER TABLE notifications DROP CONSTRAINT notifications_actor_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
