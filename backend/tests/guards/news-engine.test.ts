/**
 * M3 뉴스 엔진 단위/가드 테스트 — RSS 파서, 제목 유사도, LLM stub 결정성,
 * 사이클 전체(수집→중복제거→요약→봇 발행)를 네트워크 없이 검증한다.
 * 의존성은 fetchFeedFn/summarizeFn 주입으로 끊는다(news-bot.ts 참조).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { parseFeedXml, stripHtml, type FeedItem } from '../../src/rss.ts';
import { normalizeTitle, titleSimilarity, trigrams, runNewsCycle, NEWS_BOT_USERNAME, NEWS_CATEGORY_SLUG } from '../../src/news-bot.ts';
import { digestDraftStub, summarizeNewsStub, escapeHtmlText, type SummarizedNews } from '../../src/llm.ts';
import { ownerPool } from '../../src/db.ts';

/** 테스트용 요약기 — 상용 stub을 SummarizeFn 계약({ok,value})으로 감싼다. */
async function stubSummarizer(input: { sourceName: string; title: string; description: string }): Promise<{ ok: true; value: SummarizedNews }> {
  return { ok: true, value: summarizeNewsStub(input) };
}

const RSS_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>TestCrunch AI</title>
<item><title><![CDATA[Ghost Deps & CI: pnpm 10 tips]]></title><link>https://example.test/news/ghost-deps</link>
<description><![CDATA[A short &amp; useful guide to <b>ghost deps</b>.]]></description><pubDate>Fri, 16 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Old article from last month</title><link>https://example.test/news/old</link><description>stale</description>
<pubDate>Mon, 01 Sep 2025 09:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>TestBlog</title>
<entry><title>Agent SDK deep dive</title>
<link rel="alternate" href="https://example.test/blog/agent-sdk"/><link rel="self" href="https://example.test/blog/agent-sdk-self"/>
<summary>&lt;p&gt;Deep dive into agent SDK internals&lt;/p&gt;</summary><updated>2026-10-17T12:00:00Z</updated></entry>
</feed>`;

let owner: pg.Pool;

beforeAll(async () => {
  owner = ownerPool();
  // 봇 계정·카테고리는 0051/0049가 시드 — 있어야 사이클이 돈다.
  const bots = await owner.query<{ username: string }>(`SELECT username FROM users WHERE username IN ('ai_news_bot','ai_digest_bot')`);
  expect(bots.rows.map((r) => r.username).sort()).toEqual(['ai_digest_bot', 'ai_news_bot']);
  // 공유 DB 위생 — 다른 파일이 남긴 'new' 큐와 본 테스트의 잔해를 치운다.
  await owner.query(`UPDATE news_articles SET status = 'failed' WHERE status = 'new'`);
  await owner.query(`DELETE FROM news_articles WHERE url LIKE 'https://example.test/%' OR url LIKE 'https://busy.test/%' OR url LIKE 'https://calm.test/%' OR url LIKE 'https://side.test/%'`);
  await owner.query(`DELETE FROM posts WHERE author_id = (SELECT id FROM users WHERE username = 'ai_news_bot') AND (title LIKE '%Ghost Deps%' OR title LIKE '%Agent SDK%' OR title LIKE '%OpenAI ships%' OR title LIKE '%Anthropic%' OR title LIKE '%EU drafts%' OR title LIKE '%agent maturity%' OR title LIKE '%Google expands%' OR title LIKE '%Meta opens%' OR title LIKE '%Nvidia packages%' OR title LIKE '%MIT survey%' OR title LIKE '%Stanford benchmark%' OR title LIKE '%Hugging Face adds%' OR title LIKE '%ArXiv trend%')`);
});

afterAll(async () => {
  // 발행된 봇 글 + 수집 로그 정리(테스트 프리픽스만)
  await owner.query(
    `DELETE FROM news_articles WHERE (source_key = 'test:fixture' AND url LIKE 'https://example.test/%') OR url LIKE 'https://example.test/%'`,
  );
  await owner.query(
    `DELETE FROM posts WHERE author_id = (SELECT id FROM users WHERE username = 'ai_news_bot') AND (title LIKE '%OpenAI ships%' OR title LIKE '%Anthropic%' OR title LIKE '%EU drafts%' OR title LIKE '%agent maturity%' OR title LIKE '%Ghost Deps%' OR title LIKE '%Agent SDK%')`,
  );
  await owner.end();
});

describe('RSS/Atom 파서', () => {
  it('RSS 2.0 — CDATA·엔티티·pubDate', () => {
    const feed = parseFeedXml(RSS_XML);
    expect(feed.sourceTitle).toBe('TestCrunch AI');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0].title).toBe('Ghost Deps & CI: pnpm 10 tips');
    expect(feed.items[0].url).toBe('https://example.test/news/ghost-deps');
    expect(feed.items[0].description).toBe('A short & useful guide to ghost deps.');
    expect(feed.items[0].publishedAt?.toISOString()).toBe('2026-10-16T09:00:00.000Z');
  });

  it('Atom — rel=alternate를 대표 링크로, updated 날짜', () => {
    const feed = parseFeedXml(ATOM_XML);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].url).toBe('https://example.test/blog/agent-sdk');
    expect(feed.items[0].description).toBe('Deep dive into agent SDK internals');
    expect(feed.items[0].publishedAt?.toISOString()).toBe('2026-10-17T12:00:00.000Z');
  });

  it('title/link 없는 항목은 버린다', () => {
    const empty = parseFeedXml('<rss><channel><item><description>x</description></item><item><title>t</title></item></channel></rss>');
    expect(empty.items).toHaveLength(0);
  });

  it('stripHtml — 태그 제거, 엔티티 복원', () => {
    expect(stripHtml('<p>hello <b>world</b> &amp; &lt;tags&gt;</p>')).toBe('hello world & <tags>');
  });
});

describe('제목 유사도(중복 제거 기준)', () => {
  it('같은 소식 다른 문구 — 문턱 이상', () => {
    const sim = titleSimilarity('pnpm 10: faster CI with ghost deps', 'pnpm 10 — faster CI with ghost deps!');
    expect(sim).toBeGreaterThan(0.8);
  });

  it('다른 소식 — 문턱 이하', () => {
    expect(titleSimilarity('pnpm 10: faster CI with ghost deps', 'OpenAI announces GPT-6 for 2027')).toBeLessThan(0.3);
  });

  it('normalize — 케이스/문장부호 무시', () => {
    expect(normalizeTitle('Hello, World!')).toBe(normalizeTitle('hello world'));
    expect(trigrams('ab')).toEqual(new Set(['ab']));
  });
});

describe('LLM stub(키 없는 환경 결정성)', () => {
  it('요약 stub — 항상 krTitle+digest를 준다', () => {
    const out = summarizeNewsStub({ sourceName: 'TestCrunch AI', title: 'Ghost deps', description: 'guide' });
    expect(out.krTitle).toBe('Ghost deps');
    expect(out.digest).toContain('TestCrunch AI');
    expect(out.digest).toContain('guide');
  });

  it('다이제스트 stub — 항목 없으면 빈 상태 문장', () => {
    const out = digestDraftStub({ dateLabel: '2026-10-18', activities: [] });
    expect(out.title).toBe('오늘의 AI 화제 — 2026-10-18');
    expect(out.content).toContain('새 활동이 없었다');
  });

  it('escapeHtmlText — 발행 본문 이스케이프', () => {
    expect(escapeHtmlText('<img onerror="x">')).not.toContain('<img');
  });
});

describe('뉴스봇 사이클(neon 없는 검증 — fixture 주입)', () => {
  const feedOne: FeedItem[] = [
    { url: 'https://example.test/news/ghost-deps', title: 'Ghost Deps & CI: pnpm 10 tips', description: 'A useful guide.', publishedAt: new Date('2026-10-16T09:00:00Z') },
  ];
  const feedTwo: FeedItem[] = [
    { url: 'https://example.test/blog/agent-sdk', title: 'Agent SDK deep dive', description: 'Deep dive.', publishedAt: new Date('2026-10-17T12:00:00Z') },
  ];

  const FEED_URLS = {
    one: 'https://example.test/feed/one',
    two: 'https://example.test/feed/two',
  };

  /** URL별로 다른 피드를 내는 페처 — 소스 2개가 각기 다른 원문을 주는 상황 */
  function fetcherFor(map: Record<string, FeedItem[]>) {
    return async (url: string) => {
      const items = map[url];
      if (!items) return { ok: false as const, status: null, message: `no fixture for ${url}` };
      return { ok: true as const, feed: { sourceTitle: 'TestCrunch', items } };
    };
  }

  async function countBotPosts(): Promise<number> {
    const res = await owner.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM posts p
       JOIN users u ON u.id = p.author_id
       JOIN categories c ON c.id = p.category_id
       WHERE u.username = $1 AND c.slug = $2 AND p.title != '제목 없음'`,
      [NEWS_BOT_USERNAME, NEWS_CATEGORY_SLUG],
    );
    return Number(res.rows[0].count);
  }

  it('사이클: 두 소스가 각각 1건씩 발행된다(원문 링크 포함)', async () => {
    const before = await countBotPosts();
    const result = await runNewsCycle({
      sources: [
        { key: 'test:fixture', url: FEED_URLS.one },
        { key: 'test:fixture', url: FEED_URLS.two },
      ],
      spec: { maxPerCycle: 5, maxAgeDays: 30 },
      fetchFeedFn: fetcherFor({ [FEED_URLS.one]: feedOne, [FEED_URLS.two]: feedTwo }),
      summarizeFn: stubSummarizer,
    });
    expect(result.failures).toBe(0);
    expect(result.recorded).toBe(2);
    expect(result.published).toBe(2);
    expect(await countBotPosts()).toBe(before + 2);

    const posts = await owner.query<{ body: string; author_username: string; category_slug: string }>(
      `SELECT p.body, u.username AS author_username, c.slug AS category_slug
       FROM posts p JOIN users u ON u.id = p.author_id JOIN categories c ON c.id = p.category_id
       WHERE u.username = $1 AND c.slug = $2 AND (p.title LIKE '%Ghost Deps%' OR p.title LIKE '%Agent SDK%')`,
      [NEWS_BOT_USERNAME, NEWS_CATEGORY_SLUG],
    );
    expect(posts.rows).toHaveLength(2);
    for (const row of posts.rows) {
      expect(row.author_username).toBe(NEWS_BOT_USERNAME);
      expect(row.category_slug).toBe(NEWS_CATEGORY_SLUG);
      expect(row.body).toMatch(/원문: <a href="https:\/\/example\.test\//);
    }
  });

  it('2회차: URL dedup — 같은 소식 재발행 없다', async () => {
    const before = await countBotPosts();
    const result = await runNewsCycle({
      sources: [
        { key: 'test:fixture', url: FEED_URLS.one },
        { key: 'test:fixture', url: FEED_URLS.two },
      ],
      spec: { maxPerCycle: 5, maxAgeDays: 30 },
      fetchFeedFn: fetcherFor({ [FEED_URLS.one]: feedOne, [FEED_URLS.two]: feedTwo }),
      summarizeFn: stubSummarizer,
    });
    expect(result.recorded).toBe(0);
    expect(result.discarded).toBe(2); // UNIQUE + 'new' 큐가 비어 skip
    expect(result.published).toBe(0);
    expect(await countBotPosts()).toBe(before);
  });

  it('소스 죽음 — 사이클이 죽지 않고 failures만 센다', async () => {
    const result = await runNewsCycle({
      sources: [{ key: 'test:dead', url: 'https://dead.test/feed' }],
      fetchFeedFn: async () => ({ ok: false, status: 503, message: 'HTTP 503 for https://dead.test/feed' }),
      summarizeFn: stubSummarizer,
    });
    expect(result.failures).toBe(1);
    expect(result.recorded).toBe(0);
  });

  it('소스 편중 완화(운영 튜닝) — 한 소스가 큐를 독식해도 발행은 소스 간 분산', async () => {
    // 🔒 제목은 목 유사도 문턱(0.85)을 통과할 만큼 서로 달라야 한다 — "#0/#1"처럼
    // 한 글자 다른 합성 제목은 같은 소식으로 버려진다(유사도 타당한 부작용).
    const busyTitles = [
      'OpenAI ships reasoning mode for enterprise workloads',
      'Anthropic releases tool-use tracing for agents',
      'Google expands Gemini function calling to all devs',
      'Meta opens Llama APIs for commercial fine-tuning',
      'Nvidia packages inference runtime for cloud vendors',
    ];
    const calmTitles = [
      'EU drafts rules for model training disclosures',
      'MIT survey finds adoption barriers in small teams',
      'Stanford benchmark shows a sharp jump in long context',
      'Hugging Face adds reproducible eval suites',
      'ArXiv trend: retrieval beats fine-tuning again',
    ];
    const busy: FeedItem[] = busyTitles.map((title, i) => ({
      url: `https://example.test/news/busy-${i}`,
      title,
      description: `busy desc ${i}`,
      publishedAt: new Date(new Date('2026-10-17T12:30:00Z').getTime() + i * 60_000),
    }));
    const calm: FeedItem[] = calmTitles.map((title, i) => ({
      url: `https://example.test/blog/calm-${i}`,
      title,
      description: `calm desc ${i}`,
      publishedAt: new Date(new Date('2026-10-16T12:30:00Z').getTime() + i * 60_000),
    }));
    const side: FeedItem[] = [
      { url: 'https://example.test/journal/side-0', title: 'Side journal: agent maturity report', description: 'side desc 0', publishedAt: new Date('2026-10-15T12:30:00Z') },
    ];
    const before = await countBotPosts();
    const startedAt = new Date();
    const result = await runNewsCycle({
      sources: [
        { key: 'test:busy', url: 'https://busy.test/feed' },
        { key: 'test:calm', url: 'https://calm.test/feed' },
        { key: 'test:side', url: 'https://side.test/feed' },
      ],
      spec: { maxPerCycle: 3, maxAgeDays: 30 },
      fetchFeedFn: fetcherFor({ 'https://busy.test/feed': busy, 'https://calm.test/feed': calm, 'https://side.test/feed': side }),
      summarizeFn: stubSummarizer,
    });
    expect(result.recorded).toBe(11);
    expect(result.published).toBe(3);
    const srcs = await owner.query<{ source_key: string }>(
      `SELECT DISTINCT na.source_key
       FROM news_articles na
       WHERE na.url LIKE 'https://example.test/%' AND na.status = 'published' AND na.created_at > $1`,
      [startedAt],
    );
    // 발행 3건이 라운드로빈으로 3소스에 골고루 간다(대량 소스가 독식하지 않음)
    const keys = srcs.rows.map((r) => r.source_key).sort();
    expect(keys).toEqual(['test:busy', 'test:calm', 'test:side']);
    expect(await countBotPosts()).toBe(before + 3);
  });
});
