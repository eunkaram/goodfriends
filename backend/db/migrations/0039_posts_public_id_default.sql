-- 0039 — posts.public_id DB DEFAULT
--
-- 0038이 public_id를 NOT NULL로 만들었지만 DEFAULT는 안 줬다 — 애플리케이션
-- (src/posts.ts)이 항상 명시적으로 값을 넣는다고 가정했기 때문. 하지만
-- id(uuid) 컬럼처럼 이 테이블에 직접 INSERT하는 다른 경로(테스트 픽스처,
-- 수동 SQL 등)는 public_id를 모른다 — NOT NULL 위반으로 막힌다. id가
-- DEFAULT gen_random_uuid()로 그런 경로도 안전한 것과 똑같이, public_id도
-- DB가 스스로 채울 수 있어야 한다.
--
-- 0038의 백필 공식과 같은 재인코딩(pgcrypto 없이) — 이번엔 기존 행의 id
-- 대신 매번 새로 뽑은 gen_random_uuid()의 앞 8바이트를 엔트로피로 쓴다.
-- 애플리케이션이 여전히 명시적으로 값을 넘기면(현재 동작) 이 DEFAULT는
-- 그냥 안 쓰인다 — 세션/인증 토큰과 같은 생성 방식을 유지하고 싶다는
-- 이전 결정(0038, src/posts.ts 주석)은 그대로 둔다.

BEGIN;

CREATE FUNCTION app_generate_public_id() RETURNS text
LANGUAGE sql VOLATILE AS $$
    SELECT rtrim(
        translate(
            encode(substring(decode(replace(gen_random_uuid()::text, '-', ''), 'hex') from 1 for 8), 'base64'),
            '+/', '-_'
        ),
        '='
    )
$$;

ALTER TABLE posts ALTER COLUMN public_id SET DEFAULT app_generate_public_id();

COMMIT;
