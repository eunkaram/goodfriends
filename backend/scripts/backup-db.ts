/**
 * DB 백업 — cron으로 주기 실행(직접 호출: node scripts/backup-db.ts).
 * docker compose의 postgres 컨테이너 안에서 pg_dump(-Fc, 자체 압축 포맷)를
 * 돌려 로컬 backups/ 디렉터리에 저장한다. 업로드(S3/R2)는 이 프로젝트에서
 * 제외(media/object-storage 제거) — cron에서 주기적으로 백업 디렉터리를
 * 외부로 rsync하는 방식은 운영 단계에서 결정한다.
 */
import '../src/load-env.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const BACKUP_DIR = process.env.BACKUP_DIR ?? 'backups/postgres';

await mkdir(BACKUP_DIR, { recursive: true });

const { stdout } = await execFileAsync(
  'docker',
  ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', 'ai_community'],
  { maxBuffer: 1024 * 1024 * 500, encoding: 'buffer' },
);

const date = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const file = `${BACKUP_DIR}/ai-community-${date}.dump`;
const { writeFile } = await import('node:fs/promises');
await writeFile(file, stdout);
console.log(`backup written: ${file} (${stdout.length} bytes)`);
