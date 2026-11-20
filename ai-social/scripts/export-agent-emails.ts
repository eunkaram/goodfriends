/**
 * 우리 에이전트 계정의 이메일/유저네임 목록을 내보낸다.
 *
 * 왜 필요한가: 에이전트 계정은 전부 `@reafy.local` 도메인으로 일반 회원가입 플로우를 타서
 * 만들어졌다(generator.ts). 즉 Reafy 서버 DB에서는 일반 유저와 구분되는 표식이 없다.
 * 그래서 "reafy.local 유저 정리" 같은 작업을 할 때 이 목록이 유일한 보존 기준이 된다.
 *
 * 사용법 (에이전트 서버의 배포 디렉터리에서):
 *   npx tsx scripts/export-agent-emails.ts            # 사람이 보기 좋은 표
 *   npx tsx scripts/export-agent-emails.ts --sql      # SQL IN 절로 바로 쓸 수 있는 형태
 *   npx tsx scripts/export-agent-emails.ts --json     # JSON 배열
 *
 * 읽기 전용이다 — 아무것도 수정하지 않는다.
 */
import path from 'node:path';
import { PersonaRegistry } from '../src/personas/registry.js';

const registry = new PersonaRegistry(path.resolve(process.cwd(), 'data'));
const personas = registry.getAll();

const derived = (email: string) => email.split('@')[0].replace(/\./g, '');
const rows = personas.map((p) => ({
  email: p.email,
  username: p.username || derived(p.email),
  nickname: p.nickname,
  enabled: p.enabled !== false,
}));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes('--sql')) {
  // 개행 없이 한 줄로 — 그대로 복사해 WHERE email NOT IN (...) 에 넣으면 된다.
  console.log(rows.map((r) => `'${r.email.replace(/'/g, "''")}'`).join(', '));
} else {
  console.log(`에이전트 계정 ${rows.length}개 (비활성 포함 — 비활성도 보존 대상이다)\n`);
  console.log('  ' + 'email'.padEnd(34) + 'username'.padEnd(26) + 'nickname'.padEnd(16) + 'enabled');
  for (const r of rows) {
    console.log('  ' + r.email.padEnd(34) + r.username.padEnd(26) + r.nickname.padEnd(16) + (r.enabled ? 'Y' : 'N'));
  }
  const domains = new Set(rows.map((r) => r.email.split('@')[1]));
  console.log(`\n도메인: ${[...domains].join(', ')}`);
  console.log('--sql / --json 으로 기계가 읽을 형태로도 뽑을 수 있다.');
}
