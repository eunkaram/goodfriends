import type { WebSearchResult } from '../types.js';
import { RESEARCH_SOURCES } from './sources.js';
import { parseRssFeed, parseHtmlBoard, pickMatchingSources, parseMetaDescription, parseMetaImage, parseArticleBody } from './parsers.js';

const SOURCE_FETCH_TIMEOUT_MS = 8000;
const SOURCE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class WebResearcher {
  /**
   * sources.ts에 등록된 소스 레지스트리에서 categories와 겹치는 소스를 하나 골라
   * 실제 게시글/뉴스 제목 목록을 가져온다. 소스가 없거나 요청이 실패하면 빈 배열.
   */
  public async fetchFromConfiguredSources(categories: string[], maxPerSource = 5): Promise<WebSearchResult[]> {
    const matching = pickMatchingSources(RESEARCH_SOURCES, categories);
    if (matching.length === 0) return [];

    const source = matching[Math.floor(Math.random() * matching.length)];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(source.url, {
        signal: controller.signal,
        headers: { 'User-Agent': SOURCE_USER_AGENT },
      });
      if (!res.ok) return [];

      const buf = await res.arrayBuffer();
      const text = new TextDecoder(source.encoding).decode(buf);
      const items = source.type === 'rss' ? parseRssFeed(text, source.name, maxPerSource) : parseHtmlBoard(text, source, maxPerSource);
      // 나중에 개별 글 본문/이미지(fetchPageMeta)를 가져올 때 어떤 인코딩으로 디코딩해야 하는지,
      // 어느 소스의 bodyPattern을 다시 찾아 써야 하는지 필요
      return items.map((item) => ({ ...item, encoding: source.encoding, sourceId: source.id }));
    } catch (err) {
      console.warn(`[WebResearcher] 소스 수집 실패 (${source.id}):`, err);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 개별 글/기사 페이지 하나를 가져와서 세 가지를 한 번에 뽑는다:
   * - description: <meta name="description"> 발췌 (bodyWithMedia를 못 찾았을 때 폴백용)
   * - imageUrl: <meta property="og:image"> (bodyWithMedia에 이미지가 없을 때 채워 넣을 대표 이미지)
   * - bodyWithMedia: bodyPattern이 주어지면, 실제 본문 컨테이너에서 텍스트+이미지/동영상을
   *   원래 위치 그대로 뽑은 것(사용자 요청: "이미지/미디어 위치를 그대로 보존"). bodyPattern이
   *   없거나 매칭 실패하면 null — 이 경우 호출부가 description으로 폴백함.
   */
  public async fetchPageMeta(
    url: string,
    encoding: 'utf-8' | 'euc-kr' = 'utf-8',
    bodyPattern?: RegExp
  ): Promise<{ description: string | null; imageUrl: string | null; bodyWithMedia: string | null; bodyHasMedia: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': SOURCE_USER_AGENT },
      });
      if (!res.ok) return { description: null, imageUrl: null, bodyWithMedia: null, bodyHasMedia: false };

      const buf = await res.arrayBuffer();
      const text = new TextDecoder(encoding).decode(buf);
      const article = bodyPattern ? parseArticleBody(text, bodyPattern) : null;

      return {
        description: parseMetaDescription(text),
        imageUrl: parseMetaImage(text),
        bodyWithMedia: article?.body || null,
        bodyHasMedia: article?.hasMedia || false,
      };
    } catch (err) {
      console.warn(`[WebResearcher] 본문/이미지 발췌 수집 실패 (${url}):`, err);
      return { description: null, imageUrl: null, bodyWithMedia: null, bodyHasMedia: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 카테고리/관심사에 맞는 최신 트렌드 자료 가져오기. sources.ts에 등록된 소스에서만 수집한다
   * (무료·키 불필요, robots.txt 검증됨). 매칭되는 소스가 없으면 null — DuckDuckGo 검색 폴백은
   * 2026-09-07에 제거함(캡차로 막혀서 사실상 죽어있었음, 아래 fetchTrendingTopic 안 주석 참고).
   */
  public async fetchTrendingTopic(categories: string[], isUrlExcluded?: (url: string) => boolean): Promise<WebSearchResult | null> {
    const allFromSources = await this.fetchFromConfiguredSources(categories);
    // 여러 에이전트가 같은 소스 목록에서 독립적으로 뽑다 보니 같은 글이 중복 게시되는 문제가
    // 있어서(2026-09-06), 이미 게시에 쓰인 URL은 후보에서 미리 제외한다. 전부 제외되면
    // fromSources가 빈 배열이 된 것과 같은 취급 — 아래 DDG 검색 폴백으로 자연스럽게 넘어간다.
    const fromSources = isUrlExcluded ? allFromSources.filter((r) => !isUrlExcluded(r.url)) : allFromSources;
    if (fromSources.length > 0) {
      const picked = fromSources[Math.floor(Math.random() * fromSources.length)];
      // "퍼온글"을 원문 그대로 포스팅하려면 실제 본문(+이미지/동영상 위치 보존)이 필요 — 목록
      // 페이지엔 제목만 있으므로 최종적으로 고른 글 하나에 대해서만 개별 페이지를 한 번 더
      // 가져온다(전부 다 가져오면 낭비).
      const source = RESEARCH_SOURCES.find((s) => s.id === picked.sourceId);
      const meta = await this.fetchPageMeta(picked.url, picked.encoding || 'utf-8', source?.bodyPattern);

      // bodyWithMedia를 못 구했으면(bodyPattern 없거나 매칭 실패) <meta name="description"> 발췌로 폴백.
      // disallowVerbatim 소스(영어권 등)는 원문을 절대 그대로 안 쓴다 — fullBody를 비워서
      // agent.ts가 무조건 generateSafePost(LLM이 한국어로 새로 씀) 경로를 타게 만든다.
      const fullBody = source?.disallowVerbatim ? undefined : meta.bodyWithMedia || meta.description || undefined;

      // bodyWithMedia를 실제로 구했다면(=본문 컨테이너를 제대로 찾아서 파싱함) 그 안의 미디어
      // 유무를 그대로 신뢰한다 — 없다고 나왔으면 진짜 없는 것이니 og:image(사이트 공용 아이콘 등
      // 그 글과 무관한 이미지인 경우가 많음, 실제로 확인함)로 대체하지 않는다. bodyWithMedia
      // 자체를 못 구한 경우(위치 정보가 아예 없는 경우)에만 목록 썸네일/og:image로 보충한다.
      const hasPositionalBody = meta.bodyWithMedia !== null;
      const imageUrl = hasPositionalBody ? undefined : picked.imageUrl || meta.imageUrl || undefined;

      return { ...picked, fullBody, imageUrl };
    }

    // 예전엔 여기서 DuckDuckGo 검색으로 폴백했으나, html.duckduckgo.com이 클라우드 IP에
    // 이미지 캡차("Unfortunately, bots use DuckDuckGo too")를 띄우는 게 확인돼서
    // (2026-09-07, prod에서도 재현됨) 완전히 막혀있다. 대안 검색 API(네이버는 실명인증 필요,
    // Brave는 결제/선불 요건 불명확)도 전부 마찰이 커서 이 카테고리들(pets/shopping/humor/
    // issue/careers/startup 등 전용 소스가 없는 카테고리)은 외부 리서치 없이 LLM이 자체
    // 소재로 쓰는 것으로 정리했다(사용자 결정, 2026-09-07). 캡차/봇탐지를 우회하는 시도는
    // 이 프로젝트가 이미 정한 원칙상 하지 않는다(hankyung.com Cloudflare 챌린지 때와 동일).
    return null;
  }
}
