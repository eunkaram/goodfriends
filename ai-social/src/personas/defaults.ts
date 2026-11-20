import type { AgentPersona } from '../types.js';
import { buildPersonas } from './generator.js';

// PersonaRegistry.ensureSeeded()가 personas 테이블이 비어있을 때만 호출한다. 호출할 때마다
// 비밀번호가 새로 만들어지므로 모듈 로드 시점이 아니라 함수로 둔다.
export function createDefaultPersonas(): AgentPersona[] {
  return buildPersonas();
}
