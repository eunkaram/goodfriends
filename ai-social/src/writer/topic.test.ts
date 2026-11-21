import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import type { CommunityPost } from '../types.js';
import { recordTopicUsage } from './history.js';
import { freshnessWeight, pickTopic, titleSimilarity } from './topic.js';
import type { Candidate } from './types.js';

const NOW = new Date('2026-11-20T00:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();
const cand = (title: string, url: string, ago: number | null, sourceId = 's:a'): Candidate => ({ title, url, sourceId, publishedAt: ago === null ? null : day(ago) });
const post = (title: string, bodyPreview = ''): CommunityPost => ({ title, bodyPreview }) as CommunityPost;

describe('titleSimilarity / freshnessWeight', () => {
  it('identical and near-identical titles score high, unrelated low (en + ko)', () => {
    expect(titleSimilarity('Ollama v0.5 released', 'ollama v0.5 released!')).toBe(1);
    expect(titleSimilarity('Ollama v0.5 released', 'Ollama 0.5 release notes')).toBeGreaterThan(0.6);
    expect(titleSimilarity('Ollama v0.5 released', 'Image vectorization with language priors')).toBeLessThan(0.3);
    expect(titleSimilarity('로컬 LLM 속도 비교', '로컬 LLM 속도 비교해봤어요')).toBeGreaterThan(0.6);
    expect(titleSimilarity('', 'x')).toBe(0);
  });
  it('halves weight every half-life, floors, and treats missing dates as old', () => {
    expect(freshnessWeight(day(0), NOW, 3)).toBeCloseTo(1);
    expect(freshnessWeight(day(3), NOW, 3)).toBeCloseTo(0.5);
    expect(freshnessWeight(day(300), NOW, 3)).toBe(0.02);
    expect(freshnessWeight(null, NOW, 3)).toBeCloseTo(Math.pow(0.5, 14 / 3));
  });
});

describe('pickTopic', () => {
  let dir: string;
  let db: DatabaseSync;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-topic-'));
    db = openDatabase(dir);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = (cands: Candidate[], extra: Partial<Parameters<typeof pickTopic>[1]> = {}) => ({
    collect: async () => cands,
    db,
    now: () => NOW,
    random: () => 0,
    ...extra,
  });

  it('returns null when there are no candidates', async () => {
    expect(await pickTopic('local', base([]))).toBeNull();
  });

  it('excludes URLs and similar titles already used (local history + legacy table)', async () => {
    recordTopicUsage(db, { url: 'https://a.test/used', title: 'Ollama v0.5 released', category: 'local' }, new Date(day(2)));
    db.prepare(`INSERT INTO used_source_urls (url, agent_id, used_at) VALUES (?, ?, ?)`).run('https://a.test/legacy', 'x', day(1));
    const sel = await pickTopic(
      'local',
      base([
        cand('Totally different thing about GPUs', 'https://a.test/used?utm_source=x', 1), // URL dup (normalized)
        cand('Ollama 0.5 released', 'https://b.test/ollama', 1), // title dup
        cand('Legacy used', 'https://a.test/legacy', 1),
        cand('vLLM adds speculative decoding', 'https://c.test/vllm', 1),
      ])
    );
    expect(sel?.topic.url).toBe('https://c.test/vllm');
    expect(sel?.related).toEqual([]);
    expect(sel?.rest).toEqual([]);
  });

  it('excludes posts already in the recent goodfriends category feed (title and URL in body)', async () => {
    const client = {
      getFeed: async (o?: { categorySlug?: string }) => {
        expect(o?.categorySlug).toBe('coding');
        return [post('Claude Code 2.1 업데이트 정리', ''), post('다른 글', '원문: https://github.com/anthropics/claude-code/releases/tag/v2/')];
      },
    };
    const sel = await pickTopic(
      'coding',
      base(
        [
          cand('Claude Code 2.1 업데이트 정리', 'https://x.test/1', 0),
          cand('Release v2', 'https://github.com/anthropics/claude-code/releases/tag/v2', 0),
          cand('Brand new cursor rules guide', 'https://x.test/3', 5),
        ],
        { client }
      )
    );
    expect(sel?.topic.url).toBe('https://x.test/3');
  });

  it('keeps going when the feed call throws', async () => {
    const sel = await pickTopic('qna', base([cand('Only one', 'https://a.test/1', 1)], { client: { getFeed: async () => { throw new Error('down'); } } }));
    expect(sel?.topic.title).toBe('Only one');
  });

  it('drops candidates older than maxAgeDays but keeps undated ones', async () => {
    const sel = await pickTopic('qna', base([cand('Ancient', 'https://a.test/old', 100), cand('Undated', 'https://a.test/u', null)]));
    expect(sel?.topic.title).toBe('Undated');
    expect(sel?.rest).toEqual([]);
  });

  it('weights by freshness: random just below the fresh item share picks it, otherwise old', async () => {
    const cands = [cand('Fresh llama news', 'https://a.test/fresh', 0), cand('Month old gardening tips', 'https://a.test/old', 30)];
    // weights: 1 vs ~0.001->0.02 floor? 0.5^(10)=0.00098 -> floor 0.02; total 1.02
    const fresh = await pickTopic('free', base(cands, { random: () => 0.5 }));
    expect(fresh?.topic.url).toBe('https://a.test/fresh');
    const old = await pickTopic('free', base(cands, { random: () => 0.999 }));
    expect(old?.topic.url).toBe('https://a.test/old');
  });

  it('statistically prefers fresh candidates', async () => {
    const cands = [cand('Fresh', 'https://a.test/f', 0), cand('Stale zebra', 'https://a.test/s', 20)];
    let fresh = 0;
    for (let i = 0; i < 200; i++) {
      const sel = await pickTopic('free', base(cands, { random: () => (i + 0.5) / 200 }));
      if (sel?.topic.url === 'https://a.test/f') fresh++;
    }
    expect(fresh).toBeGreaterThan(180);
  });

  it('groups related candidates (other sources first) and leaves the rest', async () => {
    const sel = await pickTopic(
      'local',
      base([
        cand('Ollama 0.5 adds MLX backend', 'https://a.test/1', 0, 's:github'),
        cand('Ollama MLX backend benchmarks on Apple silicon', 'https://b.test/2', 1, 's:hn'),
        cand('Ollama 0.5 changelog MLX', 'https://c.test/3', 1, 's:github'),
        cand('Sourdough bread starter guide', 'https://d.test/4', 1, 's:rss'),
      ])
    );
    expect(sel?.topic.url).toBe('https://a.test/1');
    expect(sel?.related.map((c) => c.url)).toEqual(['https://b.test/2', 'https://c.test/3']); // different source first
    expect(sel?.rest.map((c) => c.url)).toEqual(['https://d.test/4']);
  });

  it('dedupes same URL within one collection', async () => {
    const sel = await pickTopic('qna', base([cand('A thing', 'https://a.test/1', 0), cand('A thing again', 'https://www.a.test/1/', 0)]));
    expect(sel?.related).toEqual([]);
    expect(sel?.rest).toEqual([]);
  });
});
