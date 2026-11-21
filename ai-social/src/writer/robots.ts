import type { HttpClient } from './sources/http.js';

const OUR_TOKEN = 'goodfriends-ai-social';
/** 이 중 하나라도 사이트 전체를 막으면(Disallow: /) AI 수집을 거부한 것으로 보고 제외한다. */
const AI_CRAWLER_TOKENS = ['gptbot', 'claudebot', 'anthropic-ai', 'claude-web', 'ccbot', 'perplexitybot', 'google-extended'];

interface Rule {
  allow: boolean;
  path: string;
}
interface Group {
  agents: string[];
  rules: Rule[];
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false;
      if (value) cur.rules.push({ allow: key === 'allow', path: value });
      else if (key === 'disallow') cur.rules.push({ allow: true, path: '/' }); // 빈 Disallow = 전체 허용
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function matches(rulePath: string, path: string): boolean {
  const pattern = rulePath.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = pattern.endsWith('\\$') ? `${pattern.slice(0, -2)}$` : pattern;
  return new RegExp(`^${anchored}`).test(path);
}

function allowedBy(group: Group | undefined, path: string): boolean {
  if (!group) return true;
  let best: Rule | null = null;
  for (const r of group.rules) {
    if (matches(r.path, path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

export function isPathAllowed(robotsText: string, path: string): boolean {
  const groups = parseRobots(robotsText);
  const find = (token: string) => groups.find((g) => g.agents.includes(token));
  // 사이트 전체를 AI 크롤러에 막은 경우 → 제외
  for (const token of AI_CRAWLER_TOKENS) {
    const g = find(token);
    if (g && !allowedBy(g, '/')) return false;
  }
  return allowedBy(find(OUR_TOKEN) ?? find('*'), path);
}

/**
 * origin별 robots.txt를 가져와(캐시) URL 허용 여부를 판단. robots.txt가 없거나(4xx) 가져오기에
 * 실패하면 허용으로 본다(5xx·네트워크 오류도 허용 — 단, 이 경우 호출자가 원문 fetch에서 다시 실패할 수 있음).
 */
export class RobotsChecker {
  private cache = new Map<string, string | null>();
  constructor(private http: HttpClient) {}

  async isAllowed(url: string): Promise<boolean> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const origin = u.origin;
    if (!this.cache.has(origin)) {
      try {
        const res = await this.http.request(`${origin}/robots.txt`, { Accept: 'text/plain' });
        this.cache.set(origin, res.ok ? await res.text() : null);
      } catch {
        this.cache.set(origin, null);
      }
    }
    const text = this.cache.get(origin);
    if (!text) return true;
    return isPathAllowed(text, `${u.pathname}${u.search}`);
  }
}
