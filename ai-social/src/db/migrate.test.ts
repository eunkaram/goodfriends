import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { backupDataDir, migrateJsonToSqlite, findLatestBackup, restoreBackup } from './migrate.js';

function writeFixtures(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'personas.json'),
    JSON.stringify([
      { id: 'agent-a', nickname: 'A', password: 'x' },
      { id: 'agent-b', nickname: 'B', password: 'y' },
    ])
  );
  fs.writeFileSync(
    path.join(dataDir, 'agent_states.json'),
    JSON.stringify([{ id: 'agent-a', totalPosts: 3 }, { id: 'agent-b', totalPosts: 1 }])
  );
  fs.writeFileSync(
    path.join(dataDir, 'activity_logs.json'),
    JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({
        id: `log-${i}`,
        agentId: 'agent-a',
        agentName: 'A',
        type: 'browse',
        summary: `entry ${i}`,
        timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      }))
    )
  );
  fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify({ 'agent-a': 'token-a', 'agent-b': 'token-b' }));
}

describe('backupDataDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-migrate-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when the data directory does not exist', () => {
    expect(backupDataDir(path.join(tmpDir, 'nonexistent'))).toBeNull();
  });

  it('returns null when the data directory has no migratable files', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(backupDataDir(tmpDir)).toBeNull();
  });

  it('copies all present JSON files into a timestamped backup dir', () => {
    writeFixtures(tmpDir);
    const backupDir = backupDataDir(tmpDir);
    expect(backupDir).not.toBeNull();
    expect(fs.existsSync(path.join(backupDir!, 'personas.json'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir!, 'activity_logs.json'))).toBe(true);
    // 원본은 그대로 남아있어야 함
    expect(fs.existsSync(path.join(tmpDir, 'personas.json'))).toBe(true);
  });
});

describe('migrateJsonToSqlite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-migrate-test-'));
    writeFixtures(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates all personas, states, logs (all 200, no cap), and sessions without loss', () => {
    const summary = migrateJsonToSqlite(tmpDir);
    expect(summary.personas).toBe(2);
    expect(summary.states).toBe(2);
    expect(summary.logs).toBe(200);
    expect(summary.sessions).toBe(2);
    expect(summary.backupDir).not.toBeNull();

    const db = new DatabaseSync(path.join(tmpDir, 'goodfriends.db'));
    const personaCount = (db.prepare('SELECT COUNT(*) as c FROM personas').get() as { c: number }).c;
    const logCount = (db.prepare('SELECT COUNT(*) as c FROM activity_logs').get() as { c: number }).c;
    const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;
    expect(personaCount).toBe(2);
    expect(logCount).toBe(200); // 기존 200개 캡 없이 전부 옮겨짐
    expect(sessionCount).toBe(2);
    db.close();
  });

  it('is idempotent — running twice does not duplicate rows', () => {
    migrateJsonToSqlite(tmpDir);
    const secondRun = migrateJsonToSqlite(tmpDir);
    expect(secondRun.logs).toBe(200);

    const db = new DatabaseSync(path.join(tmpDir, 'goodfriends.db'));
    const logCount = (db.prepare('SELECT COUNT(*) as c FROM activity_logs').get() as { c: number }).c;
    const personaCount = (db.prepare('SELECT COUNT(*) as c FROM personas').get() as { c: number }).c;
    expect(logCount).toBe(200);
    expect(personaCount).toBe(2);
    db.close();
  });

  it('preserves session tokens exactly', () => {
    migrateJsonToSqlite(tmpDir);
    const db = new DatabaseSync(path.join(tmpDir, 'goodfriends.db'));
    const row = db.prepare('SELECT session_token FROM sessions WHERE agent_id = ?').get('agent-a') as
      | { session_token: string }
      | undefined;
    expect(row?.session_token).toBe('token-a');
    db.close();
  });
});

describe('findLatestBackup / restoreBackup (rollback)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-migrate-test-'));
    writeFixtures(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when there is no backup yet', () => {
    expect(findLatestBackup(tmpDir)).toBeNull();
  });

  it('finds the backup dir created during migration', () => {
    const summary = migrateJsonToSqlite(tmpDir);
    const found = findLatestBackup(tmpDir);
    expect(found).toBe(summary.backupDir);
  });

  it('restores JSON files from backup, overwriting any mutated originals', () => {
    const summary = migrateJsonToSqlite(tmpDir);
    // 원본을 훼손 (마이그레이션 이후 뭔가 잘못됐다고 가정)
    fs.writeFileSync(path.join(tmpDir, 'personas.json'), '[]');

    const restored = restoreBackup(tmpDir, summary.backupDir!);
    expect(restored).toContain('personas.json');

    const restoredPersonas = JSON.parse(fs.readFileSync(path.join(tmpDir, 'personas.json'), 'utf-8'));
    expect(restoredPersonas).toHaveLength(2);
  });
});
