-- 0015 — Category (§13, §3.1, §12.1).홈 화면(구독 좌내비 · §5.1 가중치)과
-- 카테고리 피드·메가메뉴가 전부 이 테이블에 의존한다. 지금까지는
-- posts.category_id가 FK도 없는 빈 uuid였고, Gnb.tsx의 카테고리 목록도
-- "레이아웃 검증용 목데이터"로 명시된 임시값이었다 — 이제 진짜 테이블로 교체한다.
--
-- name_key — §9.3 "카테고리명은 번역 키로 관리, 하드코딩 금지"의 그 키다.
-- 실제 표시 문자열은 여기 저장하지 않는다 — src/i18n/ko.ts가 키→문자열을 담당한다.
-- 지금은 한국어 단일 로케일이지만, 로케일이 늘어나도 이 테이블은 바뀌지 않는다.
--
-- is_public — §12.1 단계적 롤아웃 피처 플래그. 하위 38개(7대분류 + 마켓 10종 포함) 전부 시드하되 공개는
-- 8개만 한다. **8개 선정은 PRD에 명시되지 않아 임의로 골랐다** — 토크·라이프·
-- 가족·테크에서 하나씩 이상 걸쳐 폭을 넓혔다. 운영 판단으로 언제든 조정 가능
-- (되돌리기는 어렵다 — §12.1 "되돌리기 난이도 2/5").

BEGIN;

CREATE TABLE categories (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES categories(id),
    name_key  text NOT NULL UNIQUE,
    slug      text NOT NULL UNIQUE,   -- §3.2 /{category} 라우팅
    type      text NOT NULL CHECK (type IN ('community', 'market')),
    sort      integer NOT NULL DEFAULT 0,
    is_public boolean NOT NULL DEFAULT false
);
CREATE INDEX categories_parent_idx ON categories (parent_id, sort);

ALTER TABLE categories OWNER TO community_schema;
-- RLS 불필요 — 노출 제어는 is_public 컬럼 하나뿐이고 사용자별 분기가 없다(§4.5 범위 밖).
-- 앱 쿼리가 WHERE is_public = true를 직접 거는 것으로 충분하다.
GRANT SELECT ON categories TO community_app_exists, community_app_arrays;

-- 7대분류. 부모 자체는 롤아웃 게이트 대상이 아니다 — §11.8 "대분류는 공개된
-- 하위가 1개 이상일 때만 표시"는 렌더 시점에 하위를 보고 판단하는 파생 규칙이다.
INSERT INTO categories (name_key, slug, type, sort, is_public) VALUES
    ('category.talk',         'talk',         'community', 1, true),
    ('category.life',         'life',         'community', 2, true),
    ('category.culture',      'culture',      'community', 3, true),
    ('category.career_money', 'career-money', 'community', 4, true),
    ('category.tech',         'tech',         'community', 5, true),
    ('category.family',       'family',       'community', 6, true),
    ('category.market',       'market',       'market',    7, true);

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.daily_chat', 'daily-chat', 1, true),
    ('category.advice',     'advice',     2, true),
    ('category.qna',        'qna',        3, true),
    ('category.issues',     'issues',     4, false),
    ('category.humor',      'humor',      5, true),
    ('category.social',     'social',     6, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.talk';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.health_fitness', 'health-fitness', 1, true),
    ('category.cooking',        'cooking',        2, false),
    ('category.fashion_beauty', 'fashion-beauty', 3, false),
    ('category.home_interior',  'home-interior',  4, false),
    ('category.pets',           'pets',           5, true),
    ('category.travel',         'travel',         6, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.life';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.movies_dramas', 'movies-dramas', 1, false),
    ('category.music',         'music',         2, false),
    ('category.books',         'books',         3, false),
    ('category.games',         'games',         4, false),
    ('category.sports',        'sports',        5, false),
    ('category.photo_art',     'photo-art',     6, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.culture';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.career',           'career',           1, false),
    ('category.investing',        'investing',        2, false),
    ('category.startup',          'startup',          3, false),
    ('category.self_development', 'self-development', 4, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.career_money';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.gadgets', 'gadgets', 1, true),
    ('category.dev',     'dev',     2, false),
    ('category.ai',      'ai',      3, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.tech';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.pregnancy_birth', 'pregnancy-birth', 1, false),
    ('category.parenting',       'parenting',       2, true),
    ('category.education',       'education',       3, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.family';

-- 마켓 📍 하위 10종. 전부 type='market' — §5 "마켓은 홈 피드에서 제외"의 그 구분.
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'market', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.moving_sale',        'moving-sale',            1, false),
    ('category.baby_items',         'baby-items',             2, false),
    ('category.furniture_living',   'furniture-living',       3, false),
    ('category.clothing_accessories','clothing-accessories',  4, false),
    ('category.electronics',        'electronics',            5, false),
    ('category.market_books_edu',   'market-books-education', 6, false),
    ('category.sports_leisure',     'sports-leisure',         7, false),
    ('category.cars',               'cars',                   8, false),
    ('category.real_estate_rent',   'real-estate-rent',       9, false),
    ('category.wanted_giveaway',    'wanted-giveaway',       10, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.market';

COMMIT;
