import { describe, it, expect, vi } from 'vitest';
import { buildResearchBundle, chunkText, extractFactsFromArticle, normalizeWs, parseFactResponse, validateCards, type FactLlm } from './facts.js';
import type { ArticleContent, Candidate } from './types.js';
import type { TopicSelection } from './topic.js';
import { config } from '../config.js';

const TEXT = 'Ollama 0.5 adds an MLX backend for Apple silicon.\nIt reduces   memory usage\nby about a third on M-series chips. Release notes list 12 fixes.';
const article = (url = 'https://a.test/1', text = TEXT): ArticleContent => ({
  url,
  title: `Title ${url}`,
  text,
  publishedAt: '2026-11-18T00:00:00.000Z',
  siteName: 'Site',
  images: ['https://a.test/i.png'],
  ogImage: null,
});
const cand = (n: number, sourceId = `s:${n}`): Candidate => ({ title: `Cand ${n}`, url: `https://a.test/${n}`, sourceId, publishedAt: null });
const reply = (facts: { claim: string; quote: string }[]) => JSON.stringify({ facts });
const GOOD = { claim: 'MLX 백엔드가 추가됨', quote: 'Ollama 0.5 adds an MLX backend for Apple silicon.' };

describe('helpers', () => {
  it('normalizeWs collapses whitespace', () => {
    expect(normalizeWs('  a \n\t b  ')).toBe('a b');
  });
  it('parseFactResponse handles fences, array root, garbage', () => {
    expect(parseFactResponse('```json\n{"facts":[{"claim":"c","quote":"q"}]}\n```')).toEqual([{ claim: 'c', quote: 'q' }]);
    expect(parseFactResponse('[{"claim":"c","quote":"q"},{"claim":"","quote":"q"}]')).toEqual([{ claim: 'c', quote: 'q' }]);
    expect(parseFactResponse('Sure! here: {"facts":[{"claim":"c","quote":"q"}]} done')).toEqual([{ claim: 'c', quote: 'q' }]);
    expect(parseFactResponse('not json at all')).toBeNull();
    expect(parseFactResponse('{"other":1}')).toBeNull();
  });
  it('chunkText: 0 이하·NaN 크기여도 무한 루프 없이 끝난다', () => {
    for (const size of [0, -5, Number.NaN]) {
      const chunks = chunkText('x'.repeat(30), size);
      expect(chunks.join('')).toBe('x'.repeat(30));
      expect(chunks.length).toBeGreaterThan(0);
    }
  });
  it('chunkText splits on paragraphs and hard-splits overlong ones', () => {
    const chunks = chunkText('aaaa\nbbbb\ncccc', 10);
    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(chunkText('x'.repeat(25), 10)).toHaveLength(3);
  });
});

describe('validateCards', () => {
  const meta = { url: 'https://a.test/1', sourceTitle: 'T', publishedAt: null };
  it('keeps quotes found after whitespace normalization, discards fabricated/short/duplicate ones', () => {
    const cards = validateCards(
      [
        GOOD,
        { claim: 'c2', quote: 'It reduces memory usage by about a third on M-series chips.' }, // original has newline/extra spaces
        { claim: 'c3', quote: 'Ollama 0.5 doubles throughput on every GPU.' }, // fabricated
        { claim: 'c4', quote: 'Release' }, // too short
        { claim: 'c5', quote: 'Ollama 0.5 adds an MLX backend   for Apple silicon.' }, // duplicate of GOOD after normalization
      ],
      TEXT,
      meta
    );
    expect(cards.map((c) => c.claim)).toEqual(['MLX 백엔드가 추가됨', 'c2']);
    expect(cards[0]).toMatchObject({ url: meta.url, sourceTitle: 'T', publishedAt: null });
  });
});

describe('extractFactsFromArticle', () => {
  it('passes jsonMode + longTimeoutMs to the LLM and returns validated cards', async () => {
    const chat = vi.fn().mockResolvedValue(reply([GOOD, { claim: 'x', quote: 'invented sentence that is absent' }]));
    const cards = await extractFactsFromArticle(article(), { llm: { chat } });
    expect(cards).toHaveLength(1);
    const [, jsonMode, options] = chat.mock.calls[0];
    expect(jsonMode).toBe(true);
    expect(options.timeoutMs).toBe(config.llm.longTimeoutMs);
  });
  it('respects an explicit timeout override', async () => {
    const chat = vi.fn().mockResolvedValue(reply([]));
    await extractFactsFromArticle(article(), { llm: { chat }, timeoutMs: 1234 });
    expect(chat.mock.calls[0][2].timeoutMs).toBe(1234);
  });
  it('splits long text into chunks (one call each, capped) and validates against the whole text', async () => {
    const long = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ` + 'w'.repeat(80)).join('\n');
    const chat = vi.fn().mockResolvedValue(reply([]));
    await extractFactsFromArticle(article('https://a.test/l', long), { llm: { chat } }, { chunkChars: 200, maxChunks: 3 });
    expect(chat).toHaveBeenCalledTimes(3);
  });
  it('survives unparsable replies and LLM errors (no throw, no cards)', async () => {
    const logs: string[] = [];
    const chat = vi.fn().mockResolvedValueOnce('garbage').mockRejectedValueOnce(new Error('timeout'));
    const long = 'p1 ' + 'a'.repeat(100) + '\n' + 'p2 ' + 'b'.repeat(100);
    const cards = await extractFactsFromArticle(article('https://a.test/e', long), { llm: { chat }, log: (m) => logs.push(m) }, { chunkChars: 110 });
    expect(cards).toEqual([]);
    expect(logs.some((l) => l.includes('파싱 실패'))).toBe(true);
    expect(logs.some((l) => l.includes('호출 실패'))).toBe(true);
  });
});

describe('buildResearchBundle', () => {
  const selection = (topic: Candidate, related: Candidate[], rest: Candidate[] = []): TopicSelection => ({ category: 'local', topic, related, rest });
  const okLlm = (): FactLlm => ({ chat: vi.fn().mockResolvedValue(reply([GOOD])) });
  const fetchOk = async (url: string) => article(url);

  it('builds a bundle from topic + related (3+ sources) with cards tagged by source', async () => {
    const r = await buildResearchBundle(selection(cand(1), [cand(2), cand(3)]), { llm: okLlm(), fetchArticle: fetchOk });
    expect(r.bundle?.category).toBe('local');
    expect(r.bundle?.topic.url).toBe('https://a.test/1');
    expect(r.bundle?.sources.map((s) => s.url)).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/3']);
    expect(r.bundle?.sources[0].images).toEqual(['https://a.test/i.png']);
    expect(r.bundle?.facts.map((f) => f.url)).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/3']);
  });

  it('supplements from rest (other source ids first) when fewer than 3 are usable', async () => {
    const rest = [cand(4, 's:1'), cand(5, 's:new')];
    const fetched: string[] = [];
    const r = await buildResearchBundle(selection(cand(1), [], rest), {
      llm: okLlm(),
      fetchArticle: async (u) => {
        fetched.push(u);
        return article(u);
      },
    });
    expect(r.bundle?.sources).toHaveLength(3);
    expect(fetched).toEqual(['https://a.test/1', 'https://a.test/5', 'https://a.test/4']); // s:new before the repeat of s:1
  });

  it('abandons the topic when fewer than 3 sources are usable', async () => {
    const r = await buildResearchBundle(selection(cand(1), [cand(2)], [cand(3)]), {
      llm: okLlm(),
      fetchArticle: async (u) => (u.endsWith('/3') ? null : article(u)),
    });
    expect(r.bundle).toBeNull();
    expect(r.reason).toContain('2건 < 3건');
  });

  it('does not count sources whose cards were all discarded by quote validation', async () => {
    const llm: FactLlm = { chat: vi.fn().mockResolvedValue(reply([{ claim: 'x', quote: 'this sentence is not in the article at all' }])) };
    const r = await buildResearchBundle(selection(cand(1), [cand(2), cand(3)]), { llm, fetchArticle: fetchOk });
    expect(r.bundle).toBeNull();
  });

  it('abandons when the topic source itself yields nothing even if others work', async () => {
    const r = await buildResearchBundle(selection(cand(1), [cand(2), cand(3)], [cand(4)]), {
      llm: okLlm(),
      fetchArticle: async (u) => (u.endsWith('/1') ? null : article(u)),
    });
    expect(r.bundle).toBeNull();
    expect(r.reason).toContain('주제');
  });

  it('caps at 8 sources and survives LLM failure on one source', async () => {
    const related = Array.from({ length: 9 }, (_, i) => cand(i + 2));
    const chat = vi.fn().mockRejectedValueOnce(new Error('x')); // 주제 원문의 청크 1개 → LLM 호출 1번이 실패
    chat.mockResolvedValue(reply([GOOD]));
    const r = await buildResearchBundle(selection(cand(1), related), { llm: { chat }, fetchArticle: fetchOk });
    // topic's single chunk call fails -> topic unusable -> abandoned
    expect(r.bundle).toBeNull();
    const r2 = await buildResearchBundle(selection(cand(1), related), { llm: okLlm(), fetchArticle: fetchOk });
    expect(r2.bundle?.sources).toHaveLength(8);
  });

  it('falls back to the candidate publishedAt for cards when the article has no date', async () => {
    const dated = { ...cand(1), publishedAt: '2026-11-15T00:00:00.000Z' };
    const r = await buildResearchBundle(selection(dated, [cand(2), cand(3)]), {
      llm: okLlm(),
      fetchArticle: async (u) => ({ ...article(u), publishedAt: null }),
    });
    expect(r.bundle?.facts[0].publishedAt).toBe('2026-11-15T00:00:00.000Z');
    expect(r.bundle?.sources[0].publishedAt).toBe('2026-11-15T00:00:00.000Z');
  });

  it('passes candidate hints (summary) to fetchArticle', async () => {
    const fa = vi.fn(async (u: string, _hint?: unknown) => article(u));
    await buildResearchBundle(selection({ ...cand(1), summary: 'S' }, [cand(2), cand(3)]), { llm: okLlm(), fetchArticle: fa });
    expect(fa.mock.calls[0][1]).toMatchObject({ title: 'Cand 1', summary: 'S' });
  });
});
