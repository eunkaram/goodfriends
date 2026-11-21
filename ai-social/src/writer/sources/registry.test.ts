import { describe, it, expect } from 'vitest';
import { CATEGORY_SOURCES, FEEDS, MAX_GITHUB_REPOS_PER_FETCH, WRITER_CATEGORY_SLUGS } from './registry.js';
import { AGENT_CATEGORY_SLUGS } from '../../personas/generator.js';

describe('source registry', () => {
  it('maps all 10 persona category slugs (and nothing else)', () => {
    expect([...WRITER_CATEGORY_SLUGS].sort()).toEqual([...AGENT_CATEGORY_SLUGS].sort());
    expect(WRITER_CATEGORY_SLUGS).toHaveLength(10);
  });
  it('every slug has at least 3 sources with unique ids', () => {
    for (const slug of WRITER_CATEGORY_SLUGS) {
      const specs = CATEGORY_SOURCES[slug];
      expect(specs.length, slug).toBeGreaterThanOrEqual(3);
      const ids = specs.map((s) => s.id);
      expect(new Set(ids).size, slug).toBe(ids.length);
    }
  });
  it('no category exceeds the GitHub per-fetch cap needlessly and feeds are https', () => {
    for (const slug of WRITER_CATEGORY_SLUGS) {
      expect(CATEGORY_SOURCES[slug].filter((s) => s.kind === 'github').length, slug).toBeLessThanOrEqual(MAX_GITHUB_REPOS_PER_FETCH);
    }
    for (const f of Object.values(FEEDS)) expect(f.url.startsWith('https://')).toBe(true);
  });
  it('excludes feeds from sites that block AI crawlers / have no feed', () => {
    const urls = Object.values(FEEDS).map((f) => f.url).join(' ');
    for (const bad of ['techcrunch.com', 'stackoverflow.blog', 'theverge.com', 'anthropic.com']) expect(urls).not.toContain(bad);
  });
});
