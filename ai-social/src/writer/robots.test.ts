import { describe, it, expect, vi } from 'vitest';
import { isPathAllowed, RobotsChecker } from './robots.js';
import { HttpClient } from './sources/http.js';

describe('robots.txt', () => {
  it('applies the * group with longest-match precedence', () => {
    const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n';
    expect(isPathAllowed(txt, '/blog/x')).toBe(true);
    expect(isPathAllowed(txt, '/private/a')).toBe(false);
    expect(isPathAllowed(txt, '/private/ok/a')).toBe(true);
  });
  it('excludes sites that block AI crawlers entirely', () => {
    const txt = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
    expect(isPathAllowed(txt, '/x')).toBe(false);
    const txt2 = 'User-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /\n';
    expect(isPathAllowed(txt2, '/x')).toBe(false);
  });
  it('treats empty Disallow as allow-all and * wildcards/$ anchors', () => {
    expect(isPathAllowed('User-agent: *\nDisallow:\n', '/a')).toBe(true);
    const txt = 'User-agent: *\nDisallow: /*.pdf$\n';
    expect(isPathAllowed(txt, '/a/b.pdf')).toBe(false);
    expect(isPathAllowed(txt, '/a/b.pdf.html')).toBe(true);
  });
  it('our own token group wins over *', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: goodfriends-ai-social\nAllow: /\n';
    expect(isPathAllowed(txt, '/a')).toBe(true);
  });
  it('RobotsChecker caches per origin and allows when robots.txt is missing', async () => {
    const fetchImpl = vi.fn(async (u: string) => (u.startsWith('https://a.test') ? new Response('User-agent: *\nDisallow: /no\n') : new Response('', { status: 404 })));
    const rc = new RobotsChecker(new HttpClient({ fetchImpl, hostMinGapMs: {} }));
    expect(await rc.isAllowed('https://a.test/no/x')).toBe(false);
    expect(await rc.isAllowed('https://a.test/yes')).toBe(true);
    expect(await rc.isAllowed('https://b.test/anything')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
