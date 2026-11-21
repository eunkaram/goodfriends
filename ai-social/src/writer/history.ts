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

const NORM_TABLES = ['writer_topic_history', 'used_source_urls'] as const;

/**
 * norm_url이 비어 있는 행(컬럼 추가 전 행, 또는 컬럼을 모르는 예전 코드가 넣은 행)을 채운다.
 * norm_url 인덱스로 IS NULL을 찾으므로 채울 게 없으면 거의 공짜다.
 */
export function backfillNormUrls(db: DatabaseSync): void {
  for (const table of NORM_TABLES) {
    const rows = db.prepare(`SELECT url FROM ${table} WHERE norm_url IS NULL`).all() as { url: string }[];
    if (rows.length === 0) continue;
    const update = db.prepare(`UPDATE ${table} SET norm_url = ? WHERE url = ?`);
    db.exec('BEGIN');
    try {
      for (const r of rows) update.run(normalizeUrl(r.url), r.url);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

const IN_CHUNK = 400;

/** 주어진 URL들 중 이미 쓴 것의 "정규화 키" 집합. writer 이력 + 구 used_source_urls를 인덱스로 한 번에 조회한다. */
export function hasUsedUrls(db: DatabaseSync, urls: string[]): Set<string> {
  backfillNormUrls(db);
  const keys = [...new Set(urls.map(normalizeUrl))];
  const used = new Set<string>();
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const chunk = keys.slice(i, i + IN_CHUNK);
    const marks = chunk.map(() => '?').join(',');
    for (const table of NORM_TABLES) {
      const rows = db.prepare(`SELECT norm_url FROM ${table} WHERE norm_url IN (${marks})`).all(...chunk) as { norm_url: string }[];
      for (const r of rows) used.add(r.norm_url);
    }
  }
  return used;
}

/** 이미 쓴 URL인가: writer 이력 + 기존 used_source_urls(구 퍼온글 경로) 둘 다 본다. */
export function hasUsedUrl(db: DatabaseSync, url: string): boolean {
  return hasUsedUrls(db, [url]).has(normalizeUrl(url));
}

export function recordTopicUsage(
  db: DatabaseSync,
  entry: { url: string; title: string; category: string; agentId?: string },
  now: Date = new Date()
): void {
  db.prepare(
    `INSERT INTO writer_topic_history (url, title, category, agent_id, used_at, norm_url) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO NOTHING`
  ).run(entry.url, entry.title, entry.category, entry.agentId ?? null, now.toISOString(), normalizeUrl(entry.url));
}

/** 최근 N일 이력(제목 유사도 비교용). category 생략 시 전체. */
export function recentTopicHistory(db: DatabaseSync, opts: { category?: string; days?: number; now?: Date } = {}): TopicHistoryEntry[] {
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? 30) * 86400000).toISOString();
  const rows = opts.category
    ? db.prepare(`SELECT url, title, category, used_at FROM writer_topic_history WHERE category = ? AND used_at >= ? ORDER BY used_at DESC`).all(opts.category, since)
    : db.prepare(`SELECT url, title, category, used_at FROM writer_topic_history WHERE used_at >= ? ORDER BY used_at DESC`).all(since);
  return (rows as any[]).map((r) => ({ url: r.url, title: r.title, category: r.category, usedAt: r.used_at }));
}
