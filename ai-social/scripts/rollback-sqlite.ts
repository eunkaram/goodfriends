import path from 'node:path';
import { findLatestBackup, restoreBackup } from '../src/db/migrate.js';

const dataDir = path.resolve(process.cwd(), 'data');
const backupDir = findLatestBackup(dataDir);

if (!backupDir) {
  console.error('백업 디렉토리를 찾을 수 없습니다 (data/backup-*). 롤백할 수 없습니다.');
  process.exit(1);
}

const restored = restoreBackup(dataDir, backupDir);

console.log(`롤백 완료: ${backupDir} → data/ (${restored.join(', ')})`);
console.log('주의: data/reafy.db 파일 자체는 그대로 남아있습니다. 코드가 여전히 SQLite를 읽습니다.');
console.log('완전히 되돌리려면 이 마이그레이션 커밋을 git revert 하세요.');
