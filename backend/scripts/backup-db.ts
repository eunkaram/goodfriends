/**
 * DB 백업 — cron으로 주기 실행(직접 호출: node scripts/backup-db.ts).
 * docker compose의 postgres 컨테이너 안에서 pg_dump(-Fc, 자체 압축 포맷)를
 * 돌려 로컬 backups/ 디렉터리에 저장한다. 업로드(S3/R2)는 이 프로젝트에서
 * 제외(media/object-storage 제거) — cron에서 주기적으로 백업 디렉터리를
 * 외부로 rsync하는 방식은 운영 단계에서 결정한다.
 *
 * 🔒 배포 실측(2026-10-19, #6) — compose의 POSTGRES_USER가 커스텀
 * (community_owner)이라 -U postgres로 덤프하면 "role does not exist"로
 * 실패한다. 유저는 env로 넘긴다(BACKUP_KEEP_DAYS로 덤프 로테이션,
 * 실패 시 alertAdminOfError — ADMIN_ALERT_EMAIL 미설정이면 콘솔 스텁).
 */
import '../src/load-env.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { alertAdminOfError } from '../src/error-alert.ts';

const execFileAsync = promisify(execFile);
const BACKUP_DIR = process.env.BACKUP_DIR ?? 'backups/postgres';
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const DB_USER = process.env.POSTGRES_USER ?? 'community_owner';

try {
  await mkdir(BACKUP_DIR, { recursive: true });

  const { stdout } = await execFileAsync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', DB_USER, '-Fc', 'goodfriends'],
    { maxBuffer: 1024 * 1024 * 500, encoding: 'buffer' },
  );

  const date = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = `${BACKUP_DIR}/goodfriends-${date}.dump`;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, stdout);
  console.log(`backup written: ${file} (${stdout.length} bytes)`);

  // 로테이션 — KEEP_DAYS보다 오래된 덤프는 삭제(스왑 디스크 잘리는 것 방지).
  if (KEEP_DAYS > 0) {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of await readdir(BACKUP_DIR)) {
      if (!name.startsWith('goodfriends-') || !name.endsWith('.dump')) continue;
      const { mtimeMs } = await stat(`${BACKUP_DIR}/${name}`);
      if (mtimeMs < cutoff) {
        await unlink(`${BACKUP_DIR}/${name}`);
        console.log(`rotation removed: ${name}`);
      }
    }
  }
} catch (err) {
  console.error('backup failed:', err);
  await alertAdminOfError(err, 'db-backup');
  process.exitCode = 1;
}
