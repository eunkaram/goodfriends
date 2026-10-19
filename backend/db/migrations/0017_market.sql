-- 0017 — MarketPost · PostalCodeIndex (§13, §6.3, §7). §5가 마켓을 홈 피드에서
-- 제외하기로 이미 확정했으므로 별도 테이블로 분리한다(Post와 UNION하지 않음, §9.2).
--
-- MarketPost엔 visibility 컬럼이 없다 — §13 원안 그대로다. 마켓 글은 애초에
-- 전체공개 개념밖에 없다(팔려야 하는 물건이라 비공개가 의미 없음). §4.3
-- "마켓(물건·가격·도시) ✅ 읽기"가 비로그인에게도 적용되는 이유이기도 하다.
-- 로그인 게이트는 "거리" 정보에만 걸린다(§4.3) — 그건 앱 레이어(거리 계산
-- 결과를 비로그인 응답에서 빼는 것) 책임이지 RLS 책임이 아니다.

BEGIN;

CREATE TABLE market_posts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id  uuid NOT NULL REFERENCES categories(id),
    title        text NOT NULL,
    body         text NOT NULL DEFAULT '',
    price        numeric(12, 2),
    currency     text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'KRW')),
    trade_status text NOT NULL DEFAULT 'selling' CHECK (trade_status IN ('selling', 'reserved', 'sold')),
    country_code text NOT NULL,
    postal_code  text,
    region_code  text,
    lat          double precision,
    lng          double precision,
    created_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
CREATE INDEX market_posts_created_idx ON market_posts (created_at DESC) WHERE deleted_at IS NULL;
-- §9.2 "bounding box 선필터" — lat/lng 범위 비교가 이 인덱스를 타야 정밀 Haversine 전에 후보를 좁힐 수 있다.
CREATE INDEX market_posts_geo_idx ON market_posts (lat, lng) WHERE deleted_at IS NULL;

-- §7 "우편번호→좌표 데이터셋 + Haversine. 외부 지도 API 미사용"
-- ⚠️ 실측 데이터가 아니다 — 개발·테스트에 필요한 대표 도시 몇 곳만 시드했다.
-- 실서비스 전 미국 ZIP 5자리·한국 우편번호 5자리 전체 데이터셋으로 교체할 것(별도 운영 작업, 코드 작업 아님).
CREATE TABLE postal_code_index (
    country_code text NOT NULL,
    postal_code  text NOT NULL,
    lat          double precision NOT NULL,
    lng          double precision NOT NULL,
    city         text NOT NULL,
    state        text,
    PRIMARY KEY (country_code, postal_code)
);

ALTER TABLE market_posts       OWNER TO community_schema;
ALTER TABLE postal_code_index  OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_posts TO community_app_exists;
GRANT SELECT ON postal_code_index TO community_app_exists;

ALTER TABLE market_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_posts FORCE ROW LEVEL SECURITY;

-- 차단만 걸린다 — 공개범위 자체가 없다. app_current_user_id()가 NULL(비로그인)이면
-- app_is_blocked_with()는 항상 false라 비로그인도 전부 읽는다(§4.3과 일치).
CREATE POLICY market_posts_select ON market_posts
    FOR SELECT TO community_app_exists
    USING (deleted_at IS NULL AND NOT app_is_blocked_with(author_id));

CREATE POLICY market_posts_insert ON market_posts FOR INSERT TO community_app_exists
    WITH CHECK (author_id = app_current_user_id());
CREATE POLICY market_posts_update ON market_posts FOR UPDATE TO community_app_exists
    USING (author_id = app_current_user_id()) WITH CHECK (author_id = app_current_user_id());
CREATE POLICY market_posts_delete ON market_posts FOR DELETE TO community_app_exists
    USING (author_id = app_current_user_id());

-- 대표 도시 시드 — 미국 몇 곳 + 한국 몇 곳. 실측 데이터 아님(위 주석 참고).
INSERT INTO postal_code_index (country_code, postal_code, lat, lng, city, state) VALUES
    ('US', '94105', 37.7897, -122.3942, 'San Francisco', 'CA'),
    ('US', '94301', 37.4419, -122.1430, 'Palo Alto', 'CA'),
    ('US', '95110', 37.3382, -121.8863, 'San Jose', 'CA'),
    ('US', '90001', 33.9731, -118.2479, 'Los Angeles', 'CA'),
    ('US', '10001', 40.7506, -73.9972, 'New York', 'NY'),
    ('KR', '06236', 37.5088, 127.0632, '서울', '강남구'),
    ('KR', '13529', 37.4009, 127.1120, '성남', '분당구'),
    ('KR', '48058', 35.1631, 129.1635, '부산', '해운대구');

COMMIT;
