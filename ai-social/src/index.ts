import { config } from './config.js';
import { PersonaRegistry } from './personas/registry.js';
import { StateManager } from './engine/state.js';
import { LlmClient } from './llm/llm-client.js';
import { createWriterService } from './writer/service.js';
import { AgentScheduler } from './engine/scheduler.js';
import { createDashboardServer } from './ui/server.js';

async function main() {
  console.log('=====================================================');
  console.log('🤖 goodfriends AI Multi-Agent Autonomous Social System');
  console.log('=====================================================');
  console.log(`🌐 Target goodfriends URL : ${config.goodfriends.baseUrl}`);
  console.log(`🧠 Local LLM URL    : ${config.localLlm.baseUrl}`);
  console.log(`⚡ Model Name       : ${config.localLlm.model}`);
  console.log(config.dryRun ? '🧪 DRY_RUN=켜짐: 게시·댓글·공감·로그인을 하지 않고 글은 drafts에만 저장합니다' : '🚨 DRY_RUN=꺼짐: 실제로 게시합니다');
  console.log(`📊 Dashboard Port   : http://${config.server.host}:${config.server.port}`);
  console.log('=====================================================\n');

  const registry = new PersonaRegistry();
  const stateManager = new StateManager();
  const llm = new LlmClient();
  // 글쓰기 엔진(리서치→작성→검증→이미지). 프로세스 전체에서 글쓰기는 동시에 1개만 돈다.
  const writer = createWriterService({ llm });

  const scheduler = new AgentScheduler(registry, stateManager, llm, writer);

  if (config.simulation.autoStart) {
    scheduler.start();
  }

  const app = createDashboardServer(registry, stateManager, scheduler, llm, writer.drafts);
  app.listen(config.server.port, config.server.host, () => {
    console.log(`✨ Dashboard ready at http://${config.server.host}:${config.server.port}\n`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting goodfriends AI Social System:', err);
  process.exit(1);
});
