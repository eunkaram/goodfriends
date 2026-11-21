import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import { hasUsedUrl, hasUsedUrls, normalizeUrl, recentTopicHistory, recordTopicUsage } from './history.js';

describe('writer history', () => {
  let dir: string;
  let db: DatabaseSync;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-history-'));
    db = openDatabase(dir);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes tracking params, www, trailing slash, hash, arXiv versions', () => {
    expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&id=1#top')).toBe('example.com/a?id=1');
    expect(normalizeUrl('https://arxiv.org/abs/2611.26613v2')).toBe(normalizeUrl('http://arxiv.org/abs/2611.26613'));
  });

  it('records usage and detects used URLs (normalized), idempotent', () => {
    recordTopicUsage(db, { url: 'https://example.com/a/', title: 'A', category: 'qna', agentId: 'x' });
    recordTopicUsage(db, { url: 'https://example.com/a/', title: 'A again', category: 'qna' });
    expect(hasUsedUrl(db, 'https://www.example.com/a?utm_medium=y')).toBe(true);
    expect(hasUsedUrl(db, 'https://example.com/b')).toBe(false);
    expect(recentTopicHistory(db, { category: 'qna' })).toHaveLength(1);
  });

  it('also honours the legacy used_source_urls table', () => {
    db.prepare(`INSERT INTO used_source_urls (url, agent_id, used_at) VALUES (?, ?, ?)`).run('https://old.test/p', 'a', new Date().toISOString());
    expect(hasUsedUrl(db, 'https://old.test/p')).toBe(true);
  });

  it('filters history by category and age', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    recordTopicUsage(db, { url: 'https://a.test/1', title: 'old', category: 'qna' }, new Date('2026-08-01T00:00:00Z'));
    recordTopicUsage(db, { url: 'https://a.test/2', title: 'new', category: 'qna' }, new Date('2026-11-19T00:00:00Z'));
    recordTopicUsage(db, { url: 'https://a.test/3', title: 'other', category: 'free' }, new Date('2026-11-19T00:00:00Z'));
    expect(recentTopicHistory(db, { category: 'qna', days: 30, now }).map((h) => h.title)).toEqual(['new']);
    expect(recentTopicHistory(db, { days: 30, now })).toHaveLength(2);
  });
});

describe('writer history: 정규화 키 컬럼·일괄 조회', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-history-norm-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hasUsedUrls: 여러 URL을 한 번에 조회해 정규화 키 집합을 돌려준다(400개 초과 청크도)', () => {
    const db = openDatabase(dir);
    recordTopicUsage(db, { url: 'https://example.com/a/', title: 'A', category: 'qna' });
    db.prepare(`INSERT INTO used_source_urls (url, agent_id, used_at) VALUES (?, ?, ?)`).run('https://old.test/p?utm_source=z', 'a', new Date().toISOString());
    const urls = ['https://www.example.com/a?utm_medium=y', 'https://old.test/p', 'https://nope.test/1', ...Array.from({ length: 500 }, (_, i) => `https://bulk.test/${i}`)];
    const used = hasUsedUrls(db, urls);
    expect([...used].sort()).toEqual([normalizeUrl('https://example.com/a'), normalizeUrl('https://old.test/p')].sort());
    db.close();
  });

  it('기존 DB(norm_url 컬럼 없음)를 열면 컬럼이 추가되고 기존 행이 채워진다(migrate 패턴, 멱등)', () => {
    const raw = new DatabaseSync(path.join(dir, 'goodfriends.db'));
    raw.exec(`CREATE TABLE writer_topic_history (url TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, agent_id TEXT, used_at TEXT NOT NULL);
              CREATE TABLE used_source_urls (url TEXT PRIMARY KEY, agent_id TEXT NOT NULL, used_at TEXT NOT NULL);`);
    raw.prepare(`INSERT INTO writer_topic_history VALUES (?, ?, ?, ?, ?)`).run('https://www.old.test/x/', 't', 'qna', null, '2026-11-01T00:00:00Z');
    raw.prepare(`INSERT INTO used_source_urls VALUES (?, ?, ?)`).run('https://legacy.test/y#frag', 'a', '2026-11-01T00:00:00Z');
    raw.close();

    for (let i = 0; i < 2; i++) {
      const db = openDatabase(dir); // 두 번 열어도 문제없다
      const rows = db.prepare(`SELECT norm_url FROM writer_topic_history`).all() as { norm_url: string }[];
      expect(rows[0].norm_url).toBe('old.test/x');
      expect((db.prepare(`SELECT norm_url FROM used_source_urls`).get() as any).norm_url).toBe('legacy.test/y');
      expect(hasUsedUrl(db, 'http://old.test/x')).toBe(true);
      expect(hasUsedUrl(db, 'https://legacy.test/y')).toBe(true);
      db.close();
    }
  });

  it('조회는 전 행을 읽지 않는다: norm_url 인덱스를 쓴다', () => {
    const db = openDatabase(dir);
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT norm_url FROM writer_topic_history WHERE norm_url IN (?,?)`).all('a', 'b') as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/USING (COVERING )?INDEX idx_writer_topic_history_norm/);
    db.close();
  });
});
