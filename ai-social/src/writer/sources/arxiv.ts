import type { Candidate } from '../types.js';
import { childText, parseXml, toIso } from './xml.js';

export const ARXIV_API = 'https://export.arxiv.org/api/query';

/** 카테고리 목록(cs.CL 등) + 선택적 초록 키워드 → API URL. 최신 제출순. */
export function buildArxivUrl(categories: string[], opts: { keyword?: string; max?: number } = {}): string {
  const cats = categories.map((c) => `cat:${c}`).join('+OR+');
  const q = opts.keyword ? `(${cats})+AND+abs:${encodeURIComponent(opts.keyword)}` : cats;
  return `${ARXIV_API}?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=${opts.max ?? 15}`;
}

/** arXiv Atom 응답 → 후보. 버전 접미사(v1)는 URL에서 제거한다. */
export function parseArxivAtom(xml: string, sourceId: string): Candidate[] {
  const doc = parseXml(xml);
  const out: Candidate[] = [];
  for (const entry of Array.from(doc.getElementsByTagName('entry')) as any[]) {
    const title = childText(entry, 'title').replace(/\s+/g, ' ');
    const id = childText(entry, 'id');
    if (!title || !id) continue;
    const url = id.replace(/^http:\/\//, 'https://').replace(/v\d+$/, '');
    const summary = childText(entry, 'summary').replace(/\s+/g, ' ');
    out.push({
      title,
      url,
      sourceId,
      publishedAt: toIso(childText(entry, 'published')),
      summary: summary || undefined,
    });
  }
  return out;
}
