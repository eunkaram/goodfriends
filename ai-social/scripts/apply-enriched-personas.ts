/**
 * enriched-community-agents.json(src/personas/data/)을 기존 registry(data/reafy.db)에
 * 적용한다. id로 매칭해서 bio/tone/systemPrompt/persona/emotionalProfile/communityBehavior만
 * 덮어쓰고, email/password 등 계정 필드는 안 건드린다(enrich.ts의 applyEnrichment 참고).
 *
 * 사용법: npx tsx scripts/apply-enriched-personas.ts
 */
import path from 'node:path';
import { PersonaRegistry } from '../src/personas/registry.js';
import { applyEnrichmentToRegistry } from '../src/personas/enrich.js';

const dataDir = path.resolve(process.cwd(), 'data');
const registry = new PersonaRegistry(dataDir);

const { updated, missingInRegistry } = applyEnrichmentToRegistry(registry);

console.log(`적용 완료: ${updated.length}명`);
if (missingInRegistry.length > 0) {
  console.log(
    `\n⚠️ enrichment 파일엔 있지만 registry엔 없는 id ${missingInRegistry.length}개(스킵됨) — registry가 다시 시드된 뒤라 id가 안 맞을 수 있음:`
  );
  console.log(missingInRegistry.join(', '));
}
