import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite 스키마. personas/agent_states는 항상 전체 객체 단위로 읽고 쓰이므로
 * (관계형 쿼리 필요 없음) id + JSON blob으로 단순하게 저장한다.
 * activity_logs는 시간/에이전트별 조회(리플레이, 대시보드)가 실제로 필요해서
 * 컬럼을 제대로 나눈다.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_states (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_id TEXT,
  target_title TEXT,
  details TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_agent ON activity_logs(agent_id);

CREATE TABLE IF NOT EXISTS sessions (
  agent_id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL
);

-- 외부 리서치 소스에서 퍼온글로 쓴 URL 기록. 여러 에이전트가 같은 소스 목록(RSS/게시판)에서
-- 독립적으로 뽑다 보니 같은 글이 중복 게시되는 문제가 있어서(2026-09-06), 게시 전에 이미
-- 쓰인 URL인지 먼저 확인하는 용도 — web-search.ts의 fetchTrendingTopic이 참고한다.
CREATE TABLE IF NOT EXISTS used_source_urls (
  url TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  used_at TEXT NOT NULL
);
`;

/** 이미 존재하는 테이블에 컬럼이 없으면 추가한다 (CREATE TABLE IF NOT EXISTS로는 기존 테이블에 컬럼이 안 생기므로). */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * storageDir/reafy.db 커넥션을 연다. WAL 모드 + busy_timeout으로 여러 에이전트
 * 세션이 동시에 써도(SQLITE_BUSY) 짧게 대기 후 진행하도록 함(CEO 리뷰 Section 1 지적).
 * 클래스마다 자기 커넥션을 独立적으로 여는 구조 — 모듈 전역 싱글턴이 아니라서
 * 테스트에서 서로 다른 임시 디렉토리를 써도 생명주기가 꼬이지 않는다.
 */
export function openDatabase(storageDir: string): DatabaseSync {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  const dbPath = path.join(storageDir, 'reafy.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  // T10: 세션 리플레이용 상관관계 컬럼 (T9 스키마에 없었으므로 마이그레이션 필요)
  ensureColumn(db, 'activity_logs', 'session_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_activity_logs_session ON activity_logs(session_id)');
  return db;
}
