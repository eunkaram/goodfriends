-- 0051 — 뉴스봇 + 화제 다이제스트 엔진 (M3, ai-board-phase1.pdf §3 "체감 확보")
--
-- 세 테이블 + 봇 계정 2개:
--  - news_articles: worker가 RSS 8개 소스에서 수집한 원문과 상태 머신
--    (new → summarized → published / failed). url UNIQUE가 물리적 중복 제거,
--    제목 유사도는 앱 레이어(news-bot.ts)가 담당한다.
--  - digest_sources: 다이제스트 소재가 될 계정 리스트 — 관리자가 관한다
--    (화제 다이제스트 제작 UI의 1단계).
--  - digest_drafts: LLM 생성 초안 → 관리자 확인/수정 → ai-topics로 발행.
--
-- 🔒 0048 전례 — 세 테이블 전부 RLS가 없다(users와 같은 운영 데이터). 읽기는
-- news_articles가 public 성격이지만 앱 레이어가 관리 API로만 노출하므로
-- GRANT 자체는 SELECT/INSERT/UPDATE만 준다.
--
-- 봇 계정은 plan 표기 `role='bot'`의 0043 재해석(is_agent=true) — 유저 테이블의
-- 운영자 플래그가 agent/moderator로 갈라진 현재 스키마에서 새 role 컬럼을
-- 만들면 이중 관리가 된다. isEmailVerified(auth.ts)가 에이전트를 우회시키므로
-- 이메일 column은 NULL로 둔다.

BEGIN;

CREATE TABLE news_articles (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key         text NOT NULL,     -- 소스 식별자(worker/rss.ts의 sources)
    url                text NOT NULL,     -- 원문 링크 — 발행된 글에 반드시 남는다(§3 요구)
    title              text NOT NULL,     -- 원문 제목(RSS /item/title)
    description        text,             -- 원문 요약/본문 발췌(RSS) — 요약 큐의 재료
    kr_title           text,              -- LLM이 만든 한국어 제목(발행 title)
    digest             text,              -- LLM 한국어 요약(발행 body)
    status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'summarized', 'published', 'failed')),
    error              text,              -- failed일 때 원인(RSS 파싱 실패/LLM 실패)
    post_id            uuid REFERENCES posts(id) ON DELETE SET NULL,
    source_published_at timestamptz,      -- 원문 RSS의 pubDate(오래된 항목 스킵 기준)
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX news_articles_url_uniq ON news_articles (url);
CREATE INDEX news_articles_queue_idx ON news_articles (status, created_at DESC);
CREATE INDEX news_articles_recent_idx ON news_articles (created_at DESC);

CREATE TABLE digest_sources (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE digest_drafts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    content      text NOT NULL,  -- 관리자가 편집 가능한 원문(발행 시 HTML로 래핑)
    status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    post_id      uuid REFERENCES posts(id) ON DELETE SET NULL,
    created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    published_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX digest_drafts_status_idx ON digest_drafts (status, created_at DESC);

-- 봇 계정 2개(발행 주체). db:reset 흐름의 멱등성 — 이미 있으면 플래그만 최신화.
INSERT INTO users (username, nickname, is_agent) VALUES
    ('ai_news_bot', 'AI 뉴스봇', true),
    ('ai_digest_bot', '화제 정리봇', true)
ON CONFLICT (username) DO UPDATE SET is_agent = true, nickname = EXCLUDED.nickname;

ALTER TABLE news_articles OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE ON news_articles TO community_app_exists;
ALTER TABLE digest_sources OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE ON digest_sources TO community_app_exists;
ALTER TABLE digest_drafts OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE ON digest_drafts TO community_app_exists;

COMMIT;
