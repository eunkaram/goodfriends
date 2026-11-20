import { describe, it, expect } from 'vitest';
import {
  parseRssFeed,
  parseHtmlBoard,
  pickMatchingSources,
  parseMetaDescription,
  parseMetaImage,
  parseBodyWithMedia,
  segmentsToBody,
  parseArticleBody,
} from './parsers.js';
import type { ResearchSource } from './sources.js';

describe('parseRssFeed', () => {
  it('extracts title/link from CDATA-wrapped items (hankyung/etnews style)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title><![CDATA[한국경제 | 뉴스 | IT·과학]]></title>
<item>
  <title><![CDATA["우리 아파트 경비원 새로 오셨는데…" 타워팰리스 '술렁']]></title>
  <link><![CDATA[https://www.hankyung.com/article/2026082029621]]></link>
  <pubDate>Thu, 20 Aug 2026 21:00:01 +0900</pubDate>
</item>
<item>
  <title><![CDATA[암 예방접종 시대 '올인'…모더나, 매년 4억弗 투자]]></title>
  <link><![CDATA[https://www.hankyung.com/article/2026082030471]]></link>
</item>
</channel></rss>`;

    const result = parseRssFeed(xml, '한국경제 IT', 5);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: `"우리 아파트 경비원 새로 오셨는데…" 타워팰리스 '술렁'`,
      url: 'https://www.hankyung.com/article/2026082029621',
      snippet: `"우리 아파트 경비원 새로 오셨는데…" 타워팰리스 '술렁'`,
      source: '한국경제 IT',
    });
  });

  it('extracts title/link without CDATA (plain-text style)', () => {
    const xml = `<rss><channel><item><title>플레인 텍스트 제목</title><link>https://example.com/1</link></item></channel></rss>`;
    const result = parseRssFeed(xml, '테스트피드', 5);
    expect(result).toEqual([{ title: '플레인 텍스트 제목', url: 'https://example.com/1', snippet: '플레인 텍스트 제목', source: '테스트피드' }]);
  });

  it('respects the max limit', () => {
    const xml = `<rss><channel>${Array.from(
      { length: 10 },
      (_, i) => `<item><title>제목${i}</title><link>https://example.com/${i}</link></item>`
    ).join('')}</channel></rss>`;
    expect(parseRssFeed(xml, 'x', 3)).toHaveLength(3);
  });

  it('skips items missing a title or link', () => {
    const xml = `<rss><channel><item><title>제목만 있음</title></item></channel></rss>`;
    expect(parseRssFeed(xml, 'x', 5)).toEqual([]);
  });

  it('returns an empty array for a feed with no items', () => {
    expect(parseRssFeed('<rss><channel></channel></rss>', 'x', 5)).toEqual([]);
  });

  it('extracts an image from an <enclosure> tag when present', () => {
    const xml = `<rss><channel><item>
      <title>이미지 있는 기사</title>
      <link>https://example.com/1</link>
      <enclosure url="https://example.com/thumb.jpg" type="image/jpeg" />
    </item></channel></rss>`;
    expect(parseRssFeed(xml, 'x', 5)[0].imageUrl).toBe('https://example.com/thumb.jpg');
  });

  it('extracts an image from a <media:thumbnail> tag when present', () => {
    const xml = `<rss><channel><item>
      <title>이미지 있는 기사</title>
      <link>https://example.com/1</link>
      <media:thumbnail url="https://example.com/thumb2.jpg" />
    </item></channel></rss>`;
    expect(parseRssFeed(xml, 'x', 5)[0].imageUrl).toBe('https://example.com/thumb2.jpg');
  });

  it('leaves imageUrl undefined when the item has no enclosure/media tag', () => {
    const xml = `<rss><channel><item><title>이미지 없는 기사</title><link>https://example.com/1</link></item></channel></rss>`;
    expect(parseRssFeed(xml, 'x', 5)[0].imageUrl).toBeUndefined();
  });
});

describe('parseHtmlBoard', () => {
  const ppomppuSource: ResearchSource = {
    id: 'ppomppu-free',
    name: '뽐뿌 자유게시판',
    type: 'html_board',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?id=freeboard',
    categories: ['chat', 'humor'],
    enabled: true,
    encoding: 'euc-kr',
    listPattern: /<a\s+class=['"]baseList-title['"]\s+href=["'](?<href>view\.php\?id=freeboard[^"']*)["'][^>]*>(?<title>[\s\S]*?)<\/a>/,
    linkBaseUrl: 'https://www.ppomppu.co.kr/zboard/',
  };

  it('extracts title/link pairs from a sticky-notice row (double-quoted class, plain text title)', () => {
    const html = `<a class="baseList-title" href="view.php?id=freeboard&page=1&divpage=202&no=6">전체 게시판 이용 규칙</a>`;
    const result = parseHtmlBoard(html, ppomppuSource, 5);
    expect(result).toEqual([
      {
        title: '전체 게시판 이용 규칙',
        url: 'https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&page=1&divpage=202&no=6',
        snippet: '전체 게시판 이용 규칙',
        source: '뽐뿌 자유게시판',
      },
    ]);
  });

  it('extracts a real post row: single-quoted class attr + title nested inside a <font> tag', () => {
    // 실제 응답에서 확인된 구조 — 공지/광고 행은 큰따옴표를 쓰지만 실제 게시글 행은 작은따옴표를
    // 쓰고 제목이 <font class='list_title title_fix'>...</font>로 감싸져 있다.
    const html = `<a class='baseList-title' href="view.php?id=freeboard&page=1&divpage=1885&no=10087089"  ><font class='list_title title_fix'>서비스 속도 저하 관련 시스템 점검 완료 및 정상화 안내</font></a>`;
    const result = parseHtmlBoard(html, ppomppuSource, 5);
    expect(result).toEqual([
      {
        title: '서비스 속도 저하 관련 시스템 점검 완료 및 정상화 안내',
        url: 'https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&page=1&divpage=1885&no=10087089',
        snippet: '서비스 속도 저하 관련 시스템 점검 완료 및 정상화 안내',
        source: '뽐뿌 자유게시판',
      },
    ]);
  });

  it('skips ad rows that use onClick instead of an href (no view.php link to match)', () => {
    const html = `<a class="baseList-title"   onClick="informAdClick('https://s.ppomppu.co.kr/x')"><img src="/images/icon_04.png" class="baseList-img">광고 게시글 제목</a>`;
    expect(parseHtmlBoard(html, ppomppuSource, 5)).toEqual([]);
  });

  it('decodes &amp; entities in the extracted title', () => {
    const html = `<a class="baseList-title" href="view.php?id=freeboard&no=1">치킨 &amp; 맥주 최고</a>`;
    const result = parseHtmlBoard(html, ppomppuSource, 5);
    expect(result[0].title).toBe('치킨 & 맥주 최고');
  });

  const invenSource: ResearchSource = {
    id: 'inven-news',
    name: '인벤 웹진뉴스',
    type: 'html_board',
    url: 'https://www.inven.co.kr/webzine/news/',
    categories: ['hobby', 'tech'],
    enabled: true,
    encoding: 'utf-8',
    listPattern:
      /href="(?<href>https:\/\/www\.inven\.co\.kr\/webzine\/news\/\?news=\d+)"[\s\S]{0,100}?class="cols thumb"><img[^>]*src="(?<image>[^"]+)"[\s\S]{0,300}?class="cols title">(?<title>[^<]{4,120})/,
  };

  it('extracts title/link/thumbnail image from inven markup', () => {
    const html = `
      <a href="https://www.inven.co.kr/webzine/news/?news=319749">
        <span class="cols thumb"><img class="banner" src="thumb.jpg"></span>
        <span class="cols title">IO 인터랙티브 '007 퍼스트 라이트', 누적 판매량 400만 장 돌파<img class="iconimg" src="hot.gif" /></span>
      </a>`;
    const result = parseHtmlBoard(html, invenSource, 5);
    expect(result).toEqual([
      {
        title: `IO 인터랙티브 '007 퍼스트 라이트', 누적 판매량 400만 장 돌파`,
        url: 'https://www.inven.co.kr/webzine/news/?news=319749',
        snippet: `IO 인터랙티브 '007 퍼스트 라이트', 누적 판매량 400만 장 돌파`,
        source: '인벤 웹진뉴스',
        imageUrl: 'thumb.jpg',
      },
    ]);
  });

  it('leaves imageUrl undefined for sources without an image group (ppomppu)', () => {
    const html = `<a class="baseList-title" href="view.php?id=freeboard&no=1">이미지 없는 게시글 제목</a>`;
    const result = parseHtmlBoard(html, ppomppuSource, 5);
    expect(result[0].imageUrl).toBeUndefined();
  });

  it('returns an empty array when the source has no listPattern', () => {
    const source: ResearchSource = { ...ppomppuSource, listPattern: undefined };
    expect(parseHtmlBoard('<a class="baseList-title" href="view.php?id=freeboard&no=1">글</a>', source, 5)).toEqual([]);
  });

  it('respects the max limit', () => {
    const html = Array.from(
      { length: 10 },
      (_, i) => `<a class="baseList-title" href="view.php?id=freeboard&no=${i}">제목이라기엔 짧은 글${i}</a>`
    ).join('');
    expect(parseHtmlBoard(html, ppomppuSource, 3)).toHaveLength(3);
  });

  // 핫딜 소스 2개(2026-09-07 추가) — 실제 응답에서 캡처한 구조 그대로 회귀 테스트.
  const eomisaeSource: ResearchSource = {
    id: 'eomisae-shopping',
    name: '어미새 쇼핑정보',
    type: 'html_board',
    url: 'https://eomisae.co.kr/fs',
    categories: ['hotdeals'],
    enabled: true,
    encoding: 'utf-8',
    listPattern: /<a class=["']pjax["']\s+href="(?<href>\/fs\/\d+)">(?<title>[^<]{4,120})<\/a>/,
    linkBaseUrl: 'https://eomisae.co.kr',
  };

  it('extracts a real eomisae deal row', () => {
    const html = `<a class="pjax"  href="/fs/200992286">나이키 투인원 러닝쇼츠 2.6</a>`;
    expect(parseHtmlBoard(html, eomisaeSource, 5)).toEqual([
      {
        title: '나이키 투인원 러닝쇼츠 2.6',
        url: 'https://eomisae.co.kr/fs/200992286',
        snippet: '나이키 투인원 러닝쇼츠 2.6',
        source: '어미새 쇼핑정보',
      },
    ]);
  });

  const slickdealsSource: ResearchSource = {
    id: 'slickdeals-frontpage',
    name: 'Slickdeals 프론트페이지',
    type: 'html_board',
    url: 'https://slickdeals.net/',
    categories: ['hotdeals'],
    enabled: true,
    encoding: 'utf-8',
    listPattern: /<a href="(?<href>\/f\/\d+-[a-zA-Z0-9-]+)\?src=frontpage" target="_self" class=["']dealCard__title["'][^>]*>(?<title>[^<]{5,150})<\/a>/,
    linkBaseUrl: 'https://slickdeals.net',
    disallowVerbatim: true,
  };

  it('extracts a real slickdeals deal row', () => {
    const html = `<a href="/f/19934457-tcl-42-inch-low-profile-ceiling-fan-with-light-remote-45-free-s-h?src=frontpage" target="_self" class="dealCard__title" data-v-68ddf670>42" TCL Low Profile Ceiling Fan w/ Light & Remote (White or Black)</a>`;
    const result = parseHtmlBoard(html, slickdealsSource, 5);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('42" TCL Low Profile Ceiling Fan w/ Light & Remote (White or Black)');
    expect(result[0].url).toBe(
      'https://slickdeals.net/f/19934457-tcl-42-inch-low-profile-ceiling-fan-with-light-remote-45-free-s-h'
    );
  });

  const waugSource: ResearchSource = {
    id: 'waug-magazine',
    name: 'WAUG 매거진',
    type: 'html_board',
    url: 'https://www.waug.com/ko/magazines',
    categories: ['travel'],
    enabled: true,
    encoding: 'utf-8',
    listPattern: /<a[^>]*title="(?<title>[^"]{4,150})"[^>]*href="(?<href>\/ko\/magazines\/\d+)"/,
    linkBaseUrl: 'https://www.waug.com',
  };

  it('extracts a real WAUG magazine row without depending on the Next.js CSS-module hash', () => {
    // 실제 응답 구조: <a title="..." href="/ko/magazines/N"><article class="MagazineCard-module-scss-module__leKYta__card">...
    // 해시(__leKYta__)는 배포마다 바뀌므로 절대 정규식에 쓰지 않고 title 속성 + 경로만으로 잡는다.
    const html = `<a lang="ko" hrefLang="ko" title="세계에서 가장 아름다운 서점, 렐루 서점" href="/ko/magazines/2593"><article class="MagazineCard-module-scss-module__leKYta__card"><div>thumbnail</div></article></a>`;
    const result = parseHtmlBoard(html, waugSource, 5);
    expect(result).toEqual([
      {
        title: '세계에서 가장 아름다운 서점, 렐루 서점',
        url: 'https://www.waug.com/ko/magazines/2593',
        snippet: '세계에서 가장 아름다운 서점, 렐루 서점',
        source: 'WAUG 매거진',
      },
    ]);
  });
});

describe('parseMetaDescription', () => {
  it('extracts the description content from a real inven article page', () => {
    // 실제 인벤 기사 페이지에서 확인한 형태
    const html = `<meta name="description" content="IO 인터랙티브의 신작 첩보 액션 게임 &#039;007 퍼스트 라이트&#039;가 지난 5월 27일 출시 이후 약 3개월 만에 글로벌 누적 판매량 400만 장을 돌파했습니다." />`;
    expect(parseMetaDescription(html)).toBe(
      `IO 인터랙티브의 신작 첩보 액션 게임 '007 퍼스트 라이트'가 지난 5월 27일 출시 이후 약 3개월 만에 글로벌 누적 판매량 400만 장을 돌파했습니다.`
    );
  });

  it('decodes &amp; and &quot; entities too', () => {
    const html = `<meta name="description" content="치킨 &amp; 맥주, &quot;최고의 조합&quot;이라 불리는 이유">`;
    expect(parseMetaDescription(html)).toBe(`치킨 & 맥주, "최고의 조합"이라 불리는 이유`);
  });

  it('returns null when there is no description meta tag', () => {
    expect(parseMetaDescription('<html><head><title>제목만 있음</title></head></html>')).toBeNull();
  });

  it('returns null for an empty description', () => {
    expect(parseMetaDescription(`<meta name="description" content="">`)).toBeNull();
  });

  it('rejects a real-world site placeholder that caused a live "check the link but there is no link" post', () => {
    // 실제 라이브 사고: 뽐뿌 이미지 전용 글에서 본문 대신 이 문구만 나와서 "여기를 눌러 링크를
    // 확인하세요"만 있는 빈 게시글이 실제로 올라갔었음
    const html = `<meta name="description" content="여기를 눌러 링크를 확인하세요">`;
    expect(parseMetaDescription(html)).toBeNull();
  });
});

describe('parseMetaImage', () => {
  it('extracts og:image from a real inven article page', () => {
    const html = `<meta property="og:image" content="https://static.inven.co.kr/column/2026/08/21/news/i1329954916.jpg" />`;
    expect(parseMetaImage(html)).toBe('https://static.inven.co.kr/column/2026/08/21/news/i1329954916.jpg');
  });

  it('extracts og:image from a real ppomppu post page (gif)', () => {
    const html = `<meta property="og:image" content="https://cdn2.ppomppu.co.kr/zboard/data3/2026/0821/20260821064740_0nya7UWR1Q.gif" />`;
    expect(parseMetaImage(html)).toBe('https://cdn2.ppomppu.co.kr/zboard/data3/2026/0821/20260821064740_0nya7UWR1Q.gif');
  });

  it('decodes &amp; in the image URL', () => {
    const html = `<meta property="og:image" content="https://example.com/img.jpg?a=1&amp;b=2">`;
    expect(parseMetaImage(html)).toBe('https://example.com/img.jpg?a=1&b=2');
  });

  it('returns null when there is no og:image tag', () => {
    expect(parseMetaImage('<html><head><title>이미지 없음</title></head></html>')).toBeNull();
  });

  it('returns null for an empty og:image content', () => {
    expect(parseMetaImage(`<meta property="og:image" content="">`)).toBeNull();
  });

  it('normalizes a protocol-relative URL to https (real ppomppu case)', () => {
    const html = `<meta property="og:image" content="//cdn2.ppomppu.co.kr/images/icon_app_20160427.png">`;
    expect(parseMetaImage(html)).toBe('https://cdn2.ppomppu.co.kr/images/icon_app_20160427.png');
  });
});

describe('parseBodyWithMedia', () => {
  it('preserves image position inside real inven article markup (image between two text paragraphs)', () => {
    // 실제 인벤 기사 본문에서 확인한 구조 축약본 — <figure><img></figure>가 문단 사이에 있음
    const html = `<figure style="text-align: center;"><a href="x" data-lightbox="article"><img src="https://static.inven.co.kr/column/2026/08/21/news/i1810115349.jpg" alt="a"></a><figcaption>©IO 인터랙티브</figcaption></figure><br />
IO 인터랙티브의 신작 첩보 액션 게임이 400만 장을 돌파했다.<br />
<br />
지난 5월 27일 정식 출시된 이후 약 3개월 만에 거둔 성과다.`;
    const segments = parseBodyWithMedia(html);
    expect(segments[0]).toEqual({ type: 'image', value: 'https://static.inven.co.kr/column/2026/08/21/news/i1810115349.jpg' });
    expect(segments[1].type).toBe('text');
    expect(segments[1].value).toContain('400만 장을 돌파했다.');
    expect(segments[1].value).toContain('거둔 성과다.');
  });

  it('extracts a video source URL as media, protocol-relative URLs get https: prefixed', () => {
    const html = `<p>영상 제보입니다.</p><p style="text-align: center;"><video name="videoMp4ViewList" controls="true"><source type="video/mp4" src="//cdn2.ppomppu.co.kr/zboard/data3/2026/0821/clip.mp4#t=0.05">
    <source src="https://img.ppomppu.co.kr/zboard/data3/2026/0821/clip.mp4" type="video/mp4">Your browser does not support the video tag.</video></p><p>다음 내용입니다.</p>`;
    const segments = parseBodyWithMedia(html);
    expect(segments.map((s) => s.type)).toEqual(['text', 'image', 'text']);
    expect(segments[1].value).toBe('https://cdn2.ppomppu.co.kr/zboard/data3/2026/0821/clip.mp4#t=0.05');
    expect(segments[2].value).toBe('다음 내용입니다.');
  });

  it('drops figcaption text (copyright lines) but keeps the image', () => {
    const html = `<figure><img src="https://example.com/a.jpg"><figcaption>©저작권자</figcaption></figure>`;
    const segments = parseBodyWithMedia(html);
    expect(segments).toEqual([{ type: 'image', value: 'https://example.com/a.jpg' }]);
  });

  it('returns only text when there is no media at all', () => {
    const segments = parseBodyWithMedia('<p>텍스트만 있는 글입니다.</p>');
    expect(segments).toEqual([{ type: 'text', value: '텍스트만 있는 글입니다.' }]);
  });

  it('preserves an external <a href> link (URL alongside its visible text) instead of dropping the href', () => {
    const segments = parseBodyWithMedia('<p>재입고됐어요. <a href="https://joesnewbalanceoutlet.com/pd/993">여기서 구매</a></p>');
    expect(segments).toEqual([{ type: 'text', value: '재입고됐어요. 여기서 구매 (https://joesnewbalanceoutlet.com/pd/993)' }]);
  });

  it('outputs the bare URL when the link text is empty or identical to the href', () => {
    const segments = parseBodyWithMedia('<p><a href="https://example.com/deal">https://example.com/deal</a></p>');
    expect(segments).toEqual([{ type: 'text', value: 'https://example.com/deal' }]);
  });

  it('drops internal/relative/anchor links (not "external") and keeps only their visible text', () => {
    const segments = parseBodyWithMedia('<p>다른 글도 <a href="/board/view?id=123">여기</a> 있어요.</p>');
    expect(segments).toEqual([{ type: 'text', value: '다른 글도 여기 있어요.' }]);
  });
});

describe('segmentsToBody', () => {
  it('joins segments with blank lines, preserving order', () => {
    const body = segmentsToBody([
      { type: 'text', value: '첫 문단' },
      { type: 'image', value: 'https://example.com/a.jpg' },
      { type: 'text', value: '둘째 문단' },
    ]);
    expect(body).toBe('첫 문단\n\nhttps://example.com/a.jpg\n\n둘째 문단');
  });

  it('truncates at a segment boundary once the max length is exceeded (never mid-segment)', () => {
    const segments = [
      { type: 'text' as const, value: 'a'.repeat(10) },
      { type: 'text' as const, value: 'b'.repeat(10) },
      { type: 'text' as const, value: 'c'.repeat(10) },
    ];
    const body = segmentsToBody(segments, 15);
    expect(body).toBe('a'.repeat(10)); // 첫 세그먼트(10자)까지만 포함, 둘째(20자 넘음)는 통째로 제외
  });

  it('always includes at least the first segment even if it alone exceeds maxLength', () => {
    const body = segmentsToBody([{ type: 'text', value: 'x'.repeat(50) }], 10);
    expect(body).toBe('x'.repeat(50));
  });
});

describe('parseArticleBody', () => {
  const ppomppuBodyPattern = /class=['"]board-contents['"][^>]*>(?<body>[\s\S]*?)<\/td>/i;

  it('extracts the real ppomppu post body container and reports hasMedia', () => {
    const html = `<td class='board-contents' align="left" valign=top class=han><p><br></p><p>실제 게시글 내용입니다.</p><p style="text-align:center;"><img src="https://cdn2.ppomppu.co.kr/a.jpg"></p><p>이어지는 내용.</p></td><tr><td>다른 영역</td></tr>`;
    const result = parseArticleBody(html, ppomppuBodyPattern);
    expect(result?.hasMedia).toBe(true);
    expect(result?.body).toContain('실제 게시글 내용입니다.');
    expect(result?.body).toContain('https://cdn2.ppomppu.co.kr/a.jpg');
    expect(result?.body).not.toContain('다른 영역');
  });

  const invenBodyPattern = /itemprop=["']articleBody["'][^>]*>(?<body>[\s\S]*?)<script/i;

  it('extracts the real inven article body container', () => {
    const html = `<div id="imageCollectDiv" class="contentBody" itemprop="articleBody"><figure><img src="https://static.inven.co.kr/a.jpg"></figure><br />본문 텍스트입니다.</div><script>foo()</script>`;
    const result = parseArticleBody(html, invenBodyPattern);
    expect(result?.hasMedia).toBe(true);
    expect(result?.body).toContain('본문 텍스트입니다.');
  });

  it('returns null when the body pattern does not match', () => {
    expect(parseArticleBody('<div>다른 구조</div>', invenBodyPattern)).toBeNull();
  });

  it('returns null when the matched container has no usable text or media', () => {
    const html = `<div itemprop="articleBody">   </div><script></script>`;
    expect(parseArticleBody(html, invenBodyPattern)).toBeNull();
  });

  const etnewsBodyPattern = /itemprop=["']articleBody["'][^>]*>(?<body>[\s\S]*?)<\/div>/i;

  it('extracts the full etnews article body up to its closing </div>, not the truncated meta description', () => {
    const html = `<div class="article_body " itemprop="articleBody" id="articleBody"><figure class="article_image"><img src="https://img.etnews.com/a.jpg"></figure><p>첫 문단.<br />둘째 문단까지 전부 담긴다.</p></div><div id="layerRelated"></div>`;
    const result = parseArticleBody(html, etnewsBodyPattern);
    expect(result?.hasMedia).toBe(true);
    expect(result?.body).toContain('첫 문단.');
    expect(result?.body).toContain('둘째 문단까지 전부 담긴다.');
  });

  it('strips the trailing reporter byline+email so the PII gate does not block the whole repost', () => {
    // 실제로 겪은 문제(2026-09-06): 기자 바이라인 이메일 때문에 content-gate.ts의 PII 필터가
    // "퍼온글이 세이프티 게이트에 차단됨 (PII 감지: 이메일)"로 멀쩡한 기사 전체를 스킵시켰다.
    const html = `<div itemprop="articleBody"><p>본문 내용입니다.<br />서희원 기자 shw@etnews.com</p></div>`;
    const result = parseArticleBody(html, etnewsBodyPattern);
    expect(result?.body).toContain('본문 내용입니다.');
    expect(result?.body).not.toContain('@etnews.com');
    expect(result?.body).not.toContain('기자');
  });

  it('does not strip unrelated text that merely mentions "기자" mid-body', () => {
    const html = `<div itemprop="articleBody"><p>이 기자회견은 오늘 오후에 열렸다. 참석자가 많았다.</p></div>`;
    const result = parseArticleBody(html, etnewsBodyPattern);
    expect(result?.body).toContain('기자회견');
    expect(result?.body).toContain('참석자가 많았다');
  });
});

describe('pickMatchingSources', () => {
  const base: ResearchSource = {
    id: 'a',
    name: 'A',
    type: 'rss',
    url: 'https://example.com/a',
    categories: ['tech'],
    enabled: true,
    encoding: 'utf-8',
  };

  it('returns sources whose categories overlap with the requested categories', () => {
    const sources: ResearchSource[] = [base, { ...base, id: 'b', categories: ['invest'] }];
    expect(pickMatchingSources(sources, ['tech', 'chat']).map((s) => s.id)).toEqual(['a']);
  });

  it('excludes disabled sources even if the category matches', () => {
    const sources: ResearchSource[] = [{ ...base, enabled: false }];
    expect(pickMatchingSources(sources, ['tech'])).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(pickMatchingSources([base], ['humor'])).toEqual([]);
  });
});
