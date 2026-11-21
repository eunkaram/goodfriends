import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ArticleContent } from './types.js';
import { RobotsChecker } from './robots.js';
import { HttpClient } from './sources/http.js';
import { toIso } from './sources/xml.js';

/** 이 길이 미만이면 본문 추출 실패로 본다. */
export const MIN_ARTICLE_CHARS = 200;
/** LLM에 넘길 본문 상한(메모리·토큰 보호). */
export const MAX_ARTICLE_CHARS = 60000;
const MAX_IMAGES = 12;

export interface FetchArticleDeps {
  http: HttpClient;
  /** 필수: robots.txt 확인 없이 임의 사이트를 가져오지 못하게 타입으로 강제한다(생략 불가). */
  robots: RobotsChecker;
}

export interface FetchArticleHint {
  /** 후보가 가진 요약/초록. arXiv·HF 논문·HN 토론처럼 초록만 쓰는 URL은 이걸 본문으로 쓴다. */
  title?: string;
  summary?: string;
  publishedAt?: string | null;
}

function isArxivAbs(u: URL): boolean {
  return /(^|\.)arxiv\.org$/.test(u.hostname) && /^\/abs\//.test(u.pathname);
}

/** 본문이 사실상 초록뿐인 페이지(Readability가 못 읽거나 읽어도 가치 없음). */
function isAbstractOnly(u: URL): boolean {
  return isArxivAbs(u) || (u.hostname === 'huggingface.co' && u.pathname.startsWith('/papers/')) || (u.hostname === 'news.ycombinator.com' && u.pathname === '/item');
}

function clean(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 응답 인코딩: Content-Type charset → <meta charset> → UTF-8. 알 수 없는 라벨이면 UTF-8. */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function absolutize(src: string | null | undefined, base: string): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s || s.startsWith('data:') || s.startsWith('blob:')) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function metaContent(doc: any, selector: string): string | null {
  const el = doc.querySelector(selector);
  const v = el?.getAttribute('content');
  return v && v.trim() ? v.trim() : null;
}

function jsonLdDate(doc: any): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')) as any[]) {
    try {
      const data = JSON.parse(s.textContent || '');
      const nodes = Array.isArray(data) ? data : [data, ...(Array.isArray(data?.['@graph']) ? data['@graph'] : [])];
      for (const n of nodes) {
        const d = toIso(n?.datePublished);
        if (d) return d;
      }
    } catch {
      /* 깨진 JSON-LD는 무시 */
    }
  }
  return null;
}

/** 순수 함수: HTML 문자열 → 본문 추출. 네트워크 없음(테스트 대상). */
export function extractArticle(html: string, pageUrl: string): ArticleContent | null {
  const { document } = parseHTML(html);

  // Readability는 문서를 변형하므로 메타는 먼저 읽는다.
  const baseHref = absolutize(document.querySelector('base[href]')?.getAttribute('href'), pageUrl) ?? pageUrl;
  const ogImage = absolutize(metaContent(document, 'meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]'), baseHref);
  const ogTitle = metaContent(document, 'meta[property="og:title"]');
  const ogSite = metaContent(document, 'meta[property="og:site_name"]');
  const published =
    toIso(metaContent(document, 'meta[property="article:published_time"], meta[name="article:published_time"], meta[name="date"], meta[name="pubdate"], meta[itemprop="datePublished"], meta[name="citation_publication_date"], meta[name="citation_date"]')) ??
    toIso(document.querySelector('time[datetime]')?.getAttribute('datetime')) ??
    jsonLdDate(document);

  const article = new Readability(document as any, { charThreshold: 100 }).parse();
  if (!article) return null;
  const text = clean(article.textContent || '');
  if (text.length < MIN_ARTICLE_CHARS) return null;

  const images: string[] = [];
  if (article.content) {
    const { document: body } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
    for (const img of Array.from(body.querySelectorAll('img')) as any[]) {
      const abs = absolutize(img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'), baseHref);
      if (abs && !images.includes(abs) && abs !== ogImage) images.push(abs);
      if (images.length >= MAX_IMAGES) break;
    }
  }

  let siteName = article.siteName || ogSite || null;
  if (!siteName) {
    try {
      siteName = new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      siteName = null;
    }
  }

  return {
    url: pageUrl,
    title: (article.title || ogTitle || '').trim(),
    text: text.slice(0, MAX_ARTICLE_CHARS),
    publishedAt: published ?? toIso(article.publishedTime),
    siteName,
    images,
    ogImage,
  };
}

/** arXiv abs 페이지 → 제목·초록(blockquote.abstract). */
export function extractArxivAbs(html: string, pageUrl: string): ArticleContent | null {
  const { document } = parseHTML(html);
  const title = metaContent(document, 'meta[name="citation_title"]') ?? document.querySelector('h1.title')?.textContent?.replace(/^Title:\s*/i, '').trim() ?? '';
  const abs = document.querySelector('blockquote.abstract')?.textContent?.replace(/^\s*Abstract:\s*/i, '') ?? metaContent(document, 'meta[name="citation_abstract"]') ?? '';
  const text = clean(abs);
  if (!title || text.length < 50) return null;
  return {
    url: pageUrl,
    title,
    text,
    publishedAt: toIso(metaContent(document, 'meta[name="citation_date"], meta[name="citation_online_date"]')),
    siteName: 'arXiv',
    images: [],
    ogImage: null, // arXiv 기본 og:image는 로고라 글감으로 쓸 수 없다
  };
}

/**
 * URL → 원문. 실패(robots 차단·HTTP 오류·비HTML·본문 추출 실패·예외)는 전부 null.
 * hint.summary가 있는 초록 전용 URL(arXiv abs, HF papers, HN 토론)은 네트워크 없이 초록을 본문으로 쓴다.
 */
export async function fetchArticle(url: string, deps: FetchArticleDeps, hint: FetchArticleHint = {}): Promise<ArticleContent | null> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;

    if (isAbstractOnly(u) && hint.summary && hint.summary.trim().length >= 80) {
      return {
        url,
        title: hint.title ?? '',
        text: clean(hint.summary),
        publishedAt: hint.publishedAt ?? null,
        siteName: isArxivAbs(u) ? 'arXiv' : u.hostname.replace(/^www\./, ''),
        images: [],
        ogImage: null,
      };
    }

    // JS 호출·타입 우회로 robots가 빠져도 가져오지 않는다(fail-closed).
    if (typeof deps.robots?.isAllowed !== 'function') return null;
    if (!(await deps.robots.isAllowed(url))) return null;

    const res = await deps.http.request(url, { Accept: 'text/html,application/xhtml+xml' });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type');
    if (ctype && !/html|xml/i.test(ctype)) return null;
    const html = decodeBody(new Uint8Array(await res.arrayBuffer()), ctype);

    const finalUrl = res.url || url;
    return isArxivAbs(u) ? extractArxivAbs(html, finalUrl) : extractArticle(html, finalUrl);
  } catch {
    return null;
  }
}
