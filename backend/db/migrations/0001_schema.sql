-- Reafy 0001 — 권한 수직 슬라이스용 최소 스키마
-- PRD §13 데이터 모델 초안의 부분집합. G1/G2 가드(§10.1-bis)와 T11 벤치마크(§9.2-bis)에
-- 필요한 테이블만 담는다. 나머지는 P1 이후.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pg_bigm;    -- §6.8 한국어 2-gram 검색

-- ─────────────────────────────────────────────────────────────
-- 🔒 스키마 소유자는 슈퍼유저가 아니어야 한다 (§4.5 함정 2)
--
-- 실측으로 확인한 사실: FORCE ROW LEVEL SECURITY 는 **슈퍼유저를 막지 못한다.**
-- 비소유 역할만 챙기고 소유자가 슈퍼유저인 채로 두면, 마이그레이션·배치·운영
-- 스크립트가 RLS를 통째로 우회한다. 그리고 그 상태는 화면상 아무 증상이 없다.
--
--   community_owner    슈퍼유저. 컨테이너 부트스트랩 전용. 런타임 사용 금지
--   community_schema   비슈퍼유저. 테이블 소유자. 마이그레이션·배치가 쓴다
--   community_app_*    비슈퍼유저. 소유권 없음. 앱 런타임 (0002에서 생성)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_schema') THEN
        CREATE ROLE community_schema LOGIN PASSWORD 'devpass' NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 사용자
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username    text NOT NULL UNIQUE,          -- §3.3 핸들의 주인은 User
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 관계 — §8
-- ─────────────────────────────────────────────────────────────
CREATE TABLE friendships (
    requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id),
    -- §10.3 A→B, B→A 동시 신청이 UNIQUE 위반으로 원인 불명 실패하지 않도록
    -- 방향 무관 유일성을 강제한다
    CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX friendships_pair_uniq
    ON friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- T11 정책 변형 B(인덱스 EXISTS)가 양방향 프로브를 하므로 두 방향 모두 인덱스가 필요하다
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id, requester_id) WHERE status = 'accepted';
CREATE INDEX friendships_requester_idx ON friendships (requester_id, addressee_id) WHERE status = 'accepted';

CREATE TABLE blocks (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);

-- ─────────────────────────────────────────────────────────────
-- 게시물 — §13 Post
-- ─────────────────────────────────────────────────────────────
CREATE TABLE posts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id  uuid,                          -- 커뮤니티 글이면 NOT NULL
    log_id       uuid,                          -- 로그 글이면 NOT NULL
    title        text NOT NULL,
    body         text NOT NULL DEFAULT '',
    visibility   text NOT NULL DEFAULT 'public'
                 CHECK (visibility IN ('public', 'friends', 'private')),
    show_on_home boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,

    -- §5.2 커뮤니티 글은 전체공개 고정. 앱 검증만으로는 배치·운영 스크립트가 우회한다
    CONSTRAINT posts_community_is_public
        CHECK (category_id IS NULL OR visibility = 'public'),
    -- 카테고리도 로그도 없는 글은 갈 곳이 없다
    CONSTRAINT posts_has_destination
        CHECK (category_id IS NOT NULL OR log_id IS NOT NULL)
);

-- §5.1 홈 피드 정렬 — date_trunc('hour', created_at) DESC, ..., created_at DESC
--
-- 🔒 date_trunc(text, timestamptz)는 세션 타임존에 의존해 STABLE이지 IMMUTABLE이
--    아니다. 인덱스 표현식은 IMMUTABLE만 허용되므로 그대로는 인덱스가 불가능하다.
--    (실측: T11 벤치마크 중 발견 — §9.2-bis)
--    AT TIME ZONE 'UTC'로 timestamptz -> timestamp 변환을 거치면 세션과 무관해져
--    IMMUTABLE이 되고, 그 위의 date_trunc는 인덱스에 쓸 수 있다.
--    애플리케이션 쿼리의 ORDER BY도 반드시 이 표현식과 문자 그대로 일치해야 한다 —
--    다르면 플래너가 인덱스를 매칭하지 못하고 조용히 Seq Scan으로 돌아간다.
CREATE INDEX posts_feed_idx
    ON posts (
        (date_trunc('hour', created_at AT TIME ZONE 'UTC')) DESC,
        created_at DESC,
        id DESC
    )
    WHERE deleted_at IS NULL;

-- §6.8 한국어 검색 — lower(col) LIKE lower(?) 에 대응하는 함수 인덱스
-- 🔒 ILIKE는 이 인덱스를 타지 않는다. 반드시 lower() + LIKE 로 질의할 것
CREATE INDEX posts_title_bigm_idx ON posts USING gin (lower(title) gin_bigm_ops);
CREATE INDEX posts_body_bigm_idx  ON posts USING gin (lower(body)  gin_bigm_ops);

-- ─────────────────────────────────────────────────────────────
-- 카운터 — Eng 리뷰 3차 결정 (§13 PostStats)
-- Post 행에 두면 인기 글의 잠금 경합이 본문 수정과 충돌한다
-- ─────────────────────────────────────────────────────────────
CREATE TABLE post_stats (
    post_id        uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    reaction_count integer NOT NULL DEFAULT 0,
    comment_count  integer NOT NULL DEFAULT 0,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 반응 — §11.10.3 "1인 1반응, 다른 걸 누르면 교체"
-- ─────────────────────────────────────────────────────────────
CREATE TABLE reactions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type   text NOT NULL CHECK (target_type IN ('post', 'comment')),
    target_id     uuid NOT NULL,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoticon_type text NOT NULL
                  CHECK (emoticon_type IN ('empathy','cheer','funny','surprise','sad','helpful')),
    created_at    timestamptz NOT NULL DEFAULT now(),

    -- 🔒 이 제약이 없으면 더블클릭·재시도 경합에 행이 2개 생겨 카운트가 부풀고
    --    §11.5.2 낙관적 롤백이 어긋난다
    CONSTRAINT reactions_one_per_user UNIQUE (target_type, target_id, user_id)
);

-- 🔒 소유권을 비슈퍼유저에게 넘긴다. 이게 있어야 FORCE ROW LEVEL SECURITY 가
--    실제로 의미를 갖는다.
ALTER TABLE users       OWNER TO community_schema;
ALTER TABLE friendships OWNER TO community_schema;
ALTER TABLE blocks      OWNER TO community_schema;
ALTER TABLE posts       OWNER TO community_schema;
ALTER TABLE post_stats  OWNER TO community_schema;
ALTER TABLE reactions   OWNER TO community_schema;

GRANT USAGE ON SCHEMA public TO community_schema;

COMMIT;
