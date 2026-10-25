-- 0056 — 라운지 채팅 답장(reply). 사용자 지시(2026-10, "글에 댓글 달기도
-- 가능하나? 댓글 달기하면 내 글에 원글이 일부 포함되어야 하고 원글을
-- 클릭하면 원글위치로 옮겨져서 원글이 보여지게") — 댓글이 아니라 Slack/
-- Discord류 "답장"(원문 일부 인용 + 클릭 시 원문으로 스크롤)에 더 가깝다.
-- 별도 댓글 테이블 대신 chat_messages 자기 자신을 가리키는 자기참조 FK
-- 하나로 충분하다(0052 전례 — room_id 없이 "1차는 최소"와 같은 태도).
--
-- 원본이 사라지면(현재는 하드 삭제 경로가 없지만 대비) 답장 자체는 남고
-- 인용 대상만 잃는다 — ON DELETE SET NULL. 부분 인덱스는 reply_to_id가
-- 대부분 NULL(일반 메시지)일 걸 감안해 실제 답장만 가볍게 찾는다.

BEGIN;

ALTER TABLE chat_messages
    ADD COLUMN reply_to_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL;

CREATE INDEX chat_messages_reply_to_idx ON chat_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

COMMIT;
