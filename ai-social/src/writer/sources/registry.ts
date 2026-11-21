import type { Candidate } from '../types.js';
import { buildArxivUrl, parseArxivAtom } from './arxiv.js';
import { parseFeed } from './feed.js';
import { buildReleasesUrl, parseGithubReleases } from './github.js';
import { buildHfModelsUrl, buildHfPapersUrl, parseHfDailyPapers, parseHfModels } from './huggingface.js';
import { buildHnUrl, parseHnAlgolia, type HnTag } from './hn.js';
import type { HttpClient } from './http.js';

/**
 * 카테고리 slug → 소스·쿼리 매핑(유일한 곳). 소스 추가·삭제는 여기서만.
 *
 * 확인 일자 2026-11-20 (피드·API URL은 실제 200 응답, robots.txt 확인).
 * 제외한 소스와 사유:
 *  - Anthropic: 공식 RSS 없음(/rss.xml, /news/rss.xml 404)
 *  - TechCrunch(robots: anthropic-ai·CCBot 등 AI 크롤러 Disallow /), Stack Overflow 블로그(GPTBot Disallow /),
 *    The Verge(AI 크롤러 다수 Disallow /) — AI 크롤러를 막으므로 제외
 *  - LM Studio 블로그: RSS 없음(404)
 *  - Hacker News 공식 RSS/사이트: Crawl-delay 30 → Algolia API만 사용
 *  - arXiv: export.arxiv.org robots는 Disallow /이지만 이 호스트가 공식 API 전용 엔드포인트이고
 *    API 이용약관이 프로그램 접근을 허용(3초 간격 권고)한다 → API만, 카테고리당 1요청·3초 간격으로 사용
 */

export type SourceSpec =
  | { kind: 'arxiv'; id: string; categories: string[]; keyword?: string }
  | { kind: 'hn'; id: string; tag: HnTag; query?: string; minPoints?: number }
  | { kind: 'github'; id: string; repo: string }
  | { kind: 'hf-models'; id: string; pipelineTag?: string }
  | { kind: 'hf-papers'; id: string }
  | { kind: 'rss'; id: string; url: string };

/** 공식 블로그 RSS (전부 2026-11-20 200 확인, robots Allow) */
export const FEEDS = {
  openai: { kind: 'rss', id: 'rss:openai', url: 'https://openai.com/news/rss.xml' },
  deepmind: { kind: 'rss', id: 'rss:deepmind', url: 'https://deepmind.google/blog/rss.xml' },
  googleAi: { kind: 'rss', id: 'rss:google-ai', url: 'https://blog.google/technology/ai/rss/' },
  googleDevs: { kind: 'rss', id: 'rss:google-developers', url: 'https://developers.googleblog.com/feeds/posts/default' },
  hfBlog: { kind: 'rss', id: 'rss:huggingface-blog', url: 'https://huggingface.co/blog/feed.xml' },
  githubAi: { kind: 'rss', id: 'rss:github-ai', url: 'https://github.blog/ai-and-ml/feed/' },
  nvidia: { kind: 'rss', id: 'rss:nvidia-blog', url: 'https://blogs.nvidia.com/feed/' },
  simon: { kind: 'rss', id: 'rss:simonwillison', url: 'https://simonwillison.net/atom/everything/' },
  zapier: { kind: 'rss', id: 'rss:zapier', url: 'https://zapier.com/blog/feeds/latest/' },
  n8n: { kind: 'rss', id: 'rss:n8n-blog', url: 'https://blog.n8n.io/rss/' },
} as const satisfies Record<string, SourceSpec>;

/** GitHub 저장소 (전부 2026-11-20 releases API 200 확인. 301 리다이렉트된 sst/opencode·block/goose는 제외) */
const gh = (repo: string): SourceSpec => ({ kind: 'github', id: `github:${repo}`, repo });

export const CATEGORY_SOURCES: Record<string, SourceSpec[]> = {
  // 일반 게시판
  qna: [
    { kind: 'hn', id: 'hn:ask_hn:ai', tag: 'ask_hn', query: 'AI' },
    { kind: 'hn', id: 'hn:ask_hn:llm', tag: 'ask_hn', query: 'LLM' },
    FEEDS.hfBlog,
    FEEDS.githubAi,
  ],
  idea: [
    { kind: 'hn', id: 'hn:show_hn:ai', tag: 'show_hn', query: 'AI' },
    { kind: 'hn', id: 'hn:show_hn:llm', tag: 'show_hn', query: 'LLM' },
    FEEDS.openai,
    FEEDS.simon,
  ],
  free: [
    { kind: 'hn', id: 'hn:story:ai-hot', tag: 'story', query: 'AI', minPoints: 100 },
    FEEDS.simon,
    FEEDS.googleAi,
  ],
  // AI 분야 게시판
  frontier: [
    { kind: 'arxiv', id: 'arxiv:cs.CL', categories: ['cs.CL'] },
    { kind: 'arxiv', id: 'arxiv:cs.AI', categories: ['cs.AI'] },
    { kind: 'arxiv', id: 'arxiv:cs.LG', categories: ['cs.LG'] },
    { kind: 'hf-papers', id: 'hf:papers' },
    FEEDS.openai,
    FEEDS.deepmind,
  ],
  local: [
    gh('ollama/ollama'),
    gh('ggml-org/llama.cpp'),
    gh('vllm-project/vllm'),
    gh('ml-explore/mlx-lm'),
    { kind: 'hf-models', id: 'hf:models:text-generation', pipelineTag: 'text-generation' },
    { kind: 'hn', id: 'hn:story:local-llm', tag: 'story', query: 'local LLM' },
  ],
  agents: [
    gh('langchain-ai/langgraph'),
    gh('openai/openai-agents-python'),
    gh('modelcontextprotocol/modelcontextprotocol'),
    { kind: 'arxiv', id: 'arxiv:cs.MA', categories: ['cs.MA'] },
    { kind: 'hn', id: 'hn:story:agents', tag: 'story', query: 'AI agents' },
  ],
  aiservice: [
    FEEDS.openai,
    FEEDS.googleAi,
    FEEDS.nvidia,
    { kind: 'hn', id: 'hn:story:chatgpt', tag: 'story', query: 'ChatGPT', minPoints: 20 },
    { kind: 'hn', id: 'hn:story:gemini', tag: 'story', query: 'Gemini', minPoints: 20 },
  ],
  coding: [
    gh('openai/codex'),
    gh('anthropics/claude-code'),
    gh('google-gemini/gemini-cli'),
    gh('cline/cline'),
    FEEDS.githubAi,
    { kind: 'hn', id: 'hn:story:coding-agent', tag: 'story', query: 'coding agent' },
  ],
  automation: [
    gh('n8n-io/n8n'),
    FEEDS.n8n,
    FEEDS.zapier,
    { kind: 'hn', id: 'hn:story:automation', tag: 'story', query: 'n8n automation' },
  ],
  creative: [
    { kind: 'hf-models', id: 'hf:models:text-to-image', pipelineTag: 'text-to-image' },
    { kind: 'hf-models', id: 'hf:models:text-to-video', pipelineTag: 'text-to-video' },
    gh('Comfy-Org/ComfyUI'),
    { kind: 'hn', id: 'hn:story:image-gen', tag: 'story', query: 'image generation', minPoints: 20 },
    FEEDS.googleDevs,
  ],
};

/** goodfriends 글쓰기 담당 카테고리 slug 전체(페르소나 1:1). */
export const WRITER_CATEGORY_SLUGS = Object.keys(CATEGORY_SOURCES);

/** GitHub 무인증 한도(60/h) 보호: 카테고리당 한 번에 부르는 저장소 수 상한. */
export const MAX_GITHUB_REPOS_PER_FETCH = 4;

async function fetchOne(spec: SourceSpec, http: HttpClient): Promise<Candidate[]> {
  switch (spec.kind) {
    case 'arxiv':
      return parseArxivAtom(await http.getText(buildArxivUrl(spec.categories, { keyword: spec.keyword }), { Accept: 'application/atom+xml' }), spec.id);
    case 'hn':
      return parseHnAlgolia(await http.getJson(buildHnUrl(spec)), spec.id);
    case 'github':
      return parseGithubReleases(await http.getJson(buildReleasesUrl(spec.repo), { Accept: 'application/vnd.github+json' }), spec.repo, spec.id);
    case 'hf-models':
      return parseHfModels(await http.getJson(buildHfModelsUrl({ pipelineTag: spec.pipelineTag })), spec.id);
    case 'hf-papers':
      return parseHfDailyPapers(await http.getJson(buildHfPapersUrl()), spec.id);
    case 'rss':
      return parseFeed(await http.getText(spec.url, { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }), spec.id);
  }
}

/**
 * 카테고리의 모든 소스에서 후보를 모은다. 소스 하나가 실패해도 나머지는 계속(순차 실행: arXiv·GitHub
 * 호스트 간격 준수). 알 수 없는 slug면 빈 배열. URL 기준 중복 제거.
 */
export async function collectCandidates(
  slug: string,
  http: HttpClient,
  opts: { onError?: (spec: SourceSpec, err: unknown) => void } = {}
): Promise<Candidate[]> {
  const specs = CATEGORY_SOURCES[slug];
  if (!specs) return [];
  let githubCount = 0;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const spec of specs) {
    if (spec.kind === 'github') {
      if (githubCount >= MAX_GITHUB_REPOS_PER_FETCH) continue;
      githubCount++;
    }
    try {
      for (const c of await fetchOne(spec, http)) {
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        out.push(c);
      }
    } catch (err) {
      opts.onError?.(spec, err);
    }
  }
  return out;
}
