-- 0012 — 인증 (§6.1)
--
-- 가입 필수: 이름(First/Last)·이메일·생년월일·거주 국가. 선택: 우편번호.
-- 소셜 로그인: Google·Kakao·이메일 직접입력 (P3 결정).
--
-- 🔒 email/password_hash를 users에 바로 붙이지 않는다. users는 posts 등 일반
-- 콘텐츠 역할(community_app_arrays/community_app_exists)에 이미 광범위하게 GRANT돼
-- 있어서(작성자 조인용) — 여기에 자격증명을 두면 콘텐츠 쿼리 경로에서 임의
-- 사용자의 비밀번호 해시를 읽을 수 있는 길이 열린다. auth_credentials를
-- 분리하고, 그 테이블은 오직 신설 역할 community_app_auth에만 준다.
--
-- birthdate/country/postal_code는 users에 그대로 둔다 — 이건 §6.4 항목별
-- 공개설정(profile_fields)이 이미 다루는 "프라이버시 선호"이지, 새는 순간
-- 사고인 "자격증명"이 아니다. 나머지 스키마도 이 구분을 따른다.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 인증 전용 역할 — 비소유, 콘텐츠 역할과 완전히 분리
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_app_auth') THEN
        CREATE ROLE community_app_auth LOGIN PASSWORD 'devpass' NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO community_app_auth;

-- ─────────────────────────────────────────────────────────────
-- users 확장 — §6.1 가입 필수/선택 항목
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN first_name  text;
ALTER TABLE users ADD COLUMN last_name   text;
ALTER TABLE users ADD COLUMN birthdate   date;
ALTER TABLE users ADD COLUMN country     text;       -- "거주 국가" — 국적 아님 (§6.1)
ALTER TABLE users ADD COLUMN postal_code text;        -- 선택. 마켓 진입 시 유도

-- ─────────────────────────────────────────────────────────────
-- 자격증명 — community_app_auth만 접근
-- ─────────────────────────────────────────────────────────────
CREATE TABLE auth_credentials (
    user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email              text NOT NULL UNIQUE,
    -- 소셜 전용 계정은 비밀번호가 없다
    password_hash      text,
    email_verified_at  timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 소셜 로그인 연결 — Google · Kakao
-- ─────────────────────────────────────────────────────────────
CREATE TABLE oauth_identities (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          text NOT NULL CHECK (provider IN ('google', 'kakao')),
    provider_user_id  text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

-- ─────────────────────────────────────────────────────────────
-- 이메일 인증 · 비밀번호 재설정 토큰 — §6.1 "재발송 UI 필수", "찾기(임시 발급)"
-- 🔒 토큰 자체가 아니라 해시를 저장한다 — DB 유출 시에도 토큰을 재사용할 수 없게
-- ─────────────────────────────────────────────────────────────
CREATE TABLE email_verification_tokens (
    token_hash   text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz
);

CREATE TABLE password_reset_tokens (
    token_hash   text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz
);

ALTER TABLE auth_credentials           OWNER TO community_schema;
ALTER TABLE oauth_identities           OWNER TO community_schema;
ALTER TABLE email_verification_tokens  OWNER TO community_schema;
ALTER TABLE password_reset_tokens      OWNER TO community_schema;

-- community_app_auth: 가입 시 users INSERT, 로그인 시 이메일로 조회(비로그인 상태라
-- app.user_id가 없으므로 RLS 대신 역할 분리로 범위를 좁힌다 — users는 RLS가
-- 아예 없다는 걸 기억할 것, §0001 참고).
GRANT SELECT, INSERT, UPDATE ON users TO community_app_auth;
GRANT SELECT, INSERT, UPDATE ON auth_credentials TO community_app_auth;
GRANT SELECT, INSERT ON oauth_identities TO community_app_auth;
GRANT SELECT, INSERT, UPDATE ON email_verification_tokens TO community_app_auth;
-- DELETE도 필요하다 — 비밀번호 재설정 성공 시 그 사용자의 남은 미소비 토큰을
-- 전부 무효화한다(다른 이메일 클라이언트에서 또 눌렀을 수 있는 링크 포함).
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO community_app_auth;

-- 🔒 회귀 방지 — 콘텐츠 역할은 auth_credentials/토큰 테이블에 접근할 수 없다.
-- (community_app_arrays/community_app_exists에는 위 GRANT를 절대 추가하지 않는다.)

COMMIT;
