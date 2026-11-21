import type { Candidate } from '../types.js';
import { toIso } from './xml.js';

/** 무인증 REST. 저장소당 1요청(레이트리밋 60/h). */
export function buildReleasesUrl(repo: string, perPage = 5): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
}

/** releases JSON → 후보. draft·prerelease(nightly/alpha 포함)는 제외. */
export function parseGithubReleases(json: unknown, repo: string, sourceId: string): Candidate[] {
  if (!Array.isArray(json)) return [];
  const out: Candidate[] = [];
  for (const r of json) {
    if (!r || r.draft || r.prerelease) continue;
    const url = typeof r.html_url === 'string' ? r.html_url : '';
    const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
    if (!url || !tag) continue;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : tag;
    const body = typeof r.body === 'string' ? r.body.replace(/\s+/g, ' ').trim() : '';
    out.push({
      title: name.includes(tag) ? `${repo} ${name}` : `${repo} ${tag}: ${name}`,
      url,
      sourceId,
      publishedAt: toIso(r.published_at ?? r.created_at),
      summary: body ? body.slice(0, 500) : undefined,
    });
  }
  return out;
}
