import type { DatabaseSync } from 'node:sqlite';
import type { CommunityPost } from '../types.js';
import type { Candidate } from './types.js';
import { hasUsedUrl, normalizeUrl, recentTopicHistory } from './history.js';

export interface FeedReader {
  getFeed(options?: { categorySlug?: string; sort?: 'latest' | 'popular'; limit?: number }): Promise<CommunityPost[]>;
}

export interface TopicDeps {
  /** 카테고리 slug → 후보 수집 (운영: collectCandidates 래핑, 테스트: 픽스처) */
  collect: (category: string) => Promise<Candidate[]>;
  /** GoodfriendsClient 호환(getFeed만 필요). 생략하면 피드 대조는 건너뛴다. */
  client?: FeedReader;
  db: DatabaseSync;
  now?: () => Date;
  random?: () => number;
}

export interface TopicOptions {
  /** 신선도 반감기(일). 기본 3일. */
  halfLifeDays?: number;
  /** 이보다 오래된 후보는 제외(날짜 없는 후보는 유지하되 낮은 가중치). 기본 45일. */
  maxAgeDays?: number;
  /** 제목 유사도(바이그램 Dice) 중복 임계값. 기본 0.6. */
  titleDupThreshold?: number;
  /** 관련 후보 최대 수. 기본 5. */
  maxRelated?: number;
  /** 관련으로 인정할 최소 유사도. 기본 0.12. */
  relatedMinSimilarity?: number;
  feedLimit?: number;
  historyDays?: number;
}

export interface TopicSelection {
  category: string;
  topic: Candidate;
  /** 주제와 제목이 비슷한 후보(서로 다른 소스 우선) */
  related: Candidate[];
  /** 나머지 후보(facts가 원문 부족 시 보충에 사용, 가중치 순) */
  rest: Candidate[];
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function bigrams(s: string): Map<string, number> {
  const compact = s.replace(/\s+/g, ' ');
  const m = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 문자 바이그램 Dice 계수(0~1). 한국어·영어 모두 동작. */
export function titleSimilarity(a: string, b: string): number {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let inter = 0;
  let total = 0;
  for (const v of ba.values()) total += v;
  for (const v of bb.values()) total += v;
  for (const [g, v] of ba) inter += Math.min(v, bb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'how', 'what', 'why', 'new', 'ai', 'hn', 'ask', 'show']);

function tokens(t: string): Set<string> {
  return new Set(normTitle(t).split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w)));
}

/** 주제 관련도: 단어 겹침(Jaccard)과 바이그램 유사도 중 큰 값. */
function relatedness(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  const jac = union === 0 ? 0 : inter / union;
  return Math.max(jac, titleSimilarity(a, b) * 0.8);
}

/** 신선도 가중치: 0.5^(나이/반감기). 날짜 없음은 14일 묵은 것으로 취급. 바닥 0.02. */
export function freshnessWeight(publishedAt: string | null, now: Date, halfLifeDays = 3): number {
  const t = publishedAt ? Date.parse(publishedAt) : NaN;
  const ageDays = Number.isNaN(t) ? 14 : Math.max(0, (now.getTime() - t) / 86400000);
  return Math.max(0.02, Math.pow(0.5, ageDays / halfLifeDays));
}

function weightedPick<T>(items: T[], weight: (t: T) => number, random: () => number): T | null {
  const total = items.reduce((s, it) => s + weight(it), 0);
  if (items.length === 0 || total <= 0) return null;
  let r = random() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/**
 * 카테고리 → 후보 수집 → 중복 제외(URL·제목: 최근 goodfriends 카테고리 피드 + 로컬 사용 이력) →
 * 신선도 가중 무작위 선택 → 주제 1개 + 관련 후보 묶음. 남는 후보가 없으면 null.
 * 이력 기록은 하지 않는다(실제 글을 올린 뒤 recordTopicUsage로).
 */
export async function pickTopic(category: string, deps: TopicDeps, opts: TopicOptions = {}): Promise<TopicSelection | null> {
  const now = (deps.now ?? (() => new Date()))();
  const random = deps.random ?? Math.random;
  const threshold = opts.titleDupThreshold ?? 0.6;
  const maxAgeMs = (opts.maxAgeDays ?? 45) * 86400000;

  const collected = await deps.collect(category);

  // 비교 기준: 사용 이력 제목 + 최근 피드(제목, 본문 미리보기 안의 URL)
  const knownTitles: string[] = recentTopicHistory(deps.db, { category, days: opts.historyDays ?? 60, now }).map((h) => h.title);
  const feedUrls = new Set<string>();
  if (deps.client) {
    try {
      const posts = await deps.client.getFeed({ categorySlug: category, sort: 'latest', limit: opts.feedLimit ?? 30 });
      for (const p of posts) {
        knownTitles.push(p.title);
        for (const m of p.bodyPreview.match(/https?:\/\/[^\s)"'<>\]]+/g) ?? []) feedUrls.add(normalizeUrl(m));
      }
    } catch {
      /* 피드 조회 실패 시 이력만으로 진행 */
    }
  }

  const seen = new Set<string>();
  const pool: Candidate[] = [];
  for (const c of collected) {
    const key = normalizeUrl(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    if (feedUrls.has(key) || hasUsedUrl(deps.db, c.url)) continue;
    if (knownTitles.some((t) => titleSimilarity(t, c.title) >= threshold)) continue;
    if (c.publishedAt) {
      const t = Date.parse(c.publishedAt);
      if (!Number.isNaN(t) && now.getTime() - t > maxAgeMs) continue;
    }
    // 같은 수집 안에서 제목이 거의 같은 후보(여러 소스의 같은 뉴스)는 첫 번째만 둔다
    if (pool.some((p) => titleSimilarity(p.title, c.title) >= 0.85)) continue;
    pool.push(c);
  }
  if (pool.length === 0) return null;

  const w = (c: Candidate) => freshnessWeight(c.publishedAt, now, opts.halfLifeDays);
  const topic = weightedPick(pool, w, random);
  if (!topic) return null;

  const others = pool.filter((c) => c !== topic);
  const minSim = opts.relatedMinSimilarity ?? 0.12;
  const scored = others
    .map((c) => ({ c, sim: relatedness(topic.title, c.title) }))
    .filter((x) => x.sim >= minSim)
    // 주제와 같은 소스는 뒤로(출처 다양성), 그다음 유사도·신선도
    .sort((a, b) => Number(a.c.sourceId === topic.sourceId) - Number(b.c.sourceId === topic.sourceId) || b.sim + w(b.c) * 0.3 - (a.sim + w(a.c) * 0.3));
  const related = scored.slice(0, opts.maxRelated ?? 5).map((x) => x.c);
  const rest = others.filter((c) => !related.includes(c)).sort((a, b) => w(b) - w(a));

  return { category, topic, related, rest };
}
