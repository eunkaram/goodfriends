import type { Candidate } from '../types.js';
import { toIso } from './xml.js';

export type HnTag = 'story' | 'ask_hn' | 'show_hn';

/** HN Algolia(search_by_date). 키워드는 선택. minPoints로 잡글 제외. */
export function buildHnUrl(opts: { tag: HnTag; query?: string; minPoints?: number; max?: number }): string {
  const p = new URLSearchParams();
  if (opts.query) p.set('query', opts.query);
  p.set('tags', opts.tag);
  if (opts.minPoints) p.set('numericFilters', `points>=${opts.minPoints}`);
  p.set('hitsPerPage', String(opts.max ?? 20));
  return `https://hn.algolia.com/api/v1/search_by_date?${p.toString()}`;
}

/**
 * Algolia 응답 → 후보. 외부 링크가 없는 글(Ask HN)은 HN 토론 페이지를 URL로 쓰고
 * story_text를 요약으로 쓴다.
 */
export function parseHnAlgolia(json: unknown, sourceId: string): Candidate[] {
  const hits = (json as any)?.hits;
  if (!Array.isArray(hits)) return [];
  const out: Candidate[] = [];
  for (const h of hits) {
    const title = typeof h?.title === 'string' ? h.title.trim() : '';
    const id = h?.objectID;
    if (!title || !id) continue;
    const url = typeof h.url === 'string' && /^https?:\/\//.test(h.url) ? h.url : `https://news.ycombinator.com/item?id=${id}`;
    const text = typeof h.story_text === 'string' ? h.story_text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    out.push({
      title,
      url,
      sourceId,
      publishedAt: toIso(h.created_at) ?? (typeof h.created_at_i === 'number' ? new Date(h.created_at_i * 1000).toISOString() : null),
      summary: text ? text.slice(0, 500) : undefined,
    });
  }
  return out;
}
