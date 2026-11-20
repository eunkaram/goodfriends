import type { WebSearchResult } from '../types.js';
import type { ResearchSource } from './sources.js';

/** 표준 RSS 2.0 XML에서 <item> 단위로 title/link(+ 있으면 이미지) 추출. CDATA 유무 모두 지원. */
export function parseRssFeed(xml: string, sourceName: string, max = 5): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  const blocks = xml.split('<item>').slice(1);

  for (const block of blocks) {
    if (items.length >= max) break;

    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const title = titleMatch?.[1]?.trim();
    const url = linkMatch?.[1]?.trim();

    if (title && url) {
      const enclosureMatch = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image\/[^"]*"/);
      const mediaMatch = block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/);
      const imageUrl = enclosureMatch?.[1] || mediaMatch?.[1] || undefined;
      items.push({ title, url, snippet: title, source: sourceName, imageUrl });
    }
  }

  return items;
}

/**
 * source.listPattern(named capture group 사용: href, title, 선택적으로 image)으로
 * 게시판 HTML에서 (링크, 제목, 있으면 썸네일 이미지) 목록 추출.
 */
export function parseHtmlBoard(html: string, source: ResearchSource, max = 5): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  if (!source.listPattern) return items;

  const flags = source.listPattern.flags.includes('g') ? source.listPattern.flags : `${source.listPattern.flags}g`;
  const regex = new RegExp(source.listPattern.source, flags);

  let match: RegExpExecArray | null;
  while (items.length < max && (match = regex.exec(html)) !== null) {
    const rawHref = match.groups?.href;
    const innerHtml = match.groups?.title;
    if (!rawHref || !innerHtml) continue;

    // title 그룹은 <a>...</a> 내부 원본 HTML일 수 있음(예: 뽐뿌는 제목이 <font>로 감싸져 있음) —
    // 중첩 태그를 항상 벗겨내고 순수 텍스트만 남긴다.
    const rawTitle = innerHtml
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
    if (rawTitle.length < 4 || rawTitle.length > 200) continue;

    const url = /^https?:\/\//.test(rawHref) ? rawHref : `${source.linkBaseUrl || ''}${rawHref}`;
    const imageUrl = match.groups?.image || undefined;
    items.push({ title: rawTitle, url, snippet: rawTitle, source: source.name, imageUrl });
  }

  return items;
}

/** enabled인 소스 중 categories와 하나라도 겹치는 카테고리를 가진 소스만 필터링. */
export function pickMatchingSources(sources: ResearchSource[], categories: string[]): ResearchSource[] {
  return sources.filter((s) => s.enabled && s.categories.some((c) => categories.includes(c)));
}

// 이미지만 있고 텍스트가 없는 게시글(뽐뿌 등)에서 실제로 확인함 — 사이트가 자동으로 이런
// 안내 문구를 <meta name="description">에 채워 넣는데, 이걸 본문으로 그대로 쓰면 "링크를
// 확인하라"면서 정작 링크는 없는 이상한 글이 된다(실제 라이브 사고: "여기를 눌러 링크를
// 확인하세요"만 있는 게시글). 실제 내용이 아니므로 걸러낸다.
const NON_CONTENT_PLACEHOLDERS = ['여기를 눌러 링크를 확인하세요', '여기를 눌러주세요', '내용을 확인해보세요', '클릭하여 확인하세요'];

/**
 * 개별 글/기사 페이지 HTML에서 <meta name="description"> 콘텐츠를 추출한다. 뉴스든 커뮤니티
 * 게시판이든 검색엔진/공유 미리보기용으로 공개 제공되는 요약이라 "퍼온글"을 원문 그대로
 * 포스팅할 때 이걸 본문으로 쓴다. 없거나 사이트 자체의 안내 문구뿐이면 null.
 */
export function parseMetaDescription(html: string): string | null {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  if (!match) return null;

  const description = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
  if (!description) return null;
  if (NON_CONTENT_PLACEHOLDERS.includes(description)) return null;

  return description;
}

/**
 * 개별 글/기사 페이지 HTML에서 <meta property="og:image"> 콘텐츠를 추출한다. 링크 공유 시
 * 미리보기 이미지로 쓰라고 공개 제공되는 태그라 뉴스든 커뮤니티 게시판이든 거의 다 있음
 * (전자신문/뽐뿌/인벤 전부 실제로 확인함 — 목록 페이지엔 썸네일이 없는 소스도 개별 글
 * 페이지엔 og:image가 있는 경우가 많아 이미지 커버리지를 넓히는 데 씀). 없으면 null.
 */
export function parseMetaImage(html: string): string | null {
  const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i);
  if (!match) return null;

  const url = match[1].replace(/&amp;/g, '&').trim();
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}

export interface BodySegment {
  type: 'text' | 'image';
  value: string;
}

const MAX_BODY_WITH_MEDIA_LENGTH = 1500;

/**
 * HTML 조각(article/게시글 본문 컨테이너 안쪽)을 텍스트/미디어 세그먼트로, 원래 등장 순서
 * 그대로 쪼갠다. 동영상(<video><source src>)도 이미지와 동일하게 media 취급 — 우리 쪽은
 * URL만 그 자리에 남기면 goodfriends가 알아서 렌더링하거나 최소한 원문 순서는 보존됨(사용자 요청:
 * "이미지/미디어 위치를 그대로 보존하라"). 텍스트 구간 안의 <a href> 외부 링크도
 * preserveExternalLinks로 URL을 살려서 남긴다(2026-09-10, 아래 참고).
 */
export function parseBodyWithMedia(html: string): BodySegment[] {
  const segments: BodySegment[] = [];
  // video는 <source>가 여러 개(포맷 대체용)일 수 있고 "Your browser does not support..."
  // 같은 폴백 텍스트도 포함돼 있어서, 첫 <source> src만 뽑되 </video>까지 통째로 소비해야
  // 그 폴백 텍스트가 본문에 섞여 들어가지 않는다.
  const mediaRegex = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>|<video[\s\S]*?<source[^>]*\ssrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/video>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mediaRegex.exec(html)) !== null) {
    const textChunk = stripHtmlToText(html.slice(lastIndex, match.index));
    if (textChunk) segments.push({ type: 'text', value: textChunk });

    const rawUrl = match[1] || match[2];
    segments.push({ type: 'image', value: rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl });

    lastIndex = mediaRegex.lastIndex;
  }

  const tail = stripHtmlToText(html.slice(lastIndex));
  if (tail) segments.push({ type: 'text', value: tail });

  return segments;
}

// <a href> 태그를 일반 태그와 똑같이 벗겨내면 방문 링크(예: "구매링크: <a href="...">여기</a>")의
// href가 통째로 사라지고 화면에 보이던 텍스트만 남는다(2026-09-10 실제로 겪음: 이미지/동영상
// 위치는 보존하면서 정작 본문에 있던 외부 링크는 버리고 있었음). 내부 상대경로/앵커(#)는
// "외부링크"가 아니니 그대로 버리고, 절대경로 http(s) 링크만 URL을 텍스트 옆에 남겨서 보존한다.
function preserveExternalLinks(html: string): string {
  return html.replace(/<a[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!/^https?:\/\//i.test(href)) return text;
    return text && text !== href ? `${text} (${href})` : href;
  });
}

function stripHtmlToText(html: string): string {
  return preserveExternalLinks(html)
    .replace(/<figcaption>[\s\S]*?<\/figcaption>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * segments를 실제 포스팅 본문 문자열로 합친다 — 미디어는 그 위치 그대로 한 줄로 남는다.
 * 원문이 지나치게 길 수 있어서(뽐뿌 실시간 속보 글 등) 대략 MAX_BODY_WITH_MEDIA_LENGTH자
 * 근처에서 세그먼트 단위로 자른다(URL이나 문장 중간을 자르지 않기 위해 세그먼트 경계에서만 자름).
 */
export function segmentsToBody(segments: BodySegment[], maxLength = MAX_BODY_WITH_MEDIA_LENGTH): string {
  const parts: string[] = [];
  let length = 0;

  for (const seg of segments) {
    if (!seg.value) continue;
    if (parts.length > 0 && length + seg.value.length > maxLength) break;
    parts.push(seg.value);
    length += seg.value.length;
  }

  return parts.join('\n\n');
}

// 한국 뉴스 기사 말미의 기자 바이라인(예: "서희원 기자 shw@etnews.com") 제거용. 실제 개인정보가
// 아니라 기자 공개 연락처지만, content-gate.ts의 PII 이메일 필터가 구분 못 하고 퍼온글 전체를
// 차단해버린다(2026-09-06 실제로 겪음: etnews 기사가 매번 이 이유로 스킵됨). 필터를 느슨하게
// 푸는 대신(진짜 개인 이메일도 놓칠 수 있음) 원천에서 바이라인만 잘라내는 쪽을 택했다.
const REPORTER_BYLINE_REGEX = /\n?\S{2,10}\s*기자\s+[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*$/;

function stripReporterByline(text: string): string {
  return text.replace(REPORTER_BYLINE_REGEX, '').trimEnd();
}

/**
 * source.bodyPattern(named capture group "body")으로 개별 글 페이지에서 실제 본문 컨테이너를
 * 잘라낸 뒤 텍스트/미디어를 원래 순서대로 합친 문자열을 만든다. 못 찾거나 내용이 비면 null.
 */
export function parseArticleBody(html: string, bodyPattern: RegExp): { body: string; hasMedia: boolean } | null {
  const match = html.match(bodyPattern);
  const fragment = match?.groups?.body;
  if (!fragment) return null;

  const segments = parseBodyWithMedia(fragment);
  const body = stripReporterByline(segmentsToBody(segments));
  if (!body) return null;

  return { body, hasMedia: segments.some((s) => s.type === 'image') };
}
