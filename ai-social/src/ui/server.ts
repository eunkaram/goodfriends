import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { PersonaRegistry } from '../personas/registry.js';
import type { StateManager } from '../engine/state.js';
import type { AgentScheduler } from '../engine/scheduler.js';
import type { LlmClient } from '../llm/llm-client.js';
import { fetchCategories } from '../client/goodfriends-client.js';
import type { DraftStore } from '../writer/drafts.js';

export function createDashboardServer(
  registry: PersonaRegistry,
  stateManager: StateManager,
  scheduler: AgentScheduler,
  llm: LlmClient,
  drafts?: DraftStore
) {
  const app = express();
  app.use(express.json());

  const publicDir = path.resolve(process.cwd(), 'src/ui/public');
  app.use(express.static(publicDir));

  // Dashboard API routes
  app.get('/api/status', (req, res) => {
    res.json({
      scheduler: scheduler.getStatus(),
      states: stateManager.getAllStates(),
      config: {
        dryRun: config.dryRun,
        goodfriendsUrl: config.goodfriends.baseUrl,
        localLlm: {
          baseUrl: config.localLlm.baseUrl,
          model: config.localLlm.model,
        },
        llmProvider: {
          active: config.llmProvider.active,
          activeModel: config.llmProvider.active === 'openrouter' ? config.openRouter.model : config.localLlm.model,
          fallbackAvailable: config.llmProvider.active === 'local' && config.llmProvider.fallbackToOpenRouter && Boolean(config.openRouter.apiKey),
          fallbackModel: config.openRouter.apiKey ? config.openRouter.model : null,
        },
      },
    });
  });

  // 글 초안(읽기 전용): 목록은 본문·사실 카드 없이, 상세는 전체. 대시보드는 127.0.0.1에만 바인드된다(config.server.host).
  app.get('/api/drafts', (req, res) => {
    if (!drafts) return res.json({ drafts: [] });
    const limit = parseInt(String(req.query.limit || '50'), 10);
    res.json({
      drafts: drafts.list({
        limit: Number.isFinite(limit) ? limit : 50,
        status: req.query.status ? String(req.query.status) : undefined,
        category: req.query.category ? String(req.query.category) : undefined,
      }),
    });
  });

  app.get('/api/drafts/:id', (req, res) => {
    const draft = drafts?.get(req.params.id);
    if (!draft) return res.status(404).json({ error: '초안을 찾을 수 없습니다' });
    res.json(draft);
  });

  app.get('/api/categories', async (req, res) => {
    res.json(await fetchCategories(config.goodfriends.baseUrl));
  });

  app.get('/api/personas', (req, res) => {
    const personas = registry.getAll().map(({ password, ...safe }) => safe);
    res.json(personas);
  });

  app.post('/api/personas', (req, res) => {
    const persona = req.body;
    if (!persona.id || !persona.nickname) {
      return res.status(400).json({ error: 'id and nickname are required' });
    }
    registry.set(persona);
    scheduler.reloadPersonas();
    res.status(201).json({ ok: true, persona });
  });

  // 페르소나 콘텐츠(닉네임/소개/말투/시스템프롬프트/관심사/행동 확률 등) 수정.
  // id/email/password는 goodfriends 계정과 묶여 있어 여기서 못 바꾸게 화이트리스트로 막는다 —
  // 안 그러면 클라이언트가 실수로 password를 빼먹은 객체를 보낼 때 계정 로그인이 깨진다.
  const EDITABLE_PERSONA_FIELDS = [
    'nickname', 'bio', 'avatarUrl', 'interests', 'preferredCategories', 'tone', 'systemPrompt',
    'postProb', 'commentProb', 'reactionProb', 'externalSearchProb',
    'minIntervalMinutes', 'maxIntervalMinutes',
  ] as const;

  app.patch('/api/personas/:id', (req, res) => {
    const persona = registry.get(req.params.id);
    if (!persona) {
      return res.status(404).json({ error: 'persona not found' });
    }
    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_PERSONA_FIELDS) {
      if (field in req.body) updates[field] = req.body[field];
    }
    const updated = { ...persona, ...updates };
    registry.set(updated);
    scheduler.reloadPersonas();
    const { password, ...safe } = updated;
    res.json({ ok: true, persona: safe });
  });

  app.patch('/api/personas/:id/enabled', (req, res) => {
    const persona = registry.get(req.params.id);
    if (!persona) {
      return res.status(404).json({ error: 'persona not found' });
    }
    registry.set({ ...persona, enabled: Boolean(req.body.enabled) });
    scheduler.reloadPersonas();
    res.json({ ok: true, enabled: Boolean(req.body.enabled) });
  });

  app.get('/api/logs', (req, res) => {
    const limit = parseInt(String(req.query.limit || '60'), 10);
    const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
    res.json(stateManager.getLogs(limit, agentId));
  });

  // 세션 리플레이 (T10): 특정 에이전트의 최근 세션 목록 + 세션 하나의 전체 로그
  app.get('/api/sessions/:agentId', (req, res) => {
    const { agentId } = req.params;
    const limit = parseInt(String(req.query.limit || '10'), 10);
    res.json(stateManager.getRecentSessions(agentId, limit));
  });

  app.get('/api/replay/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const logs = stateManager.getLogsBySession(sessionId);
    res.json(logs);
  });

  app.post('/api/trigger/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const result = await scheduler.triggerAgent(agentId);
    res.json(result);
  });

  app.post('/api/scheduler/start', (req, res) => {
    scheduler.start();
    res.json({ ok: true });
  });

  app.post('/api/scheduler/stop', (req, res) => {
    scheduler.stop();
    res.json({ ok: true });
  });

  app.post('/api/test/llm', async (req, res) => {
    try {
      const reply = await llm.chat([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Respond in 1 sentence: connection test.' },
      ]);
      res.json({ ok: true, reply });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return app;
}
