/**
 * RSS/Atom 최소 파서 — M3 뉴스봇(§3)의 수집 단계. deps를 늘리지 않기 위해
 * regex 기반으로 짰다: 새 의존성을 받아 쓸 것 없이, 8개 소스가 RSS 2.0과
 * Atom 둘 중 하나라는 제한된 입력만 다룬다. 각 소스 서버가 계속 살아 있다는
 * 보장은 없다 — 실패는 라우트 404처럼 "아무 일 없던 일"이 아니라
 * 운영자에게 알려야 할 상태다(news-bot.ts가 alertAdminOfError로 알린다).
 *
 * 실측 기준 다루는 케이스:
 *  - RSS 2.0: <channel><item><title><link><description><pubDate>
 *  - Atom: <feed><entry><title><link href="..."/><summary>|<content><updated>
 *  - CDATA 래핑 + 기본 5개 HTML 엔티티
 *  - title/link 없는 항목은 버린다(발행에 쓸 수 없다)
 */
import type { IncomingMessage } from 'node:http';

export type FeedItem = {
  url: string;
  title: string;
  description: string;
  publishedAt: Date | null;
};

export type ParsedFeed = {
  sourceTitle: string;
  items: FeedItem[];
};

/** 🔒 M3 실용 선택 — CDATA/엔티티만 푼다. 원문 HTML 태그(title/description에
 * 가끔 섞인다)는 남겨두고 나중에 stripHtml로 제거 — 발행 본문을 만들 때
 * 이스케이프 걱정을 한 곳으로 모으기 위해서다. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function pickTag(block: string, tag: string): string | null {
  // 🔒 <link>는 Atom에서 self-closing(href 속성)으로 온다 — 두 모양 다 지원.
  const attr = block.match(new RegExp(`<${tag}\\s+(?:[^>]*?)href=["']([^"']+)["'][^>]*>`, 'i'));
  if (attr) return decodeEntities(attr[1]).trim();
  const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plain ? decodeEntities(plain[1]).trim() : null;
}

function cleanupText(value: string): string {
  return stripHtml(value).replace(/\s+/g, ' ').trim();
}

export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''));
}

/** RSS 2.0 pubDate(RFC 822)와 Atom date(ISO 8601) 둘 다 Date로 — 못 읽으면 null. */
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFeedXml(xml: string): ParsedFeed {
  // 🔒 문서 레벨 title(channel/feed 제목)은 "첫 <item|entry> 앞쪽"에서만
  // 찾는다 — 전체 문서에서 찾으면 CDATA가 걸린 item 제목을 피드 제목으로
  // 잘못 가져간다(테스트에서 실측).
  const headEnd = /<(?:item|entry)[\s>]/.exec(xml)?.index ?? xml.length;
  const sourceTitle = cleanupText(pickTag(xml.slice(0, headEnd), 'title') ?? '');

  // <item>은 RSS, <entry>는 Atom — 항상 둘 중 하나만 나온다.
  const blocks = [...xml.matchAll(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/g)].map((m) => m[0]);
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const rawTitle = pickTag(block, 'title');
    const rawLink = pickTag(block, 'link');
    if (!rawTitle || !rawLink) continue;

    // 🔒 Atom의 대표 link(<link rel="..."> 여러 개)에서 rel=alternate를
    // 선호 — regex pickTag는 첫 <link>를 가져가므로, rel이 붙으면 대표
    // 링크가 아닐 수 있다. blocks에서 link 태그 전체를 다시 훑어 alternate를
    // 찾고, 없으면 첫 번째를 쓴다.
    const linkMatch = /<link\b[^>]*>/gi;
    let preferredLink: string | null = null;
    let altLink: string | null = null;
    let plainLink: string | null = null;
    let tagMatch = linkMatch.exec(block);
    while (tagMatch) {
      const tag = tagMatch[0];
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (href) {
        if (/rel=["']alternate["']/i.test(tag)) altLink = decodeEntities(href).trim();
        else if (!/rel=/i.test(tag)) plainLink = decodeEntities(href).trim();
      }
      tagMatch = linkMatch.exec(block);
    }
    preferredLink = altLink ?? plainLink ?? rawLink;
    if (!/^https?:\/\//i.test(preferredLink)) continue;

    const description = cleanupText(
      pickTag(block, 'description') ?? pickTag(block, 'summary') ?? pickTag(block, 'content') ?? '',
    );

    items.push({
      url: preferredLink,
      title: cleanupText(rawTitle),
      description,
      publishedAt: parseDate(pickTag(block, 'pubDate') ?? pickTag(block, 'published') ?? pickTag(block, 'updated')),
    });
  }
  return { sourceTitle, items };
}

export type FetchFeedResult =
  | { ok: true; feed: ParsedFeed }
  | { ok: false; status: number | null; message: string };

/** 실제 네트워크 페치 — worker(이 모듈을 import하는 뉴스봇)가 쓰고, 테스트는
 * 이 함수를 소스별로 갈아 끼운다(news-bot.ts의 주입 구조, db.ts의 env 로딩
 * 주입과 같은 원칙). 태그가 ring-buffer(500)보다 작아 AbortController로
 * 15초 타임아웃을 둔다. */
export async function fetchFeed(url: string): Promise<FetchFeedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'goodfriends-bot/1.0 (+news fetcher)' },
    });
    if (!res.ok) return { ok: false, status: res.status, message: `HTTP ${res.status} for ${url}` };
    const xml = await res.text();
    return { ok: true, feed: parseFeedXml(xml) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: null, message: `fetch failed for ${url}: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** worker에서 소스 리스트 — plan §3에 고정된 8개. source_key는 유저 안 보는
 * 내부 식별자로 news_articles.source_key에 적힌다. mock:true는 Parity —
 * 실서버에서는 fetchFeed를 그대로 쓰고, 테스트만 갈아끼운다. */
export const NEWS_SOURCES = [
  { key: 'techcrunch-ai', url: 'https://techcrunch.com/category/artificial-intelligence-2/feed/' },
  { key: 'theverge-ai', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { key: 'mit-tr-ai', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { key: 'marktechpost', url: 'https://www.marktechpost.com/feed/' },
  { key: 'hf-blog', url: 'https://huggingface.co/blog/feed.xml' },
  { key: 'openai-news', url: 'https://openai.com/news/rss.xml' },
  { key: 'arxiv-cs-ai', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { key: 'arxiv-cs-cl', url: 'https://rss.arxiv.org/rss/cs.CL' },
] as const;
