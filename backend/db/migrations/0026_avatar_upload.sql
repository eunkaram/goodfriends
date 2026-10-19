-- 0026 — 프로필 사진 업로드(사용자 지시, 2026-08 — "프로필 편집 팝업에서
-- 사진변경 버튼은 제거, 대신 유저 아이콘... 클릭시 이미지 업로드 기능넣어줘").
-- 댓글 이미지와 같은 오브젝트 스토리지(src/media.ts, POST /api/media/upload)를
-- 그대로 재사용한다 — 새 업로드 인프라가 필요 없었다.

BEGIN;

ALTER TABLE users ADD COLUMN avatar_url text NOT NULL DEFAULT '';

COMMIT;
