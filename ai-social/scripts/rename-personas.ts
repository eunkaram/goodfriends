/**
 * 이미 goodfriends에 가입돼 있는 에이전트 계정의 유저네임/닉네임을 새 생성기 규칙으로 개명한다.
 *
 * 왜 필요한가: 2026-09-14 피드 감사에서 계정 41개의 유저네임이 전부(잔여 문자 0) 40단어짜리
 * 영단어 풀의 1~2개 조합으로 분해됐다. 글 내용을 아무리 다듬어도 아이디 목록만 긁으면 같은
 * 생성기에서 나온 무리인 게 드러난다. generator.ts는 고쳤지만 그건 신규 시드에만 적용되므로,
 * 이미 서버에 만들어진 계정은 이 스크립트로 따로 개명해야 한다.
 *
 * 사용법 (prod의 배포 디렉터리에서):
 *   npx tsx scripts/rename-personas.ts                # 드라이런 — 바뀔 이름만 출력, 아무것도 안 건드림
 *   npx tsx scripts/rename-personas.ts --apply --limit 1   # 1명만 실제 개명하고 검증
 *   npx tsx scripts/rename-personas.ts --apply        # 나머지 전부
 *
 * 안전장치:
 * - 기본이 드라이런. --apply 없이는 네트워크 쓰기도, DB 쓰기도 하지 않는다.
 * - PATCH가 username 변경을 실제로 받아주는지 서버에서 검증되지 않았다(로컬에 실 계정
 *   credential이 없어 사전 확인 불가). 그래서 한 명 바꿀 때마다 프로필을 다시 읽어 대조하고,
 *   반영이 안 됐으면 즉시 중단한다 — 41명을 조용히 헛돌리지 않기 위함.
 * - 성공한 계정만 DB에 새 username/nickname을 기록한다(중간에 멈춰도 상태가 어긋나지 않게).
 * - 이미 개명된 계정(persona.username이 있고 이메일 유도값과 다름)은 건너뛴다 — 재실행 안전.
 */
import path from 'node:path';
import { PersonaRegistry } from '../src/personas/registry.js';
import { GoodfriendsClient, deriveUsername } from '../src/client/goodfriends-client.js';
import { generateEmailLocalPart, generateNickname } from '../src/personas/generator.js';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const PAUSE_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const registry = new PersonaRegistry(path.resolve(process.cwd(), 'data'));
const personas = registry.getAll();

const derived = deriveUsername;
const alreadyRenamed = (p: (typeof personas)[number]) => Boolean(p.username && p.username !== derived(p.email));

// 새 이름이 기존 이름과 겹치지 않도록 현재 쓰이는 값 전부를 예약해둔다.
const usedUsernames = new Set<string>();
const usedNicknames = new Set<string>();
for (const p of personas) {
  usedUsernames.add(p.username || derived(p.email));
  usedNicknames.add(p.nickname);
}

const targets = personas.filter((p) => !alreadyRenamed(p)).slice(0, LIMIT);

console.log(`전체 ${personas.length}명 / 개명 대상 ${targets.length}명 (이미 개명됨: ${personas.length - personas.filter((p) => !alreadyRenamed(p)).length}명)`);
console.log(APPLY ? '모드: 실제 적용(--apply)\n' : '모드: 드라이런 — 아무것도 바꾸지 않음\n');

const plan = targets.map((p) => ({
  persona: p,
  oldUsername: derived(p.email),
  oldNickname: p.nickname,
  newUsername: generateEmailLocalPart(usedUsernames),
  newNickname: generateNickname(usedNicknames),
}));

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

  // 서버가 username 변경을 실제로 반영했는지 되읽어서 확인. 반영 안 됐으면 더 진행해봐야
  // 무의미하므로 멈춘다(추측으로 41번 두드리지 않기).
  const after = await client.getProfile();
  if (after && after.username && after.username !== r.newUsername) {
    console.error(
      `\n❌ ${r.oldUsername}: PATCH는 200인데 username이 안 바뀜(서버 값: ${after.username}). ` +
        `이 엔드포인트는 username 변경을 받지 않는 것으로 보입니다 — 중단합니다.`
    );
    break;
  }

  // 성공한 것만 DB에 반영
  registry.set({ ...r.persona, username: r.newUsername, nickname: r.newNickname });
  ok++;
  console.log(`  ✅ ${r.oldUsername} → ${r.newUsername} (${r.newNickname})${after ? '' : '  ※ 검증 조회 실패(PATCH 성공만 확인)'}`);

  await sleep(PAUSE_MS);
}

console.log(`\n개명 완료: ${ok}/${plan.length}명`);
if (ok > 0) {
  console.log('에이전트가 새 닉네임을 쓰려면 서비스(ai-social) 재시작이 필요합니다');
}
