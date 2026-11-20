import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from './database.js';

const MIGRATABLE_FILES = ['personas.json', 'agent_states.json', 'activity_logs.json', 'sessions.json'] as const;

export interface MigrationSummary {
  personas: number;
  states: number;
  logs: number;
  sessions: number;
  backupDir: string | null;
}

function readJson<T>(dataDir: string, file: string, fallback: T): T {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * data/*.json을 data/backup-{timestamp}/로 복사한다. 마이그레이션 전 항상 먼저 호출.
 * 롤백은 이 백업 디렉토리에서 파일을 다시 data/로 복사하는 것.
 */
export function backupDataDir(dataDir: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(dataDir)) return null;

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, `backup-${stamp}`);
  let copiedAny = false;

  for (const file of MIGRATABLE_FILES) {
    const src = path.join(dataDir, file);
    if (fs.existsSync(src)) {
      if (!copiedAny) fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(src, path.join(backupDir, file));
      copiedAny = true;
    }
  }

  return copiedAny ? backupDir : null;
}

/**
 * 기존 JSON 파일들을 SQLite(data/goodfriends.db)로 옮긴다.
 * 멱등성: 같은 id는 ON CONFLICT/DO NOTHING으로 중복 없이 재실행 가능.
 */
export function migrateJsonToSqlite(dataDir: string): MigrationSummary {
  const backupDir = backupDataDir(dataDir);

  const db = openDatabase(dataDir);

  const personas = readJson<any[]>(dataDir, 'personas.json', []);
  const states = readJson<any[]>(dataDir, 'agent_states.json', []);
  const logs = readJson<any[]>(dataDir, 'activity_logs.json', []);
  const sessions = readJson<Record<string, string>>(dataDir, 'sessions.json', {});

  const insertPersona = db.prepare(
    `INSERT INTO personas (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  );
  for (const p of personas) insertPersona.run(p.id, JSON.stringify(p));

  const insertState = db.prepare(
    `INSERT INTO agent_states (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  );
  for (const s of states) insertState.run(s.id, JSON.stringify(s));

  const insertLog = db.prepare(
    `INSERT INTO activity_logs (id, agent_id, agent_name, type, summary, target_id, target_title, details, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );
  for (const l of logs) {
    insertLog.run(
      l.id,
      l.agentId,
      l.agentName,
      l.type,
      l.summary,
      l.targetId ?? null,
      l.targetTitle ?? null,
      l.details ? JSON.stringify(l.details) : null,
      l.timestamp
    );
  }

  const insertSession = db.prepare(
    `INSERT INTO sessions (agent_id, session_token) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET session_token = excluded.session_token`
  );
  for (const [agentId, token] of Object.entries(sessions)) insertSession.run(agentId, token);

  return {
    personas: personas.length,
    states: states.length,
    logs: logs.length,
    sessions: Object.keys(sessions).length,
    backupDir,
  };
}

/** 가장 최근 backup-* 디렉토리를 찾는다. */
export function findLatestBackup(dataDir: string): string | null {
  if (!fs.existsSync(dataDir)) return null;
  const dirs = fs
    .readdirSync(dataDir)
    .filter((d) => d.startsWith('backup-'))
    .sort();
  if (dirs.length === 0) return null;
  return path.join(dataDir, dirs[dirs.length - 1]);
}

/** 백업 디렉토리의 JSON 파일들을 data/로 복원한다. SQLite 파일 자체는 건드리지 않음. */
export function restoreBackup(dataDir: string, backupDir: string): string[] {
  const restored: string[] = [];
  for (const file of fs.readdirSync(backupDir)) {
    fs.copyFileSync(path.join(backupDir, file), path.join(dataDir, file));
    restored.push(file);
  }
  return restored;
}
