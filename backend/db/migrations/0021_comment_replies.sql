-- 0021 — 댓글 1-depth 답글(사용자 지시, 2026-08 — "댓글에서 1depth 댓글은
-- 쓸수 있어야해... 댓글의 댓글은 댓글을 달수 없도록"). comments는 §13
-- "다형성이라 정책 불가"로 RLS가 없는 테이블이다(0011 참고) — 이 마이그레이션은
-- 그 테이블에 자기 참조 컬럼 하나만 추가한다. 이미 부모(comments) 자체가
-- RLS 밖이라 불변식 12(자기 재귀 테이블엔 RLS를 안 건다)의 대상이 아니다 —
-- 애초에 RLS가 없어서 "자기 재귀"로 걸릴 정책 자체가 없다.
--
-- 🔒 "1-depth만 허용"은 DB CHECK로 못 건다 — 한 행의 CHECK 제약은 다른 행
-- (자기 부모의 부모)을 조회할 수 없다. src/comments.ts의 createComment()가
-- INSERT 직전에 "부모의 parent_comment_id가 NULL인지"를 앱 레이어에서
-- 재검증한다(P4와 같은 원칙 — 저장 시점에 다시 판정).

BEGIN;

ALTER TABLE comments ADD COLUMN parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX comments_parent_idx ON comments (parent_comment_id);

COMMIT;
