-- Reafy 0002 — RLS 권한 계층 (PRD §4.5)
--
-- 검증 대상 가정: "코드가 까먹어도 DB가 막는다"
--
-- 🔒 함정 1 — 트랜잭션 모드 풀러: SET(세션)이 아니라 SET LOCAL(트랜잭션)만 쓴다.
-- 🔒 함정 2 — 소유자/슈퍼유저는 RLS를 우회한다: 앱은 비소유 역할로 접속하고
--             FORCE ROW LEVEL SECURITY 를 켠다.
--
-- T11 벤치마크(§9.2-bis): 같은 테이블·같은 데이터에 대해 두 정책을 비교한다.
--   변형 A  community_app_arrays  — 관계 집합을 세션 변수 배열로 주입해 포함 검사
--   변형 B  community_app_exists  — 정책 안에서 관계 테이블을 인덱스 EXISTS 프로브
-- 정책의 TO 절로 역할을 분리했으므로 정책이 OR로 합쳐지지 않는다.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 역할 — 둘 다 비소유. 이것이 함정 2의 대응이다
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_app_arrays') THEN
        CREATE ROLE community_app_arrays LOGIN PASSWORD 'devpass' NOSUPERUSER NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_app_exists') THEN
        CREATE ROLE community_app_exists LOGIN PASSWORD 'devpass' NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO community_app_arrays, community_app_exists;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
    TO community_app_arrays, community_app_exists;

-- ─────────────────────────────────────────────────────────────
-- 세션 컨텍스트 헬퍼 (§9.2-bis)
-- STABLE 이며 IMMUTABLE 이 아니다 — 플래너가 트랜잭션 밖으로 호이스트하면 안 된다
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_friend_ids() RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT coalesce(
        nullif(current_setting('app.friend_ids', true), '')::uuid[],
        '{}'::uuid[]
    )
$$;

CREATE OR REPLACE FUNCTION app_blocked_ids() RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT coalesce(
        nullif(current_setting('app.blocked_ids', true), '')::uuid[],
        '{}'::uuid[]
    )
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS 활성화
-- ─────────────────────────────────────────────────────────────
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
-- 🔒 FORCE 가 없으면 테이블 소유자에게 정책이 적용되지 않는다 (함정 2)
ALTER TABLE posts FORCE ROW LEVEL SECURITY;

-- friendships / blocks 에는 RLS를 걸지 않는다.
-- 이유: posts 정책이 이 테이블들을 읽으므로 RLS를 걸면 정책 평가 중 정책이
--       다시 평가되어 재귀·성능 문제가 된다. 대신 GRANT 로 접근을 제한하고
--       관계 데이터는 본인 것만 조회하도록 앱 계층에서 다룬다.
-- ⚠️ PRD §4.5의 테이블별 RLS 범위 표에 friendships/blocks 가 빠져 있다. 문서에 반영 필요.

-- ─────────────────────────────────────────────────────────────
-- 변형 A — 배열 주입 (초안이 택한 방식)
--
-- 🔒 deleted_at IS NULL 은 OR 전체에 걸쳐 무조건 적용한다. "본인 글이면
--    무조건 통과" 형태로 두면 소프트 삭제된 자기 글이 일반 피드에도 보이고,
--    부분 인덱스(WHERE deleted_at IS NULL)를 플래너가 증명하지 못해 못 쓴다.
--    (실측으로 발견 — 아래 "명령별 정책 분리" 주석 참조)
-- ─────────────────────────────────────────────────────────────
CREATE POLICY posts_select_arrays ON posts
    FOR SELECT TO community_app_arrays
    USING (
        deleted_at IS NULL
        AND NOT (author_id = ANY (app_blocked_ids()))
        AND (
            visibility = 'public'
            OR author_id = app_current_user_id()
            OR (visibility = 'friends' AND author_id = ANY (app_friend_ids()))
        )
    );

-- ─────────────────────────────────────────────────────────────
-- 변형 B — 인덱스 EXISTS (교차검증이 제안한 대안)
-- ─────────────────────────────────────────────────────────────
CREATE POLICY posts_select_exists ON posts
    FOR SELECT TO community_app_exists
    USING (
        deleted_at IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE b.blocker_id = app_current_user_id()
              AND b.blocked_id = posts.author_id
        )
        AND (
            visibility = 'public'
            OR author_id = app_current_user_id()
            OR (visibility = 'friends' AND EXISTS (
                    SELECT 1 FROM friendships f
                    WHERE f.status = 'accepted'
                      AND (
                          (f.requester_id = app_current_user_id() AND f.addressee_id = posts.author_id)
                       OR (f.addressee_id = app_current_user_id() AND f.requester_id = posts.author_id)
                      )
               ))
        )
    );

-- ─────────────────────────────────────────────────────────────
-- 쓰기 — 명령별로 분리한다. FOR ALL 을 쓰지 않는다.
--
-- 🔒 실측으로 발견한 함정: 같은 역할에 FOR ALL 정책과 FOR SELECT 정책을
-- 동시에 두면, Postgres는 같은 커맨드(SELECT)에 적용되는 permissive 정책
-- 전부를 OR로 합친다. FOR ALL 의 "author_id = 본인"이 SELECT 정책의
-- deleted_at 조건 없이 그대로 섞여 들어가 위 방어가 무력화된다.
-- 증상은 없다 — 본인 글은 원래도 보여야 하므로 화면은 정상으로 보인다.
-- 조용히 무력화되는 건 부분 인덱스 사용 가능 여부와 "삭제된 본인 글 노출"
-- 두 가지이며 둘 다 기능 테스트로는 안 잡힌다.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY posts_insert_own_arrays ON posts FOR INSERT TO community_app_arrays
    WITH CHECK (author_id = app_current_user_id());
CREATE POLICY posts_update_own_arrays ON posts FOR UPDATE TO community_app_arrays
    USING (author_id = app_current_user_id()) WITH CHECK (author_id = app_current_user_id());
CREATE POLICY posts_delete_own_arrays ON posts FOR DELETE TO community_app_arrays
    USING (author_id = app_current_user_id());

CREATE POLICY posts_insert_own_exists ON posts FOR INSERT TO community_app_exists
    WITH CHECK (author_id = app_current_user_id());
CREATE POLICY posts_update_own_exists ON posts FOR UPDATE TO community_app_exists
    USING (author_id = app_current_user_id()) WITH CHECK (author_id = app_current_user_id());
CREATE POLICY posts_delete_own_exists ON posts FOR DELETE TO community_app_exists
    USING (author_id = app_current_user_id());

COMMIT;
