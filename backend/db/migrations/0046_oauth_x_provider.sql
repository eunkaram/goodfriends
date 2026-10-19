-- 0046 — oauth_identities.provider CHECK에 'x' 추가
--
-- 사용자 지시(2026-08-31, "X로 하자") — src/oauth.ts의 Provider 타입은
-- 'google' | 'kakao' | 'x'로 이미 확장했는데(0012_auth.sql 이후), 이 테이블의
-- CHECK 제약조건은 그때 같이 안 고쳤다 — 실전에서 X 로그인 콜백이
-- findOrCreateOAuthUser의 INSERT INTO oauth_identities에서
-- oauth_identities_provider_check 위반(23514)으로 그대로 터졌다.

BEGIN;

ALTER TABLE oauth_identities DROP CONSTRAINT oauth_identities_provider_check;
ALTER TABLE oauth_identities ADD CONSTRAINT oauth_identities_provider_check
    CHECK (provider IN ('google', 'kakao', 'x'));

COMMIT;
