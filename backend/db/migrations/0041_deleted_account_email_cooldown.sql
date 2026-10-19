-- 0041 — 탈퇴 후 7일 재가입 제한
--
-- 0013의 주석("나중에 유예기간이 필요해지면 그건 새 요구사항")이 예견한
-- 그 요구사항. users는 여전히 하드 삭제(0013)라 탈퇴한 이메일 자체가
-- auth_credentials에서 사라진다 — 재가입을 막으려면 이메일만 따로
-- 남겨두는 별도 테이블이 필요하다. deleted_at은 UPSERT로 매번 갱신해
-- "탈퇴 → 재가입 실패 → 다시 탈퇴" 같은 재진입에도 최신 탈퇴 시점 기준
-- 7일이 적용되게 한다.

BEGIN;

CREATE TABLE deleted_account_emails (
  email text PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

-- UPDATE도 필요하다 — deleteAccount()가 INSERT ... ON CONFLICT DO UPDATE로 upsert한다.
GRANT SELECT, INSERT, UPDATE ON deleted_account_emails TO community_app_auth;

COMMIT;
