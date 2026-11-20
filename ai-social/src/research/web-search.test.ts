import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebResearcher } from './web-search.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('WebResearcher.fetchTrendingTopic', () => {
  it('returns null and makes no network call when no source is configured for the category', async () => {
    // DuckDuckGo 검색 폴백은 2026-09-07에 제거함 — html.duckduckgo.com이 클라우드 IP에
    // 이미지 캡차를 띄워서(prod에서도 재현됨) 사실상 죽어있었고, 대안 검색 API(네이버는
    // 실명인증 필요, Brave는 결제 요건 불명확)도 마찰이 커서 포기하기로 함(사용자 결정).
    // 이제 매칭 소스가 없으면 그냥 포기하고, 네트워크 요청 자체를 하지 않아야 한다.
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const researcher = new WebResearcher();
    const result = await researcher.fetchTrendingTopic(['no-such-category']);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never uses the raw fetched text as fullBody for a disallowVerbatim source (e.g. English slickdeals content)', async () => {
    // slickdeals-frontpage는 disallowVerbatim:true라 meta description이 있어도 절대 그대로
    // 퍼오면 안 된다(영어 원문이 한국 커뮤니티에 그대로 올라가는 사고 방지, 2026-09-07).
    const listingHtml = `<a href="/f/19934457-tcl-fan?src=frontpage" target="_self" class="dealCard__title">42" TCL Ceiling Fan</a>`;
    const detailHtml = `<meta name="description" content="Grab this 42-inch ceiling fan deal today, English description here.">`;

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9); // matching 소스 중 마지막(slickdeals)을 고르게 강제
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new TextEncoder().encode(listingHtml).buffer } as any)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new TextEncoder().encode(detailHtml).buffer } as any);
    global.fetch = fetchMock as any;

    const researcher = new WebResearcher();
    const result = await researcher.fetchTrendingTopic(['hotdeals']);

    expect(result).not.toBeNull();
    expect(result!.fullBody).toBeUndefined();
    randomSpy.mockRestore();
  });

  it('excludes already-used URLs from the picked result, even when a real source has more than one candidate', async () => {
    // eomisae-shopping 소스를 고르도록 강제(matching 배열의 첫 번째)하고, 그 목록에 이미
    // 게시에 쓴 글 하나 + 아직 안 쓴 글 하나를 넣어서 제외 필터가 실제로 동작하는지 본다.
    const listingHtml = [
      `<a class="pjax"  href="/fs/100000001">이미 게시한 딜</a>`,
      `<a class="pjax"  href="/fs/100000002">아직 안 쓴 딜</a>`,
    ].join('');

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // matching 소스 중 첫 번째(eomisae) 고정
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(listingHtml).buffer,
    } as any);
    global.fetch = fetchMock as any;

    const researcher = new WebResearcher();
    const result = await researcher.fetchTrendingTopic(['hotdeals'], (url) => url.endsWith('/fs/100000001'));

    expect(result).not.toBeNull();
    expect(result!.url.endsWith('/fs/100000002')).toBe(true);
    randomSpy.mockRestore();
  });

  it('returns null when every candidate from the matched source is already used', async () => {
    const listingHtml = `<a class="pjax"  href="/fs/100000001">이미 게시한 딜</a>`;

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(listingHtml).buffer,
    } as any);
    global.fetch = fetchMock as any;

    const researcher = new WebResearcher();
    const result = await researcher.fetchTrendingTopic(['hotdeals'], () => true);

    expect(result).toBeNull();
    randomSpy.mockRestore();
  });
});
