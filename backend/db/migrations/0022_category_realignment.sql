-- 0022 — 카테고리 공개 목록을 Artifact(claude.ai/code/artifact/f5b62935-...,
-- "커뮤니티 디자인")의 메가메뉴 16개(토크/라이프/컬처/머니·커리어 4그룹 x 4개)로
-- 맞춘다. 사용자 지시(2026-08) — "카테고리도 목업이 최종 결정 내용이야. 이것도
-- 목업의 카테고리로 처리해줘".
--
-- 🔒 하드 삭제 대신 is_public 피처 플래그만 조정한다 — categories는 0015부터
-- "단계적 롤아웃"을 위해 이 컬럼을 이미 갖고 있고(§12.1), posts.category_id에
-- FK가 걸려 있어(0018) 실사용자 leveess가 daily-chat 등에 이미 글을 쓴 상태다.
-- 하드 삭제하면 FK 위반으로 마이그레이션 자체가 실패하거나, 기존 글의
-- category_id가 고아가 된다 — 대신 안 보이게만 하고 데이터는 보존한다.
--
-- Artifact엔 없지만 기존에 공개돼 있던 category.gadgets(IT/가젯)·
-- category.parenting(육아)도 이번에 비공개로 내린다 — "목업이 최종 결정"이라는
-- 지시를 문자 그대로 따른 결과다.

BEGIN;

-- Artifact 16개 중 기존 키로 이미 존재하는 것들 — 공개 전환
UPDATE categories SET is_public = true WHERE name_key IN (
    'category.cooking',      -- 음식/요리로 한글 라벨만 교체(ko.ts), 키는 유지
    'category.travel',
    'category.games',
    'category.movies_dramas',
    'category.investing',
    'category.career',       -- 구인구직으로 한글 라벨 교체(ko.ts)
    'category.startup'       -- 창업/N잡으로 한글 라벨 교체(ko.ts)
);

-- Artifact에 없는, 기존에 공개였던 카테고리 — 비공개 전환(데이터는 보존)
UPDATE categories SET is_public = false WHERE name_key IN (
    'category.qna',
    'category.gadgets',
    'category.parenting'
);

-- Artifact에는 있지만 기존 taxonomy엔 없던 4개 신규 카테고리
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.dating_marriage', 'dating-marriage', 3)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.talk';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.kcontent', 'kcontent', 1),
    ('category.hobby',    'hobby',    6)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.culture';

-- 🔒 슬러그 'real-estate'는 마켓 하위의 'real-estate-rent'(부동산/렌트,
-- 물건 거래)와 다른 카테고리다 — 이쪽은 커뮤니티 글타래(부동산 관련 잡담)용.
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.real_estate', 'real-estate', 5)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.career_money';

COMMIT;
