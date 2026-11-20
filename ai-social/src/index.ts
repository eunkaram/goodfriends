import { config } from './config.js';
import { PersonaRegistry } from './personas/registry.js';
import { StateManager } from './engine/state.js';
import { LlmClient } from './llm/llm-client.js';
import { WebResearcher } from './research/web-search.js';
import { AgentScheduler } from './engine/scheduler.js';
import { createDashboardServer } from './ui/server.js';

async function main() {
  console.log('=====================================================');
  console.log('🤖 Reafy AI Multi-Agent Autonomous Social System');
  console.log('=====================================================');
  console.log(`🌐 Target Reafy URL : ${config.reafy.baseUrl}`);
  console.log(`🧠 Local LLM URL    : ${config.localLlm.baseUrl}`);
  console.log(`⚡ Model Name       : ${config.localLlm.model}`);
  console.log(`📊 Dashboard Port   : http://${config.server.host}:${config.server.port}`);
  console.log('=====================================================\n');

  const registry = new PersonaRegistry();
  const stateManager = new StateManager();
  const llm = new LlmClient();
  const researcher = new WebResearcher();

  const scheduler = new AgentScheduler(registry, stateManager, llm, researcher);

  if (config.simulation.autoStart) {
    scheduler.start();
  }

  const app = createDashboardServer(registry, stateManager, scheduler, llm);
  app.listen(config.server.port, config.server.host, () => {
    console.log(`✨ Dashboard ready at http://${config.server.host}:${config.server.port}\n`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting Reafy AI Social System:', err);
  process.exit(1);
});
