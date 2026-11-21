/**
 * 초안(drafts) 저장소. DRY_RUN이면 게시 대신 여기에 저장하고(passed·discarded 모두), 실제 게시하면 publishedPostId를 채운다.
 * 스키마는 db/database.ts(CREATE TABLE IF NOT EXISTS, migrate 패턴).
 */
import type { DatabaseSync } from 'node:sqlite';
import type { FactCard } from './types.js';

export interface DraftRecord {
  id: string;
  personaId: string;
  category: string;
  status: 'passed' | 'discarded';
  title: string;
  body: string;
  sources: { url: string; title: string }[];
  facts: FactCard[];
  review: unknown;
  images: unknown[];
  reasons: string[];
  createdAt: string;
  publishedPostId: string | null;
}

export type NewDraft = Omit<DraftRecord, 'id' | 'createdAt' | 'publishedPostId'> & { id?: string; createdAt?: string };

export interface DraftSummary {
  id: string;
  personaId: string;
  category: string;
  status: 'passed' | 'discarded';
  title: string;
  reasons: string[];
  createdAt: string;
  publishedPostId: string | null;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function rowToRecord(r: any): DraftRecord {
  return {
    id: r.id,
    personaId: r.persona_id,
    category: r.category,
    status: r.status,
    title: r.title,
    body: r.body,
    sources: parseJson(r.sources, []),
    facts: parseJson(r.facts, []),
    review: parseJson(r.review, null),
    images: parseJson(r.images, []),
    reasons: parseJson(r.reasons, []),
    createdAt: r.created_at,
    publishedPostId: r.published_post_id ?? null,
  };
}

export class DraftStore {
  constructor(private db: DatabaseSync) {}

  insert(d: NewDraft): DraftRecord {
    const id = d.id ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = d.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO drafts (id, persona_id, category, status, title, body, sources, facts, review, images, reasons, created_at, published_post_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        id, d.personaId, d.category, d.status, d.title, d.body,
        JSON.stringify(d.sources), JSON.stringify(d.facts), JSON.stringify(d.review ?? null), JSON.stringify(d.images), JSON.stringify(d.reasons),
        createdAt
      );
    return { ...d, id, createdAt, publishedPostId: null };
  }

  setPublished(id: string, publishedPostId: string): void {
    this.db.prepare(`UPDATE drafts SET published_post_id = ? WHERE id = ?`).run(publishedPostId, id);
  }

  get(id: string): DraftRecord | null {
    const row = this.db.prepare(`SELECT * FROM drafts WHERE id = ?`).get(id);
    return row ? rowToRecord(row) : null;
  }

  /** 이 페르소나가 최근 N일 안에 만든 passed 초안의 제목(제목 중복 검사용, 최신순 최대 30개). */
  recentPassedTitles(personaId: string, days = 30, now: Date = new Date()): string[] {
    const since = new Date(now.getTime() - days * 86400000).toISOString();
    const rows = this.db
      .prepare(`SELECT title FROM drafts WHERE persona_id = ? AND status = 'passed' AND created_at >= ? ORDER BY created_at DESC LIMIT 30`)
      .all(personaId, since) as { title: string }[];
    return rows.map((r) => r.title);
  }

  /** 최신순 목록(본문·사실 카드 제외). */
  list(opts: { limit?: number; status?: string; category?: string } = {}): DraftSummary[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.status === 'passed' || opts.status === 'discarded') {
      where.push('status = ?');
      args.push(opts.status);
    }
    if (opts.category) {
      where.push('category = ?');
      args.push(opts.category);
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(
        `SELECT id, persona_id, category, status, title, reasons, created_at, published_post_id FROM drafts
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(...args, limit) as any[];
    return rows.map((r) => ({
      id: r.id, personaId: r.persona_id, category: r.category, status: r.status, title: r.title,
      reasons: parseJson(r.reasons, []), createdAt: r.created_at, publishedPostId: r.published_post_id ?? null,
    }));
  }
}
