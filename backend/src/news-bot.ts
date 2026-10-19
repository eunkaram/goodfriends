/**
 * 뉴스봇 사이클 — M3(§3)의 심장. 하루에 한 번(worker/news-bot.ts가 호출):
 *
 *   RSS 8개 수집 → 중복 제거(URL UNIQUE + 제목 유사도) → news_articles 기록
 *   → LLM 한국어 요약 → ai-news 카테고리에 봇 계정으로 발행(원문 링크 포함)
 *
 * 실패 정책(§17.3 계열): 소스 하나가 죽어도 사이클 전체는 계쏙 돈다 — 죽은
 * 소스만 error-alert로 알린다. LLM 실패도 마찬가지: 해당 기사만 status='failed'
 * 로 남고 다음 사이클이 재시도한다. 사이클 자체의 크래시(예: DB 죽음)만
 * worker CLI가 잡아 알린다.
 */
import { appPool, ownerPool, queryRaw } from './db.ts';
import { NEWS_SOURCES, fetchFeed, type FeedItem } from './rss.ts';
import { summarizeNewsKorean, escapeHtmlText } from './llm.ts';
import { alertAdminOfError } from './error-alert.ts';
import { createCommunityPost } from './posts.ts';

export const NEWS_CATEGORY_SLUG = 'ai-news';
export const NEWS_BOT_USERNAME = 'ai_news_bot';

/** no-default 모듈 관례(posts.ts와 같다) — 커넥션은 풀 팩토리에서 받는다. */
const pool = appPool('exists');
/** 발행 스펙(§3 "발행 스펙은 운영하며 튜닝") — 운영 중 LLM 품질 보고 조절한다. */
export const NEWS_DEFAULT_SPEC = {
  maxPerCycle: Number(process.env.NEWS_MAX_PER_CYCLE ?? 5),
  /** RSS가 과거 번들까지 주는 경우가 많다 — 이보다 오래된 원문은 건너뛴다. */
  maxAgeDays: 7,
  /** 제목 유사도 문턱 — trigram Jaccard. 0.85 이상이면 "같은 소식 다른 소스"로 본다. */
  titleSimilarityThreshold: 0.85,
  /** 제목 중복 검사 상한(최근 30일) */
  titleWindowDays: 30,
};

export type NewsSource = { key: string; url: string };
export type CycleSpec = typeof NEWS_DEFAULT_SPEC;

/** 테스트가 fetch/요약기/소스를 갈아끼우게 열어둔다 — 네트워크 없이 사이클
 * 전체(수집→요약→발행)를 검증하려는 목적(db.ts ignite 구조와 같은 원칙). */
export type FetchFeedFn = (url: string) => Promise<{ ok: true; feed: unknown } | { ok: false; status: number | null; message: string }>;
export type SummarizeFn = (input: { sourceName: string; title: string; description: string }) => Promise<{ ok: true; value: { krTitle: string; digest: string } } | { ok: false; error: string }>;

/** 제목 유사도 — 정규화(trigram Jaccard). 추가로 normalize는 소문자·연속
 * 공백 축약·구두점 제거. 8자 이하 짧은 제목은 완전일치만 중복으로 본다. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function trigrams(value: string): Set<string> {
  const normalized = normalizeTitle(value).replace(/\s/g, '');
  if (normalized.length < 3) return new Set(normalized ? [normalized] : []);
  const out = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) out.add(normalized.slice(i, i + 3));
  return out;
}

export function titleSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  return intersect / (ta.size + tb.size - intersect);
}

/** 최근 30일 news_articles 제목들과의 유사도 중 최대치 — 문턱 이상이면 중복. */
async function maxTitleSimilarity(title: string, windowDays: number): Promise<number> {
  const rows = await queryRaw<{ title: string }>(
    pool,
    `SELECT title FROM news_articles WHERE created_at > now() - ($1 || ' days')::interval`,
    [String(windowDays)],
  );
  let best = 0;
  for (const r of rows.rows) {
    const sim = titleSimilarity(title, r.title);
    if (sim > best) best = sim;
  }
  return best;
}

async function resolveBotAndCategory(): Promise<{ botId: string; categoryId: string } | null> {
  const rows = await queryRaw<{ bot_id: string; category_id: string }>(
    ownerPool(),
    `SELECT
       (SELECT id FROM users WHERE username = $1) AS bot_id,
       (SELECT id FROM categories WHERE slug = $2 AND is_public) AS category_id`,
    [NEWS_BOT_USERNAME, NEWS_CATEGORY_SLUG],
  );
  const botId = rows.rows[0]?.bot_id;
  const categoryId = rows.rows[0]?.category_id;
  if (!botId || !categoryId) return null;
  return { botId, categoryId };
}

/** 본문 모양 — 요약 단락 + 원문 링크 단락. 원문 링크는 §3의 요구("원문 링크
 * 포함 발행")라 없을 수 없다. link-detect.ts가 <a> 태그를 감지하므로
 * <a href>로 감싼다. */
function toNewsPostBody(digest: string, url: string): string {
  return (
    digest
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtmlText(p)}</p>`)
      .join('\n') + `\n<p>원문: <a href="${escapeHtmlText(url)}" rel="nofollow noopener" target="_blank">${escapeHtmlText(url)}</a></p>`
  );
}

async function insertArticle(sourceKey: string, item: FeedItem): Promise<string | null> {
  // 🔒 url UNIQUE가 첫 방어선 — ON CONFLICT DO NOTHING으로 근본 중복 제거.
  const res = await ownerPool().query<{ id: string }>(
    `INSERT INTO news_articles (source_key, url, title, description, source_published_at, status)
     VALUES ($1, $2, $3, $4, $5, 'new')
     ON CONFLICT (url) DO NOTHING
     RETURNING id`,
    [sourceKey, item.url, item.title, item.description, item.publishedAt],
  );
  return res.rows[0]?.id ?? null;
}

/** 큐 조사 — 방금 수집한 것만이 아니라 남아 있는 status='new'(예전 사이클의
 * LLM 실패 리트라이)도 같은 문으로 처리한다. "소스 장애·LLM 실패가 있어도
 * 다음 날 자기 복구한다"가 이 쿼리 하나로 성립한다. */
async function summarizeQueue(limit: number): Promise<Array<{ id: string; url: string; title: string; description: string; sourceKey: string }>> {
  const rows = await ownerPool().query<{ id: string; url: string; title: string; description: string; source_key: string }>(
    `SELECT id, url, title, COALESCE(description, '') AS description, source_key
     FROM news_articles
     WHERE status = 'new'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.rows.map((r) => ({ id: r.id, url: r.url, title: r.title, description: r.description, sourceKey: r.source_key }));
}

export type NewsCycleResult = {
  fetched: number; // 파싱 성공한 원문 수
  failures: number; // 페치/파싱 실패한 소스 수
  recorded: number; // 신규 기록(news_articles insert 성공)
  discarded: number; // URL/제목 중복, 오래된 원문으로 버린 수
  summarized: number;
  published: number;
  publishFailures: number;
};

export async function runNewsCycle(options: {
  sources?: readonly NewsSource[];
  spec?: Partial<CycleSpec>;
  fetchFeedFn?: FetchFeedFn;
  summarizeFn?: SummarizeFn;
  /** 테스트용 시계 주입(기본 now) */
  now?: Date;
} = {}): Promise<NewsCycleResult> {
  const spec: CycleSpec = { ...NEWS_DEFAULT_SPEC, ...options.spec };
  const sources = options.sources ?? NEWS_SOURCES;
  const fetchFn: FetchFeedFn = options.fetchFeedFn ?? (async (url: string) => await fetchFeed(url));
  const summarize: SummarizeFn = options.summarizeFn ?? (async (input) => await summarizeNewsKorean(input));
  const now = options.now ?? new Date();
  const result: NewsCycleResult = { fetched: 0, failures: 0, recorded: 0, discarded: 0, summarized: 0, published: 0, publishFailures: 0 };

  const endpoints = await resolveBotAndCategory();
  if (!endpoints) {
    await alertAdminOfError(new Error('봇 계정 또는 ai-news 카테고리가 없다(마이그레이션 0051 확인)'), 'news-bot-setup');
    return result;
  }

  // ── 1단계: 수집 + 기록 ──
  for (const source of sources) {
    const fetched = await fetchFn(source.url);
    if (!fetched.ok) {
      result.failures++;
      await alertAdminOfError(new Error(fetched.message), `news-source:${source.key}`);
      continue;
    }
    const feed = fetched.feed as { items?: FeedItem[]; sourceTitle?: string };
    for (const item of feed.items ?? []) {
      result.fetched++;
      if (item.publishedAt && now.getTime() - item.publishedAt.getTime() > spec.maxAgeDays * 24 * 3600 * 1000) {
        result.discarded++;
        continue;
      }
      const similarity = await maxTitleSimilarity(item.title, spec.titleWindowDays);
      if (similarity >= spec.titleSimilarityThreshold) {
        result.discarded++;
        continue;
      }
      const articleId = await insertArticle(source.key, item);
      if (articleId) result.recorded++;
      else result.discarded++;
    }
  }
  // ── 2단계: 큐(방금 기록 + 이전 사이클 남은 'new')를 요약 + 발행 ──
  const queue = await summarizeQueue(spec.maxPerCycle);

  for (const entry of queue) {
    const summarized = await summarize({
      sourceName: entry.sourceKey,
      title: entry.title,
      description: entry.description,
    });
    if (!summarized.ok) {
      result.summarized++;
      await ownerPool().query(
        `UPDATE news_articles SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [entry.id, summarized.error.slice(0, 500)],
      );
      continue;
    }
    result.summarized++;
    const post = await createCommunityPost(endpoints.botId, {
      categoryId: endpoints.categoryId,
      title: summarized.value.krTitle,
      body: toNewsPostBody(summarized.value.digest, entry.url),
    });
    if (post.ok) {
      result.published++;
      await ownerPool().query(
        `UPDATE news_articles SET status = 'published', kr_title = $2, digest = $3, post_id = $4, updated_at = now() WHERE id = $1`,
        [entry.id, summarized.value.krTitle, summarized.value.digest, post.id],
      );
    } else {
      result.publishFailures++;
      await ownerPool().query(
        `UPDATE news_articles SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [entry.id, `post insert ${post.error}`],
      );
    }
  }
  return result;
}

