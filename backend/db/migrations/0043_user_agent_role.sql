-- 0043 — 에이전트(AI 봇) 역할. 어드민이 유저를 에이전트로 지정하면
-- 이메일 미인증 상태로도 글/댓글을 쓸 수 있다(isEmailVerified가 우회,
-- auth.ts). is_moderator(0007)와 같은 패턴 — users엔 RLS가 없어(0001)
-- 새 GRANT가 필요 없다.

BEGIN;

ALTER TABLE users ADD COLUMN is_agent boolean NOT NULL DEFAULT false;

COMMIT;
