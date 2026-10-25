-- 0053 — goodfriends 카테고리로 전면 교체
--
-- goodfriends-ui/CLAUDE.md 4. 메뉴 구조:
--   커뮤니티    News · Q&A · 창업·아이디어 · 자유게시판
--   모델·도구   Frontier Models · Local LLM · Agents & Harness · AI Services
--   활용 분야   AI Coding · Automation · Creative
--
-- 0049와 같은 전제 — 기존 taxonomy 전체를 비공개 처리(하드 삭제는 FK 때문에
-- 안 한다)하고 새 taxonomy만 공개한다. 기존 공개 카테고리 중 개념이 겹치는
-- 5개(News=ai-news, Q&A=qna, 창업·아이디어=ideas, 자유게시판=free,
-- Local LLM=large-models)는 slug를 유지한 채 재부모·표시명만 바꾼다 —
-- news-bot.ts(NEWS_CATEGORY_SLUG='ai-news')·qna.ts(QNA_CATEGORY_SLUG='qna')
-- 하드코딩 슬러그를 그대로 보존하기 위해서다. 나머지 6개는 slug 충돌이
-- 없는 새 카테고리로 추가한다.

BEGIN;

-- 1) 기존 taxonomy 전면 비공개
UPDATE categories SET is_public = false;

-- 2) 대분류 3개
INSERT INTO categories (name_key, slug, type, sort, is_public) VALUES
    ('category.gf_community', 'community', 'community', 1, true),
    ('category.gf_tools',     'tools',     'community', 2, true),
    ('category.gf_usecase',   'usecase',   'community', 3, true);

-- 3) 커뮤니티 — 기존 4개 재사용(slug 유지, 재부모 + 표시명만 변경은 i18n/ko.ts에서)
UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name_key = 'category.gf_community'), sort = 1, is_public = true WHERE name_key = 'category.ai_news';
UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name_key = 'category.gf_community'), sort = 2, is_public = true WHERE name_key = 'category.qna';
UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name_key = 'category.gf_community'), sort = 3, is_public = true WHERE name_key = 'category.ideas';
UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name_key = 'category.gf_community'), sort = 4, is_public = true WHERE name_key = 'category.free_chat';

-- 4) 모델·도구 — Local LLM은 기존 large-models 재사용, 나머지 3개는 신규
UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name_key = 'category.gf_tools'), sort = 2, is_public = true WHERE name_key = 'category.large_models';

INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.frontier_models', 'frontier-models', 1),
    ('category.agents_harness',  'agents-harness',  3),
    ('category.ai_services',     'ai-services',     4)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.gf_tools';

-- 5) 활용 분야 — 전부 신규
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, true
FROM categories c, (VALUES
    ('category.ai_coding',  'ai-coding',  1),
    ('category.automation', 'automation', 2),
    ('category.creative',   'creative',   3)
) AS v(name_key, slug, sort)
WHERE c.name_key = 'category.gf_usecase';

COMMIT;
