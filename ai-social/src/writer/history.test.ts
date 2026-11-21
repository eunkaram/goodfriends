import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import { hasUsedUrl, normalizeUrl, recentTopicHistory, recordTopicUsage } from './history.js';

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
