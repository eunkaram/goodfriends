/**
 * 이미 goodfriends에 가입돼 있는 에이전트 계정의 유저네임/닉네임을 content/goodfriends-agents.json 정의에
 * 맞춘다. 정의의 username/nickname을 바꾼 뒤 이미 만들어진 계정에 반영할 때 쓴다(신규 시드는 정의를 그대로 사용).
 *
 * 사용법 (배포 디렉터리에서):
 *   npx tsx scripts/rename-personas.ts                # 드라이런 — 바뀔 이름만 출력, 아무것도 안 건드림
 *   npx tsx scripts/rename-personas.ts --apply --limit 1   # 1명만 실제 개명하고 검증
 *   npx tsx scripts/rename-personas.ts --apply        # 나머지 전부
 *
 * 안전장치:
 * - 기본이 드라이런. --apply 없이는 네트워크 쓰기도, DB 쓰기도 하지 않는다.
 * - PATCH가 username 변경을 실제로 받아주는지는 서버에서 검증되지 않았다. 그래서 한 명 바꿀 때마다 프로필을
 *   다시 읽어 대조하고, 반영이 안 됐으면 즉시 중단한다.
 * - 성공한 계정만 DB에 새 username/nickname을 기록한다(중간에 멈춰도 상태가 어긋나지 않게).
 * - 현재 값이 정의와 이미 같으면 건너뛴다 — 재실행 안전.
 */
import path from 'node:path';
import { PersonaRegistry } from '../src/personas/registry.js';
import { GoodfriendsClient, deriveUsername } from '../src/client/goodfriends-client.js';
import { loadAgentDefinitions } from '../src/personas/generator.js';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const PAUSE_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const registry = new PersonaRegistry(path.resolve(process.cwd(), 'data'));
const personas = registry.getAll();
const defs = new Map(loadAgentDefinitions().map((d) => [d.id, d]));

const currentUsername = (p: (typeof personas)[number]) => p.username || deriveUsername(p.email);

const plan = personas
  .map((p) => ({ persona: p, def: defs.get(p.id) }))
  .filter((r): r is { persona: (typeof personas)[number]; def: NonNullable<typeof r.def> } => Boolean(r.def))
  .filter((r) => currentUsername(r.persona) !== r.def.username || r.persona.nickname !== r.def.nickname)
  .slice(0, LIMIT)
  .map((r) => ({
    persona: r.persona,
    oldUsername: currentUsername(r.persona),
    oldNickname: r.persona.nickname,
    newUsername: r.def.username,
    newNickname: r.def.nickname,
  }));

console.log(`전체 ${personas.length}명 / 개명 대상 ${plan.length}명`);
console.log(APPLY ? '모드: 실제 적용(--apply)\n' : '모드: 드라이런 — 아무것도 바꾸지 않음\n');

for (const r of plan) {
  console.log(`  ${r.oldUsername.padEnd(24)} → ${r.newUsername.padEnd(24)}   ${r.oldNickname} → ${r.newNickname}`);
}

if (!APPLY) {
  console.log('\n실제로 바꾸려면 --apply를 붙이세요. 처음엔 --apply --limit 1로 한 명만 해보고 결과를 확인할 것.');
  process.exit(0);
}

let ok = 0;
for (const r of plan) {
  const client = new GoodfriendsClient(r.persona);
  const res = await client.updateProfile({ nickname: r.newNickname, username: r.newUsername });

  if (!res.ok) {
    console.error(`\n❌ ${r.oldUsername}: PATCH 실패 (${res.error}) — 중단합니다.`);
    break;
  }

  // 서버가 username 변경을 실제로 반영했는지 되읽어서 확인. 반영 안 됐으면 멈춘다.
  const after = await client.getProfile();
  if (after && after.username && after.username !== r.newUsername) {
    console.error(
      `\n❌ ${r.oldUsername}: PATCH는 200인데 username이 안 바뀜(서버 값: ${after.username}). ` +
        `이 엔드포인트는 username 변경을 받지 않는 것으로 보입니다 — 중단합니다.`
    );
    break;
  }

  registry.set({ ...r.persona, username: r.newUsername, nickname: r.newNickname });
  ok++;
  console.log(`  ✅ ${r.oldUsername} → ${r.newUsername} (${r.newNickname})${after ? '' : '  ※ 검증 조회 실패(PATCH 성공만 확인)'}`);

  await sleep(PAUSE_MS);
}

console.log(`\n개명 완료: ${ok}/${plan.length}명`);
if (ok > 0) {
  console.log('에이전트가 새 닉네임을 쓰려면 서비스(ai-social) 재시작이 필요합니다');
}
