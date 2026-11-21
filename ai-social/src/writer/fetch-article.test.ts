import { describe, it, expect, vi } from 'vitest';
import { decodeBody, extractArticle, extractArxivAbs, fetchArticle } from './fetch-article.js';
import { HttpClient } from './sources/http.js';
import { RobotsChecker } from './robots.js';

const PARA = '이 문단은 본문 추출을 검증하기 위한 충분히 긴 문장입니다. 로컬 모델 서빙 속도와 메모리 사용량에 대한 이야기를 담고 있습니다. ';
const HTML = `<!doctype html><html lang="ko"><head>
<title>사이트 | 기사 제목</title>
<meta property="og:title" content="기사 제목">
<meta property="og:site_name" content="테스트 매거진">
<meta property="og:image" content="/img/og.jpg">
<meta property="article:published_time" content="2026-11-18T09:00:00+09:00">
<base href="https://news.test/section/">
</head><body>
<nav><a href="/">홈</a><ul><li>메뉴1</li><li>메뉴2</li></ul></nav>
<article><h1>기사 제목</h1>
<p>${PARA.repeat(3)}</p>
<img src="../img/chart.png" alt="chart">
<p>${PARA.repeat(3)}</p>
<figure><img data-src="https://cdn.other.test/a.webp"></figure>
<img src="data:image/gif;base64,AAAA">
<p>${PARA.repeat(2)}</p>
</article>
<footer>푸터 저작권 문구</footer>
</body></html>`;

describe('extractArticle', () => {
  const a = extractArticle(HTML, 'https://news.test/section/post')!;
  it('extracts title, main text without nav/footer, site name, date', () => {
    expect(a.title).toBe('기사 제목');
    expect(a.text).toContain('본문 추출을 검증');
    expect(a.text).not.toContain('메뉴1');
    expect(a.text).not.toContain('푸터 저작권');
    expect(a.siteName).toBe('테스트 매거진');
    expect(a.publishedAt).toBe('2026-11-18T00:00:00.000Z');
  });
  it('resolves image URLs to absolute (base href, data-src), skips data: URIs, og:image separate', () => {
    expect(a.images).toContain('https://news.test/img/chart.png');
    expect(a.images).toContain('https://cdn.other.test/a.webp');
    expect(a.images.some((i) => i.startsWith('data:'))).toBe(false);
    expect(a.ogImage).toBe('https://news.test/img/og.jpg');
  });
  it('returns null when there is too little text', () => {
    expect(extractArticle('<html><body><p>짧음</p></body></html>', 'https://a.test/')).toBeNull();
  });
  it('falls back to hostname for site name and JSON-LD for date', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-01T00:00:00Z"}</script></head><body><article><p>${PARA.repeat(5)}</p></article></body></html>`;
    const r = extractArticle(html, 'https://www.blog.test/p')!;
    expect(r.siteName).toBe('blog.test');
    expect(r.publishedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('decodeBody', () => {
  it('uses Content-Type charset (euc-kr)', () => {
    const bytes = new Uint8Array([0xb0, 0xa1, 0xb3, 0xaa]); // 가나 in EUC-KR
    expect(decodeBody(bytes, 'text/html; charset=EUC-KR')).toBe('가나');
  });
  it('sniffs <meta charset> and defaults to utf-8', () => {
    const euc = new Uint8Array([...Buffer.from('<meta charset="euc-kr">'), 0xb0, 0xa1]);
    expect(decodeBody(euc, 'text/html')).toContain('가');
    expect(decodeBody(new TextEncoder().encode('한글'), null)).toBe('한글');
    expect(decodeBody(new TextEncoder().encode('한글'), 'text/html; charset=bogus-xyz')).toBe('한글');
  });
});

describe('arXiv abs', () => {
  const ABS = `<html><head><meta name="citation_title" content="A Paper"><meta name="citation_date" content="2026/11/19"><meta property="og:image" content="/static/logo.png"></head>
  <body><blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span> ${'We study agents in depth. '.repeat(6)}</blockquote></body></html>`;
  it('extracts title and abstract; ignores the logo og:image', () => {
    const r = extractArxivAbs(ABS, 'https://arxiv.org/abs/2611.1')!;
    expect(r.title).toBe('A Paper');
    expect(r.text.startsWith('We study agents')).toBe(true);
    expect(r.ogImage).toBeNull();
    expect(r.siteName).toBe('arXiv');
  });
});

function mkHttp(handler: (url: string) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (u: string) => handler(u));
  return { http: new HttpClient({ fetchImpl, hostMinGapMs: {} }), fetchImpl };
}

describe('fetchArticle', () => {
  it('fetches, decodes and extracts', async () => {
    const { http } = mkHttp(() => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const r = await fetchArticle('https://news.test/section/post', { http });
    expect(r?.title).toBe('기사 제목');
  });
  it('returns null on HTTP error, non-HTML, network error, robots block', async () => {
    expect(await fetchArticle('https://a.test/x', { http: mkHttp(() => new Response('', { status: 404 })).http })).toBeNull();
    expect(await fetchArticle('https://a.test/x', { http: mkHttp(() => new Response('{}', { headers: { 'content-type': 'application/json' } })).http })).toBeNull();
    expect(
      await fetchArticle('https://a.test/x', {
        http: mkHttp(() => {
          throw new Error('ECONNRESET');
        }).http,
      })
    ).toBeNull();
    const { http, fetchImpl } = mkHttp((u) => (u.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /\n') : new Response(HTML)));
    expect(await fetchArticle('https://a.test/x', { http, robots: new RobotsChecker(http) })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // robots only, page never fetched
  });
  it('rejects non-http URLs', async () => {
    expect(await fetchArticle('file:///etc/passwd', { http: mkHttp(() => new Response('x')).http })).toBeNull();
  });
  it('uses the candidate abstract for arXiv without any network call', async () => {
    const { http, fetchImpl } = mkHttp(() => new Response(''));
    const summary = 'This paper studies something important about language models. '.repeat(3);
    const r = await fetchArticle('https://arxiv.org/abs/2611.26613', { http }, { title: 'T', summary, publishedAt: '2026-11-19T00:00:00.000Z' });
    expect(r?.text).toContain('studies something');
    expect(r?.siteName).toBe('arXiv');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('fetches the arXiv abs page when no summary hint is given', async () => {
    const abs = `<html><head><meta name="citation_title" content="A Paper"></head><body><blockquote class="abstract">Abstract: ${'Deep text. '.repeat(10)}</blockquote></body></html>`;
    const { http } = mkHttp(() => new Response(abs, { headers: { 'content-type': 'text/html' } }));
    expect((await fetchArticle('https://arxiv.org/abs/2611.1', { http }))?.title).toBe('A Paper');
  });
});
