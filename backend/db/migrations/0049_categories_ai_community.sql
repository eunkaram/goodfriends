-- 0049 — AI 커뮤니티 카테고리로 전면 교체
--
-- 기획 기준(ai-board-phase1.pdf §2): 1차는 9개 카테고리만 공개하고, 4개는
-- 2차 확장으로 숨겨둔다("글이 쌓이는 속도를 보고 순차적으로 엽니다").
-- 구성(2장): 봇이 채우는 메뉴(배우고-뉴스/화제) + 누구나 쓰기 쉬운 메뉴 +
-- 차별점 메뉴(아이디어/개발로그/쇼케이스)만 1차에 연다.
--
-- 🔒 0033과 같은 전제 — 이 마이그레이션은 항상 새로 만들어진 빈 DB에서
-- 실행된다(db:reset 흐름). 실사용자 글이 있는 상태에서 재실행하면
-- posts.category_id FK로 실패한다(의도된 안전장치).
--
-- 봇 계정(users.is_agent, 0043)은 "AI 뉴스/오늘의 AI 화제" 발행 주체로 쓴다
-- — 이메일 미인증 상태로도 발행이 허용된다(isEmailVerified 우회, auth.ts).

BEGIN;

-- 1) 기존 Reafy taxonomy 전면 비공개(데이터 보존, 하드 삭제는 FK 때문에 안 한다).
--    대분류 행까지 전부 false — 새 taxonomy가 이제 유일한 표시 목록이다.
UPDATE categories SET is_public = false;

-- 2) 대분류: 배우고 / 만들고 / 나누는
INSERT INTO categories (name_key, slug, type, sort, is_public) VALUES
    ('category.learn', 'learn', 'community', 1, true),
    ('category.build', 'build', 'community', 2, true),
    ('category.share', 'share', 'community', 3, true);

-- 3) 배우고 — 봇이 매일 자동으로 채우는 엔진(AI 뉴스, 오늘의 AI 화제) +
--    팁/질문. 논문·리서치는 2차 보류(is_public=false).
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.ai_news',    'ai-news',   1, true),
    ('category.ai_topics',  'ai-topics', 2, true),
    ('category.ai_tips',    'ai-tips',   3, true),
    ('category.qna',        'qna',       4, true),
    ('category.research',   'research',  5, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.learn';

-- 4) 만들고 — 이 커뮤니티만의 색깔(아이디어 → 개발 로그 → 쇼케이스 파이프라인).
--    로컬·오픈 모델, 이미지·영상 생성은 2차 보류.
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.large_models', 'large-models', 1, true),
    ('category.ideas',        'ideas',        2, true),
    ('category.dev_log',      'dev-log',      3, true),
    ('category.showcase',     'showcase',     4, true),
    ('category.open_models',  'open-models',  5, false),
    ('category.gen_media',    'gen-media',    6, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.build';

-- 5) 나누는 — 형식 없이 숨통을 트는 공간. 협업 찾기는 사람이 모인 뒤(2차).
INSERT INTO categories (parent_id, name_key, slug, type, sort, is_public)
SELECT c.id, v.name_key, v.slug, 'community', v.sort, v.is_public
FROM categories c, (VALUES
    ('category.free_chat', 'free',   1, true),
    ('category.collab',    'collab', 2, false)
) AS v(name_key, slug, sort, is_public)
WHERE c.name_key = 'category.share';

COMMIT;
