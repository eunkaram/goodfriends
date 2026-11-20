/**
 * 이미 DB에 있는 페르소나들의 세션 간격(min/maxIntervalMinutes)을 일괄 조정한다.
 *
 * 왜 필요한가: generator.ts의 간격 기본값을 바꿔도 그건 신규 시드에만 적용된다. 이미 등록된
 * 페르소나는 예전 값을 그대로 들고 있어서 활동량이 안 줄어든다(rename-personas.ts와 같은 사정).
 *
 * 활동량은 간격에 반비례한다 — 간격을 ×4/3 하면 세션 수가 ×3/4가 되어 글·댓글이 약 25% 준다.
 * 그래서 "25% 덜 쓰게"의 기본 factor는 1.333이다. 반대로 되돌리려면 --factor 0.75.
 *
 * 사용법:
 *   npx tsx scripts/scale-intervals.ts                    # 드라이런(기본 factor 1.333)
 *   npx tsx scripts/scale-intervals.ts --apply
 *   npx tsx scripts/scale-intervals.ts --factor 1.5 --apply
 *
 * 재실행하면 그만큼 또 곱해지므로(멱등 아님) 드라이런으로 현재 값을 먼저 확인할 것.
 * 반영하려면 서비스 재시작이 필요하다(에이전트 인스턴스가 메모리에 값을 들고 있음).
 */
import path from 'node:path';
import { PersonaRegistry } from '../src/personas/registry.js';

const APPLY = process.argv.includes('--apply');
const fIdx = process.argv.indexOf('--factor');
const FACTOR = fIdx !== -1 ? Number(process.argv[fIdx + 1]) : 4 / 3;

if (!Number.isFinite(FACTOR) || FACTOR <= 0) {
  console.error(`--factor 값이 올바르지 않습니다: ${process.argv[fIdx + 1]}`);
  process.exit(1);
}

const registry = new PersonaRegistry(path.resolve(process.cwd(), 'data'));
const personas = registry.getAll();

// 분 단위 정수로 반올림하되 최소 1분은 보장(factor를 크게 줄였을 때 0이 되는 걸 방지).
const scale = (v: number) => Math.max(1, Math.round(v * FACTOR));

const avgBefore = personas.reduce((s, p) => s + (p.minIntervalMinutes + p.maxIntervalMinutes) / 2, 0) / personas.length;
const avgAfter = personas.reduce((s, p) => s + (scale(p.minIntervalMinutes) + scale(p.maxIntervalMinutes)) / 2, 0) / personas.length;

console.log(`페르소나 ${personas.length}명 | factor ${FACTOR.toFixed(3)}`);
console.log(`평균 간격: ${avgBefore.toFixed(1)}분 → ${avgAfter.toFixed(1)}분`);
console.log(`예상 활동량: ${((avgBefore / avgAfter) * 100).toFixed(0)}% (100%면 변화 없음)\n`);

for (const p of personas.slice(0, 10)) {
  console.log(
    `  ${p.nickname.padEnd(12)} ${p.minIntervalMinutes}~${p.maxIntervalMinutes}분 → ${scale(p.minIntervalMinutes)}~${scale(p.maxIntervalMinutes)}분`
  );
}
if (personas.length > 10) console.log(`  … 외 ${personas.length - 10}명`);

if (!APPLY) {
  console.log('\n드라이런입니다. 실제로 바꾸려면 --apply를 붙이세요.');
  process.exit(0);
}

for (const p of personas) {
  registry.set({ ...p, minIntervalMinutes: scale(p.minIntervalMinutes), maxIntervalMinutes: scale(p.maxIntervalMinutes) });
}

console.log(`\n적용 완료: ${personas.length}명`);
console.log('반영하려면 서비스 재시작: sudo systemctl restart reafy-ai-social');
