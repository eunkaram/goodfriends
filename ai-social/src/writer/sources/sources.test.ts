import { describe, it, expect, vi } from 'vitest';
import { buildArxivUrl, parseArxivAtom } from './arxiv.js';
import { buildHnUrl, parseHnAlgolia } from './hn.js';
import { buildReleasesUrl, parseGithubReleases } from './github.js';
import { buildHfModelsUrl, parseHfDailyPapers, parseHfModels } from './huggingface.js';
import { parseFeed } from './feed.js';
import { HttpClient, WRITER_USER_AGENT } from './http.js';
import { collectCandidates, MAX_GITHUB_REPOS_PER_FETCH } from './registry.js';

const ARXIV = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2611.26613v2</id>
    <title>AgentRoboCritic: Understanding
  the Capability of Agents</title>
    <link href="https://arxiv.org/abs/2611.26613v2" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2611.26613v2" rel="related" type="application/pdf" title="pdf"/>
    <summary>We present a systematic analysis.
 It is long.</summary>
    <published>2026-11-19T18:57:25Z</published>
    <arxiv:primary_category term="cs.RO"/>
  </entry>
  <entry><id></id><title>no id</title></entry>
</feed>`;

describe('arXiv Atom', () => {
  it('parses entries, strips version suffix and collapses whitespace', () => {
    const r = parseArxivAtom(ARXIV, 'arxiv:cs.CL');
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      title: 'AgentRoboCritic: Understanding the Capability of Agents',
      url: 'https://arxiv.org/abs/2611.26613',
      sourceId: 'arxiv:cs.CL',
      publishedAt: '2026-11-19T18:57:25.000Z',
      summary: 'We present a systematic analysis. It is long.',
    });
  });
  it('builds a category OR query sorted by submission date', () => {
    const u = buildArxivUrl(['cs.AI', 'cs.CL']);
    expect(u).toContain('search_query=cat:cs.AI+OR+cat:cs.CL');
    expect(u).toContain('sortBy=submittedDate');
    expect(buildArxivUrl(['cs.AI'], { keyword: 'agent' })).toContain('AND+abs:agent');
  });
});

describe('HN Algolia', () => {
  const json = {
    hits: [
      { objectID: '1', title: 'Show HN: Tool', url: 'https://example.com/tool', created_at: '2026-11-20T10:00:00.000Z', story_text: null },
      { objectID: '2', title: 'Ask HN: Which model?', url: null, created_at_i: 1795000000, story_text: 'I am <p>asking</p> about models' },
      { objectID: '3', title: '', url: 'https://x.test' },
    ],
  };
  it('uses discussion URL for Ask HN and falls back to created_at_i', () => {
    const r = parseHnAlgolia(json, 'hn:test');
    expect(r).toHaveLength(2);
    expect(r[0].url).toBe('https://example.com/tool');
    expect(r[1].url).toBe('https://news.ycombinator.com/item?id=2');
    expect(r[1].summary).toBe('I am asking about models');
    expect(r[1].publishedAt).toBe(new Date(1795000000 * 1000).toISOString());
  });
  it('returns [] for malformed JSON', () => {
    expect(parseHnAlgolia({}, 'x')).toEqual([]);
    expect(parseHnAlgolia(null, 'x')).toEqual([]);
  });
  it('builds query with tag, points filter', () => {
    const u = buildHnUrl({ tag: 'show_hn', query: 'local LLM', minPoints: 50 });
    expect(u).toContain('tags=show_hn');
    expect(u).toContain('query=local+LLM');
    expect(decodeURIComponent(u)).toContain('points>=50');
  });
});

describe('GitHub releases', () => {
  const json = [
    { tag_name: 'v0.5.0', name: 'v0.5.0', html_url: 'https://github.com/o/r/releases/tag/v0.5.0', published_at: '2026-11-18T00:00:00Z', body: 'Fixes\n\n- a' },
    { tag_name: 'v0.6.0-rc1', name: 'rc', html_url: 'https://github.com/o/r/releases/tag/v0.6.0-rc1', prerelease: true, published_at: '2026-11-19T00:00:00Z' },
    { tag_name: 'v0.7', name: 'draft', html_url: 'https://github.com/o/r/x', draft: true },
    { tag_name: 'b100', name: 'Big update', html_url: 'https://github.com/o/r/releases/tag/b100', published_at: '2026-11-10T00:00:00Z' },
  ];
  it('skips drafts and prereleases, builds titles', () => {
    const r = parseGithubReleases(json, 'o/r', 'github:o/r');
    expect(r.map((c) => c.title)).toEqual(['o/r v0.5.0', 'o/r b100: Big update']);
    expect(r[0].summary).toBe('Fixes - a');
    expect(r[0].publishedAt).toBe('2026-11-18T00:00:00.000Z');
  });
  it('handles error objects (rate limit / 404 bodies)', () => {
    expect(parseGithubReleases({ message: 'Not Found' }, 'o/r', 'x')).toEqual([]);
  });
  it('requests one page per repo', () => {
    expect(buildReleasesUrl('ollama/ollama')).toBe('https://api.github.com/repos/ollama/ollama/releases?per_page=5');
  });
});

describe('Hugging Face', () => {
  it('parses trending models', () => {
    const r = parseHfModels(
      [
        { id: 'org/model-a', likes: 10, downloads: 5, pipeline_tag: 'text-generation', createdAt: '2026-11-17T00:26:57.000Z' },
        { id: 'org/private', private: true },
        { nope: true },
      ],
      'hf:models'
    );
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('https://huggingface.co/org/model-a');
    expect(r[0].summary).toContain('text-generation');
    expect(r[0].publishedAt).toBe('2026-11-17T00:26:57.000Z');
  });
  it('parses daily papers with abstract', () => {
    const r = parseHfDailyPapers(
      [{ paper: { id: '2611.15941', summary: 'Image vectorization\nreconstructs', publishedAt: '2026-11-11T00:00:00.000Z' }, title: 'Lang-SVG', publishedAt: '2026-11-11T00:00:00.000Z' }, { paper: {} }],
      'hf:papers'
    );
    expect(r).toEqual([
      { title: 'Lang-SVG', url: 'https://huggingface.co/papers/2611.15941', sourceId: 'hf:papers', publishedAt: '2026-11-11T00:00:00.000Z', summary: 'Image vectorization reconstructs' },
    ]);
  });
  it('builds trending URL', () => {
    expect(buildHfModelsUrl({ pipelineTag: 'text-to-image' })).toContain('pipeline_tag=text-to-image&sort=trendingScore');
  });
});

describe('RSS / Atom feed', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title><![CDATA[Combatting & distillation]]></title><description><![CDATA[<p>Layered <b>approach</b></p>]]></description>
      <link>https://openai.com/index/x</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Quoting X</title>
    <link href="https://simonwillison.net/2026/Nov/20/x/" rel="alternate"/><published>2026-11-20T19:21:49+00:00</published>
    <summary type="html">&lt;p&gt;Hello &amp;amp; bye&lt;/p&gt;</summary></entry></feed>`;
  it('parses RSS 2.0 incl. CDATA and strips description HTML', () => {
    const r = parseFeed(rss, 'rss:openai');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'Combatting & distillation', url: 'https://openai.com/index/x', summary: 'Layered approach', publishedAt: '2026-11-20T10:00:00.000Z' });
  });
  it('parses Atom', () => {
    const r = parseFeed(atom, 'rss:simon');
    expect(r[0]).toMatchObject({ title: 'Quoting X', url: 'https://simonwillison.net/2026/Nov/20/x/', publishedAt: '2026-11-20T19:21:49.000Z' });
    expect(r[0].summary).toBe('Hello & bye');
  });
  it('respects max', () => {
    const many = `<rss><channel>${Array.from({ length: 5 }, (_, i) => `<item><title>t${i}</title><link>https://a.test/${i}</link></item>`).join('')}</channel></rss>`;
    expect(parseFeed(many, 's', 2)).toHaveLength(2);
  });
});

describe('HttpClient', () => {
  it('sends an honest UA (no browser spoofing) and times out', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const http = new HttpClient({ fetchImpl });
    await http.getText('https://a.test/x');
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers['User-Agent']).toBe(WRITER_USER_AGENT);
    expect(WRITER_USER_AGENT).toContain('goodfriends-ai-social');
    expect(WRITER_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari/);
    expect(init.signal).toBeDefined();
  });
  it('throws on non-2xx and caches successful GETs', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValue(new Response('body'));
    const http = new HttpClient({ fetchImpl });
    await expect(http.getText('https://a.test/x')).rejects.toThrow('HTTP 403');
    expect(await http.getText('https://a.test/x')).toBe('body');
    expect(await http.getText('https://a.test/x')).toBe('body');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('spaces requests to the same throttled host', async () => {
    let t = 1000;
    const sleeps: number[] = [];
    const http = new HttpClient({
      fetchImpl: async () => new Response('x'),
      hostMinGapMs: { 'export.arxiv.org': 3000 },
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await http.getText('https://export.arxiv.org/a');
    await http.getText('https://export.arxiv.org/b');
    expect(sleeps).toEqual([3000]);
  });
});

describe('collectCandidates', () => {
  it('survives a failing source, dedupes by URL, caps GitHub repos', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.includes('api.github.com')) {
        return new Response(JSON.stringify([{ tag_name: 'v1', name: 'v1', html_url: `https://github.com/${url.split('/repos/')[1].split('/releases')[0]}/rel`, published_at: '2026-11-01T00:00:00Z' }]));
      }
      if (url.includes('hn.algolia.com')) return new Response('{"hits":[{"objectID":"9","title":"HN thing","url":"https://x.test/a","created_at":"2026-11-02T00:00:00Z"}]}');
      if (url.includes('huggingface.co/api/models')) return new Response('oops', { status: 500 });
      if (url.includes('huggingface.co/api/daily')) return new Response('[]');
      return new Response('', { status: 404 });
    };
    const http = new HttpClient({ fetchImpl, hostMinGapMs: {} });
    const errors: string[] = [];
    const out = await collectCandidates('local', http, { onError: (s) => errors.push(s.id) });
    expect(errors).toContain('hf:models:text-generation');
    expect(calls.filter((u) => u.includes('api.github.com')).length).toBeLessThanOrEqual(MAX_GITHUB_REPOS_PER_FETCH);
    expect(out.some((c) => c.sourceId === 'hn:story:local-llm')).toBe(true);
    expect(new Set(out.map((c) => c.url)).size).toBe(out.length);
  });
  it('returns [] for an unknown slug', async () => {
    expect(await collectCandidates('news', new HttpClient({ fetchImpl: async () => new Response('') }))).toEqual([]);
  });
});
