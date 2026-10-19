-- 0033 — 커뮤니티 카테고리 전면 재정리
--
-- 사용자 지시(2026-08, "커뮤니티 카테고리를 정리를 하고 싶어. 메뉴명과
-- 카테고리 명이야. 데이터베이스 리셋하고 메뉴를 수정하고 카테고리는
-- path로 설정해") — 사용자가 준 목록으로 커뮤니티(type='community')
-- 전체를 하드 교체한다. "path"는 이 프로젝트에 별도 path 컬럼 개념이
-- 없어서(§3.2 확인) categories.slug를 가리키는 것으로 확인 후 진행 —
-- /{category} 라우팅에 쓰이는 그 slug다. 마켓(type='market')은 이번
-- 요청 범위 밖이라 안 건드린다.
--
-- 🔒 0022가 "하드 삭제 대신 is_public만 조정"했던 이유는 그때 실사용자
-- leveess가 daily-chat 등에 이미 글을 쓴 상태였기 때문이다(posts.category_id
-- FK 위반 우려, 0022 주석 참고). 이번엔 사용자가 db:reset(docker compose
-- down -v로 전체 데이터 삭제)까지 명시적으로 확인했다 — 이 마이그레이션이
-- 실행되는 시점엔 항상 방금 새로 만들어진 빈 DB뿐이라 그 우려가 적용되지
-- 않는다. **이 마이그레이션은 항상 빈 DB에서 0015/0022 다음으로 실행된다는
-- 전제로만 안전하다** — 실사용자 데이터가 있는 채로 재실행하면 FK 위반으로
-- 실패한다(의도된 안전장치이지 버그가 아니다).
--
-- 4개 그룹(토크/라이프/컬쳐/커리어&머니)만 남긴다 — 테크·가족 그룹은
-- 없애고, "테크·AI"는 컬쳐 하위로 흡수했다. 예전의 "일부만 공개, 나머지는
-- is_public=false로 숨김"이라는 단계적 롤아웃(§12.1)은 이 목록엔 적용하지
-- 않는다 — 사용자가 직접 골라 정리한 최종 목록이라 전부 공개한다.

BEGIN;

-- 자식부터 지운다 — parent_id가 categories(id)를 참조하고(ON DELETE 액션
-- 없음, 기본 RESTRICT) 부모를 먼저 지우면 위반한다.
DELETE FROM categories WHERE type = 'community' AND parent_id IS NOT NULL;
DELETE FROM categories WHERE type = 'community' AND parent_id IS NULL;

INSERT INTO categories (name_key, slug, type, sort, is_public) VALUES
    ('category.talk',         'talk',         'community', 1, true),
    ('category.life',         'life',         'community', 2, true),
    ('category.culture',      'culture',      'community', 3, true),
    ('category.career_money', 'career-money', 'community', 4, true);

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.daily_chat', 'chat',  1),
    ('category.issues',     'issue', 2),
    ('category.humor',      'humor', 3)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.talk';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.health_fitness', 'health',   1),
    ('category.fashion_beauty', 'shopping', 2),
    ('category.cooking',        'cooking',  3),
    ('category.pets',           'pets',     4)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.life';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.broadcast', 'broadcast', 1),
    ('category.travel',    'travel',    2),
    ('category.tech_ai',   'tech',      3),
    ('category.hobby',     'hobby',     4)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.culture';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.investing', 'invest',   1),
    ('category.deals',     'hotdeals', 2),
    ('category.career',    'careers',  3),
    ('category.startup',   'startup',  4)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.career_money';

COMMIT;
