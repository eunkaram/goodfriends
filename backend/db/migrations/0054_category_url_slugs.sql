-- 0054 — 카테고리 URL 슬러그 정리(사용자 지시 2026-10)
--
-- 표시명은 그대로 두고 /{category} 링크만 짧게 바꾼다.
--   News                news
--   Q&A                 qna       (변경 없음)
--   창업·아이디어       idea
--   자유게시판          free      (변경 없음)
--   Frontier Models     frontier
--   Local LLM           local
--   Agents & Harness    agents
--   AI Services         aiservice
--   AI Coding           coding
--   Automation          automation (변경 없음)
--   Creative            creative   (변경 없음)
--
-- name_key로 갱신한다 — slug 자체를 조건으로 쓰면 이 마이그레이션을 다시
-- 돌릴 때(또는 다른 환경에서) 이전 값과 매치되지 않기 때문이다.
-- news-bot.ts/admin-digest.ts의 하드코딩 상수도 같은 커밋에서 함께 바꾼다.

BEGIN;

UPDATE categories c
SET slug = v.slug
FROM (VALUES
    ('category.ai_news',         'news'),
    ('category.qna',             'qna'),
    ('category.ideas',           'idea'),
    ('category.free_chat',       'free'),
    ('category.frontier_models', 'frontier'),
    ('category.large_models',    'local'),
    ('category.agents_harness',  'agents'),
    ('category.ai_services',     'aiservice'),
    ('category.ai_coding',       'coding'),
    ('category.automation',      'automation'),
    ('category.creative',        'creative')
) AS v(name_key, slug)
WHERE c.name_key = v.name_key;

COMMIT;
