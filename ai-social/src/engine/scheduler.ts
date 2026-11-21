import { config } from '../config.js';
import type { AgentPersona } from '../types.js';
import { PersonaRegistry } from '../personas/registry.js';
import { StateManager } from './state.js';
import { LlmClient } from '../llm/llm-client.js';
import type { WriterService } from '../writer/service.js';
import { SocialAgent } from './agent.js';
import { PostInteractionLock } from './post-interaction-lock.js';
import { isQuietHour, getQuietHoursConfig } from './quiet-hours.js';
import { resolveNextRunTime } from './scheduler-rules.js';

export class AgentScheduler {
  private registry: PersonaRegistry;
  private stateManager: StateManager;
  private llm: LlmClient;
  private writer: WriterService;
  private agents: Map<string, SocialAgent> = new Map();
  private nextRunTimes: Map<string, number> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private runningAgentIds: Set<string> = new Set();
  private postLock: PostInteractionLock = new PostInteractionLock();

  constructor(
    registry: PersonaRegistry,
    stateManager: StateManager,
    llm: LlmClient,
    writer: WriterService
  ) {
    this.registry = registry;
    this.stateManager = stateManager;
    this.llm = llm;
    this.writer = writer;
    this.initAgents();
  }

  private initAgents(): void {
    const personas = this.registry.getAll();
    this.agents.clear();

    const now = Date.now();
    personas.forEach((persona, index) => {
      const agent = new SocialAgent(persona, this.llm, this.writer, this.stateManager, this.registry, this.postLock);
      this.agents.set(persona.id, agent);

      // 서버 재시작 시 이미 예약돼 있던(미래) 다음 실행 시각이 있으면 그대로 유지한다 —
      // 안 그러면 재시작할 때마다 전 에이전트가 같은 좁은 시간대로 다시 뭉침(resolveNextRunTime 참고).
      const existingNextActiveAt = this.stateManager.getAgentState(persona.id)?.nextActiveAt;
      const nextTime = resolveNextRunTime(existingNextActiveAt, now, index);
      this.nextRunTimes.set(persona.id, nextTime);

      this.stateManager.initOrUpdateState(persona.id, {
        nextActiveAt: new Date(nextTime).toISOString(),
        status: 'sleeping',
      });
    });
  }

  private scheduleNext(persona: AgentPersona): void {
    const minMs = persona.minIntervalMinutes * 60 * 1000;
    const maxMs = persona.maxIntervalMinutes * 60 * 1000;
    // 무작위 딜레이 계산
    const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
    const nextTime = Date.now() + delay;
    this.nextRunTimes.set(persona.id, nextTime);

    this.stateManager.initOrUpdateState(persona.id, {
      nextActiveAt: new Date(nextTime).toISOString(),
      status: 'sleeping',
    });
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`🚀 [AgentScheduler] Started multi-agent social orchestration.`);

    // 주기적 스케줄 체크 루프
    this.timer = setInterval(() => {
      this.checkSchedules();
    }, config.simulation.tickIntervalMs);

    // 즉시 첫 점검
    this.checkSchedules();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log(`⏹️ [AgentScheduler] Stopped.`);
  }

  private async checkSchedules(): Promise<void> {
    if (!this.isRunning) return;
    const now = Date.now();
    const { startHour, endHour } = getQuietHoursConfig();

    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.persona.enabled === false) continue;

      // 조용한 시간대: 자동 스케줄만 쉬어감(수동 대시보드 트리거는 영향 없음).
      // 24시간 균일한 활동 자체가 봇 티가 나는 신호이기 때문. 전역으로 한 번만 판정하면
      // 서버가 떠 있는 시간대(prod는 UTC) 또는 한 시간대에만 맞춰져서 미국/한국 에이전트가
      // 동시에 자거나 깨어있게 된다 — 에이전트별 시간대(persona.timezone)로 판정해서
      // 시스템 전체는 24시간 돌아가되 각자는 자기 지역 새벽에만 쉬게 한다(2026-09-06).
      if (isQuietHour(new Date(now), startHour, endHour, agent.persona.timezone || 'Asia/Seoul')) continue;

      const nextTime = this.nextRunTimes.get(agentId) || 0;
      if (now >= nextTime && !this.runningAgentIds.has(agentId)) {
        // 실행 중복 방지를 위해 먼저 다음 스케줄을 멀리 밀어둠
        this.nextRunTimes.set(agentId, now + 1000 * 60 * 60);
        this.runningAgentIds.add(agentId);

        // 비동기 세션 실행
        (async () => {
          try {
            await agent.runSession();
          } catch (err) {
            console.error(`[Scheduler] Agent ${agentId} session failed:`, err);
          } finally {
            this.runningAgentIds.delete(agentId);
            this.scheduleNext(agent.persona);
          }
        })();
      }
    }
  }

  /**
   * 특정 에이전트 수동 즉시 실행
   */
  public async triggerAgent(agentId: string): Promise<{ ok: boolean; summary: string }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { ok: false, summary: 'Agent not found' };
    }
    if (agent.persona.enabled === false) {
      return { ok: false, summary: '꺼져 있는 에이전트입니다.' };
    }
    if (this.runningAgentIds.has(agentId)) {
      return { ok: false, summary: '이미 실행 중인 세션이 있습니다.' };
    }

    this.runningAgentIds.add(agentId);
    try {
      const res = await agent.runSession();
      this.scheduleNext(agent.persona);
      return res;
    } catch (err: any) {
      return { ok: false, summary: err.message };
    } finally {
      this.runningAgentIds.delete(agentId);
    }
  }

  public reloadPersonas(): void {
    this.initAgents();
  }

  public getStatus() {
    return {
      running: this.isRunning,
      agentCount: this.agents.size,
      states: this.stateManager.getAllStates(),
    };
  }
}
