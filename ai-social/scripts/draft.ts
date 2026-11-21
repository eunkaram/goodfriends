/**
 * 1회 드라이런: `npm run draft -- --category <slug>`
 * 해당 카테고리 페르소나로 writer 파이프라인을 1회 실행해 drafts에 저장하고 요약을 출력한다. 게시하지 않는다.
 * (외부 RSS·LLM을 호출하므로 에이전트는 실행하지 않는다 — AGENTS.md)
 */
import { GoodfriendsClient } from '../src/client/goodfriends-client.js';
import { LlmClient } from '../src/llm/llm-client.js';
import { PersonaRegistry } from '../src/personas/registry.js';
import { runDraftCli } from '../src/writer/draft-cli.js';
import { createWriterService } from '../src/writer/service.js';

const registry = new PersonaRegistry();
const service = createWriterService({ llm: new LlmClient() });
// 피드 대조는 읽기 전용 GET만 쓴다(로그인·쓰기 없음).
const code = await runDraftCli(process.argv.slice(2), {
  personas: registry.getAll(),
  service,
  feedFor: (persona) => new GoodfriendsClient(persona),
});
process.exit(code);
