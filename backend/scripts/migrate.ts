/** 마이그레이션 러너 — db/migrations/*.sql 을 순서대로 적용한다.
 *  §12.2: RLS 정책이 마이그레이션에 포함된다. 정책 변경은 전체 유출로 이어질 수 있으므로
 *  적용 이력을 남긴다. */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerPool } from '../src/db.ts';

// 🔒 실전 발견(2026-08, 우분투 서버에서 .env의 POSTGRES_PASSWORD를 바꾼 뒤
// "SASL authentication failed") — 0001/0002/0012가 community_schema/community_app_arrays/
// community_app_exists/community_app_auth를 만들 때 비밀번호를 리터럴 'devpass'로
// 하드코딩해뒀다(마이그레이션은 커밋 후 재작성 안 함 — 이 프로젝트 관례).
// src/db.ts는 이 4개 역할 + community_owner 전부에 .env의 POSTGRES_PASSWORD를
// 그대로 쓰므로, 최초 초기화 이후 .env만 바꾸면 앱이 쓰는 비밀번호와 DB에
// 실제 저장된 비밀번호가 어긋난다. 매 migrate 실행마다(새 마이그레이션이
// 없어도) 이 5개 역할 비밀번호를 현재 .env 값으로 동기화해 이 드리프트를
// 구조적으로 없앤다 — .env를 바꾸고 db:migrate만 다시 돌리면 항상 일치한다.
// (예외: community_owner 자신의 비밀번호가 이미 옛 값으로 굳어진 기존 볼륨에서는
// ownerPool() 접속 자체가 옛 비밀번호를 요구해 이 스크립트가 뜨질 못한다 —
// 그 경우엔 psql로 community_owner 비밀번호부터 수동으로 맞추거나 db:reset으로
// 볼륨을 새로 초기화해야 한다.)
const CREDENTIALED_ROLES = ['community_owner', 'community_schema', 'community_app_arrays', 'community_app_exists', 'community_app_auth'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'db', 'migrations');

const pool = ownerPool();

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const applied = new Set(
  (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
);

let count = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip  ${file}`);
    continue;
  }
  const sql = await readFile(join(dir, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    console.log(`  ok    ${file}`);
    count++;
  } catch (err) {
    console.error(`  FAIL  ${file}`);
    throw err;
  } finally {
    client.release();
  }
}

console.log(count === 0 ? 'nothing to apply' : `applied ${count} migration(s)`);

// 새 마이그레이션 유무와 무관하게 항상 동기화한다 — "devpass 하드코딩" 드리프트를
// db:migrate 한 번으로 항상 없앨 수 있어야 한다(위 CREDENTIALED_ROLES 주석 참고).
// 🔒 보안 점검 발견(2026-08-22) — POSTGRES_PASSWORD 미설정 시 예전엔 'devpass'로
// 폴백해 5개 역할(community_owner 포함) 비밀번호를 실제로 그 공개된 약한 값으로
// ALTER ROLE 해버렸다 — 배포 파이프라인이 매번 도는 스크립트라 실수로 .env가
// 비면 조용히 운영 DB 비밀번호를 다운그레이드하는 구조였다(src/db.ts와 같은 이유).
const currentPassword = process.env.POSTGRES_PASSWORD;
if (!currentPassword) {
  throw new Error('POSTGRES_PASSWORD가 설정되지 않았습니다 — devpass로 동기화하지 않고 중단합니다. .env를 확인하세요.');
}
const escapedPassword = currentPassword.replace(/'/g, "''"); // ALTER ROLE ... PASSWORD 는 문자열 리터럴만 받아 바인드 파라미터를 못 쓴다
for (const role of CREDENTIALED_ROLES) {
  await pool.query(`ALTER ROLE ${role} WITH PASSWORD '${escapedPassword}'`);
}
console.log(`synced password for: ${CREDENTIALED_ROLES.join(', ')}`);

await pool.end();
