import path from 'node:path';
import { migrateJsonToSqlite } from '../src/db/migrate.js';

const dataDir = path.resolve(process.cwd(), 'data');
const result = migrateJsonToSqlite(dataDir);

console.log(`백업: ${result.backupDir ?? '(data/ 없음, 백업 스킵)'}`);
console.log(
  `마이그레이션 완료 — personas=${result.personas}, states=${result.states}, logs=${result.logs}, sessions=${result.sessions}`
);
console.log(`SQLite: ${path.join(dataDir, 'goodfriends.db')}`);
console.log(`롤백하려면: npm run rollback:sqlite`);
