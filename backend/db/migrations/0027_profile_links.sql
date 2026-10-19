-- 0027 — ProfileLink (사용자 지시, 2026-08 — "링크, 인스타 와 같은 링크를
-- 여러개 입력 받고 싶어. 지금은 3개로 되어있는데... 링크와 링크이름을
-- 입력받고 저장하면 아래에 아이콘, 이름이 보이고, 아이콘/링크이름을 클릭하면
-- 수정할수 있게")
--
-- user_logs.link_url/instagram_url/twitter_url(고정 3개) 대신 사용자가
-- 이름을 직접 붙이는 임의 개수의 링크 목록으로 교체한다.
--
-- 🔒 profile_fields(0006)의 PRIMARY KEY (user_id, key)는 사용자당 같은 key로
-- 한 행만 허용하는 "싱글턴" EAV라 "링크 여러 개"에 애초에 안 맞는다(먼저
-- 검색해서 확인함 — 이 프로젝트에서 이미 여러 번(카테고리·마켓·saved_posts)
-- 반복된 "기존 스키마부터 검색" 교훈을 다시 지켰다). 그래서 자체 id를 가진
-- 새 테이블로 만들었다. 공개범위는 이 테이블 자체 컬럼으로 두고(albums·
-- profile_fields와 같은 패턴) app_can_view_tier(user_id, visibility)를
-- 그대로 재사용 — 링크 UI에 공개범위 선택 컨트롤은 없어 항상 'public'
-- 기본값으로만 생성되지만, 스키마 자체는 나중에 필요해지면 바로 쓸 수 있게
-- 둔다.

BEGIN;

CREATE TABLE profile_links (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    url         text NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    visibility  text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_links_user_idx ON profile_links (user_id, sort_order);

ALTER TABLE profile_links OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_links TO community_app_exists;
ALTER TABLE profile_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_links FORCE ROW LEVEL SECURITY;

-- 불변식 8 — FOR ALL 대신 SELECT/INSERT/UPDATE/DELETE 분리.
CREATE POLICY profile_links_select ON profile_links
    FOR SELECT TO community_app_exists
    USING (app_can_view_tier(user_id, visibility));

CREATE POLICY profile_links_insert ON profile_links FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY profile_links_update ON profile_links FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY profile_links_delete ON profile_links FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

-- 옛 고정 3필드는 이제 profile_links가 대체한다 — 기존 값을 보존하며 이관.
INSERT INTO profile_links (user_id, name, url, sort_order)
SELECT user_id, '링크', link_url, 0 FROM user_logs WHERE link_url <> '';
INSERT INTO profile_links (user_id, name, url, sort_order)
SELECT user_id, 'Instagram', instagram_url, 1 FROM user_logs WHERE instagram_url <> '';
INSERT INTO profile_links (user_id, name, url, sort_order)
SELECT user_id, 'Twitter', twitter_url, 2 FROM user_logs WHERE twitter_url <> '';

ALTER TABLE user_logs DROP COLUMN link_url;
ALTER TABLE user_logs DROP COLUMN instagram_url;
ALTER TABLE user_logs DROP COLUMN twitter_url;

COMMIT;
