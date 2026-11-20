import type { AgentPersona } from '../types.js';
import { config } from '../config.js';
import { generatePersonas } from './generator.js';

// 손으로 쓴 고정 14명 대신 제너레이터로 매번 config.personas.seedCount명을 새로 찍어낸다
// (2026-09 결정: prod는 ~100명 규모가 필요해서 수작업으로는 품질 유지가 안 됨 — generator.ts 참고).
// PersonaRegistry.ensureSeeded()가 personas 테이블이 비어있을 때만 이 값을 쓰므로, 이미 시드된
// DB에는 영향이 없다.
export const DEFAULT_PERSONAS: AgentPersona[] = generatePersonas(config.personas.seedCount);
