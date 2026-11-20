import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase } from './database.js';

describe('openDatabase', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the storage directory and a goodfriends.db file', () => {
    tmpDir = path.join(os.tmpdir(), `goodfriends-db-test-${Date.now()}`);
    const db = openDatabase(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'goodfriends.db'))).toBe(true);
    db.close();
  });

  it('creates all expected tables (idempotent schema)', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-db-test-'));
    const db = openDatabase(tmpDir);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['personas', 'agent_states', 'activity_logs', 'sessions']));
    db.close();
  });

  it('enables WAL mode', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-db-test-'));
    const db = openDatabase(tmpDir);
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(result.journal_mode.toLowerCase()).toBe('wal');
    db.close();
  });

  it('re-opening the same directory does not error (idempotent CREATE TABLE)', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-db-test-'));
    const db1 = openDatabase(tmpDir);
    db1.close();
    expect(() => {
      const db2 = openDatabase(tmpDir);
      db2.close();
    }).not.toThrow();
  });
});
