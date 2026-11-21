import type { DatabaseSync } from 'node:sqlite';

export interface TopicHistoryEntry {
  url: string;
  title: string;
  category: string;
  usedAt: string;
}

/** 비교용 URL 정규화: 해시·추적 파라미터 제거, www. 제거, 끝 슬래시 제거, arXiv 버전 접미사 제거. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^utm_/i.test(key) || ['ref', 'ref_src', 'fbclid', 'gclid'].includes(key.toLowerCase())) u.searchParams.delete(key);
    }
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    if (host.endsWith('arxiv.org')) path = path.replace(/v\d+$/, '');
    const q = u.searchParams.toString();
    return `${host}${path}${q ? `?${q}` : ''}`;
  } catch {
    return raw.trim();
  }
}

/** 이미 쓴 URL인가: writer 이력 + 기존 used_source_urls(구 퍼온글 경로) 둘 다 본다. */
export function hasUsedUrl(db: DatabaseSync, url: string): boolean {
  const norm = normalizeUrl(url);
  const rows = db.prepare(`SELECT url FROM writer_topic_history`).all() as { url: string }[];
  if (rows.some((r) => normalizeUrl(r.url) === norm)) return true;
  const legacy = db.prepare(`SELECT url FROM used_source_urls`).all() as { url: string }[];
  return legacy.some((r) => normalizeUrl(r.url) === norm);
}

export function recordTopicUsage(
  db: DatabaseSync,
  entry: { url: string; title: string; category: string; agentId?: string },
  now: Date = new Date()
): void {
  db.prepare(
    `INSERT INTO writer_topic_history (url, title, category, agent_id, used_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO NOTHING`
  ).run(entry.url, entry.title, entry.category, entry.agentId ?? null, now.toISOString());
}

/** 최근 N일 이력(제목 유사도 비교용). category 생략 시 전체. */
export function recentTopicHistory(db: DatabaseSync, opts: { category?: string; days?: number; now?: Date } = {}): TopicHistoryEntry[] {
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? 30) * 86400000).toISOString();
  const rows = opts.category
    ? db.prepare(`SELECT url, title, category, used_at FROM writer_topic_history WHERE category = ? AND used_at >= ? ORDER BY used_at DESC`).all(opts.category, since)
    : db.prepare(`SELECT url, title, category, used_at FROM writer_topic_history WHERE used_at >= ? ORDER BY used_at DESC`).all(since);
  return (rows as any[]).map((r) => ({ url: r.url, title: r.title, category: r.category, usedAt: r.used_at }));
}
