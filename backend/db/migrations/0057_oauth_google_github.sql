-- 0057 — oauth_identities.provider CHECK을 google/github로 교체
--
-- 0012_auth.sql이 만든 CHECK은 ('google', 'kakao')였다 — 이 프로젝트는
-- Reafy의 카카오/X 소셜 로그인은 가져오지 않고 Google/GitHub만 쓴다
-- (2026-10-26 사용자 지시). kakao는 한 번도 구현된 적이 없으니 그냥 빼고
-- github를 더한다.

BEGIN;

ALTER TABLE oauth_identities DROP CONSTRAINT oauth_identities_provider_check;
ALTER TABLE oauth_identities ADD CONSTRAINT oauth_identities_provider_check
    CHECK (provider IN ('google', 'github'));

COMMIT;
