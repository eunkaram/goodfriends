import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersonaRegistry } from '../personas/registry.js';
import type { AgentPersona, CommunityComment, CommunityPost } from '../types.js';
import type { WriterOutcome, WriterService } from '../writer/service.js';
import { SocialAgent, type AgentClient } from './agent.js';
import { StateManager } from './state.js';
import { PostInteractionLock } from './post-interaction-lock.js';

const persona = {
  id: 'p-test', name: '테스터', nickname: '테스터', email: 't@goodfriends.local', password: 'x',
  bio: '', interests: [], preferredCategories: ['qna'], tone: '', systemPrompt: '',
  postProb: 1, commentProb: 1, reactionProb: 1, externalSearchProb: 1, minIntervalMinutes: 10, maxIntervalMinutes: 20,
} as unknown as AgentPersona;

const post = { id: 'post-1', title: '남의 글', bodyPreview: '내용', authorNickname: '다른사람', commentCount: 2, categorySlug: 'qna' } as unknown as CommunityPost;
const comments = [
  { id: 'c1', postId: 'post-1', authorNickname: '누군가', body: '첫 댓글', parentCommentId: null },
  { id: 'c2', postId: 'post-1', authorNickname: '또누군가', body: '둘째 댓글', parentCommentId: null },
] as unknown as CommunityComment[];

function fakeClient() {
  const c = {
    ensureAuthenticated: vi.fn(async () => true),
    getFeed: vi.fn(async () => [post]),
    getComments: vi.fn(async () => comments),
    getPostingCategory: vi.fn(async () => ({ id: 'cat-1', name: '질문', slug: 'qna' })),
    createPost: vi.fn(async () => ({ ok: true, id: 'new-post' })),
    createComment: vi.fn(async () => ({ ok: true, id: 'new-comment' })),
    toggleReaction: vi.fn(async () => ({ ok: true, reacted: true })),
    toggleCommentReaction: vi.fn(async () => ({ ok: true, reacted: true })),
  };
  return c;
}

function fakeLlm() {
  return {
    evaluatePostInterest: vi.fn(async () => ({ interested: true, shouldReact: true, shouldComment: true, reason: '재밌어서' })),
    generateComment: vi.fn(async () => '잘 읽었습니다. 도움이 됐어요.'),
    generateReply: vi.fn(async () => '저도 같은 생각이에요.'),
  } as any;
}

function passedOutcome(): WriterOutcome {
  return {
    draft: { id: 'draft-1', personaId: 'p-test', category: 'qna', status: 'passed', title: '새 글', body: '본문', sources: [], facts: [], review: null, images: [], reasons: [], createdAt: 'x', publishedPostId: null },
    result: { personaId: 'p-test', category: 'qna', status: 'passed', title: '새 글', body: '본문', sources: [], facts: [], review: null, images: [], imageRejections: [], reasons: [], topic: { url: 'https://a.example/x', title: 't' }, llmCalls: 1, elapsedMs: 1 },
    published: null,
  };
}

describe('SocialAgent: DRY_RUN', () => {
  let dir: string;
  let state: StateManager;
  let registry: PersonaRegistry;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
    state = new StateManager(dir);
    registry = new PersonaRegistry(dir);
    // 모든 확률 판정을 통과(<0.5)시키되, 로그 id(Math.random 기반)가 겹치지 않게 값을 조금씩 바꾼다.
    let n = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => 0.05 + (n++ % 1000) * 0.0001);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function make(client: ReturnType<typeof fakeClient>, produce: ReturnType<typeof vi.fn>, opts: { dryRun?: boolean } = {}) {
    const writer = { produce } as unknown as WriterService;
    return new SocialAgent(persona, fakeLlm(), writer, state, registry, new PostInteractionLock(), { client: client as unknown as AgentClient, ...opts });
  }

  it('DRY_RUN: createPost·createComment·toggleReaction·toggleCommentReaction·로그인/가입이 한 번도 호출되지 않고, 읽기와 writer만 쓴다', async () => {
    const client = fakeClient();
    const produce = vi.fn(async () => passedOutcome());
    const agent = make(client, produce, { dryRun: true });
    const r = await agent.runSession();

    expect(r.ok).toBe(true);
    expect(client.ensureAuthenticated).not.toHaveBeenCalled();
    expect(client.createPost).not.toHaveBeenCalled();
    expect(client.createComment).not.toHaveBeenCalled();
    expect(client.toggleReaction).not.toHaveBeenCalled();
    expect(client.toggleCommentReaction).not.toHaveBeenCalled();
    expect(client.getFeed).toHaveBeenCalled(); // 읽기 전용 경로는 쓴다
    // writer는 드라이런 모드로, 담당 카테고리 slug로 호출
    expect(produce).toHaveBeenCalledTimes(1);
    expect((produce.mock.calls[0] as any[])[1]).toBe('qna');
    expect((produce.mock.calls[0] as any[])[2]).toEqual({ dryRun: true });

    // 활동 로그에 'dry-run'으로만 남고, 실제 활동 통계(글·댓글·공감 수)는 늘지 않는다
    const logs = state.getLogs(50, persona.id);
    const dry = logs.filter((l) => l.type === 'dry-run');
    expect(dry.some((l) => l.summary.includes('[dry-run]') && l.summary.includes('공감'))).toBe(true);
    expect(dry.some((l) => l.summary.includes('댓글') || l.summary.includes('답글'))).toBe(true);
    expect(dry.some((l) => l.summary.includes('초안을 저장'))).toBe(true);
    expect(logs.some((l) => l.type === 'post' || l.type === 'comment' || l.type === 'reaction')).toBe(false);
    const st = state.getAgentState(persona.id)!;
    expect(st.totalPosts + st.totalComments + st.totalReactions).toBe(0);
    // 실제로 쓰지 않았으니 "이미 댓글 단 글" 로컬 기록도 안 남긴다
    expect(state.hasCommentedOnPost(persona.id, 'post-1')).toBe(false);
  });

  it('기본값은 DRY_RUN(config.dryRun, DRY_RUN 환경변수가 false가 아닐 때)', async () => {
    const { config } = await import('../config.js');
    if (process.env.DRY_RUN !== 'false') expect(config.dryRun).toBe(true);
    // options.dryRun을 안 주면 config.dryRun을 따른다
    const client = fakeClient();
    const agent = make(client, vi.fn(async () => passedOutcome()));
    await agent.runSession();
    if (config.dryRun) {
      expect(client.createPost).not.toHaveBeenCalled();
      expect(client.ensureAuthenticated).not.toHaveBeenCalled();
    }
  });

  it('DRY_RUN=false: 로그인·공감·댓글을 실제로 호출하고, 새 글은 writer에 publish 콜백(createPost)을 넘긴다', async () => {
    const client = fakeClient();
    const produce = vi.fn(async (_p: unknown, _c: string, mode: any) => {
      const published = await mode.publish({ title: '새 글', body: '본문' });
      const o = passedOutcome();
      return { ...o, published };
    });
    const agent = make(client, produce, { dryRun: false });
    // humanPause(수 분)를 건너뛴다
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as any);
    const r = await agent.runSession();
    vi.mocked(globalThis.setTimeout).mockRestore();

    expect(r.ok).toBe(true);
    expect(client.ensureAuthenticated).toHaveBeenCalled();
    expect(client.toggleReaction).toHaveBeenCalled();
    expect(client.createComment).toHaveBeenCalled();
    expect((produce.mock.calls[0] as any[])[2].dryRun).toBe(false);
    expect(client.createPost).toHaveBeenCalledWith({ categoryId: 'cat-1', title: '새 글', body: '본문' });
    const logs = state.getLogs(50, persona.id);
    expect(logs.some((l) => l.type === 'post' && l.targetId === 'new-post')).toBe(true);
    expect(logs.some((l) => l.type === 'dry-run')).toBe(false);
  });

  it('writer가 폐기하면 새 글 로그 대신 폐기 사유를 남기고 게시하지 않는다', async () => {
    const client = fakeClient();
    const o = passedOutcome();
    const produce = vi.fn(async () => ({ ...o, result: { ...o.result, status: 'discarded' as const, reasons: ['deadline'] } }));
    await make(client, produce, { dryRun: true }).runSession();
    const logs = state.getLogs(50, persona.id);
    expect(logs.some((l) => l.type === 'search' && l.summary.includes('deadline'))).toBe(true);
    expect(logs.some((l) => l.summary.includes('초안을 저장'))).toBe(false);
  });
});
