-- 0014 — SavedPost · Follow (§13). P4(§11.9.2 의도 실행 직전 권한 재검증)가
-- 'save'·'follow' 의도를 실제로 실행하려면 이 두 테이블이 있어야 한다 —
-- PRD §13에 스키마는 이미 정해져 있었고 마이그레이션만 빠져 있었다.
--
-- friendships/blocks/participants와 달리 이 두 테이블은 posts 등 다른 테이블의
-- RLS 정책이 참조하지 않는다(§4.5 함정 — 자기 재귀 없음) — 그래서 여기엔 RLS를
-- 정상적으로 건다.

BEGIN;

CREATE TABLE saved_posts (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE follows (
    follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id, follower_id);

ALTER TABLE saved_posts OWNER TO community_schema;
ALTER TABLE follows     OWNER TO community_schema;
GRANT SELECT, INSERT, DELETE ON saved_posts, follows TO community_app_exists;

ALTER TABLE saved_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_posts FORCE ROW LEVEL SECURITY;
ALTER TABLE follows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows     FORCE ROW LEVEL SECURITY;

-- saved_posts — 저장 목록은 철저히 본인만. 남이 뭘 저장했는지는 절대 노출 안 함.
CREATE POLICY saved_posts_select ON saved_posts
    FOR SELECT TO community_app_exists
    USING (user_id = app_current_user_id());
CREATE POLICY saved_posts_insert ON saved_posts
    FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY saved_posts_delete ON saved_posts
    FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

-- follows — 팔로우/팔로워 양쪽 다 본인이 조회 가능(맞팔 여부·팔로워 수 계산에 필요).
-- 🔒 INSERT는 차단 관계면 막는다 — app_is_blocked_with()로 양방향 확인(불변식 11).
CREATE POLICY follows_select ON follows
    FOR SELECT TO community_app_exists
    USING (follower_id = app_current_user_id() OR followee_id = app_current_user_id());
CREATE POLICY follows_insert ON follows
    FOR INSERT TO community_app_exists
    WITH CHECK (follower_id = app_current_user_id() AND NOT app_is_blocked_with(followee_id));
CREATE POLICY follows_delete ON follows
    FOR DELETE TO community_app_exists
    USING (follower_id = app_current_user_id());

COMMIT;
