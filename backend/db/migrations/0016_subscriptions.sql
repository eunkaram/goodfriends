-- 0016 — Subscription (§13, §5 "구독은 필터가 아니라 랭킹 가중치").
-- §5.1 정렬 공식의 두 번째 키(is_subscribed_or_following)와 홈 좌내비
-- "구독 중인 것만"(§11.8)이 이 테이블에 의존한다.
--
-- saved_posts/follows(0014)와 같은 이유로 RLS를 정상적으로 건다 — 다른
-- 테이블의 정책이 이 테이블을 참조하지 않아 자기 재귀 위험이 없다(불변식 12 미해당).

BEGIN;

CREATE TABLE subscriptions (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category_id)
);

ALTER TABLE subscriptions OWNER TO community_schema;
GRANT SELECT, INSERT, DELETE ON subscriptions TO community_app_exists;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select ON subscriptions
    FOR SELECT TO community_app_exists
    USING (user_id = app_current_user_id());
CREATE POLICY subscriptions_insert ON subscriptions
    FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY subscriptions_delete ON subscriptions
    FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

COMMIT;
