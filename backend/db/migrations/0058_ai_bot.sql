-- 0058 — ai_bot 계정 추가
--
-- 사용자 지시(2026-10-26, "글 작성시 news를 제외한 나머지 카테고리에서
-- ai_bot이 첫 댓글을 쓰게 해줘") — news는 이미 ai_news_bot/ai_digest_bot이
-- 발행 주체라 제외하고, 나머지 커뮤니티 카테고리의 새 글에 첫 댓글을
-- 다는 전용 봇. 0051의 ai_news_bot/ai_digest_bot과 같은 패턴(is_agent=true).

BEGIN;

INSERT INTO users (username, nickname, is_agent) VALUES
    ('ai_bot', 'AI 댓글봇', true)
ON CONFLICT (username) DO NOTHING;

COMMIT;
