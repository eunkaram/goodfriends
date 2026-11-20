import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateManager } from './state.js';

describe('StateManager thread comment cap tracking', () => {
  let tmpDir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reafy-state-test-'));
    stateManager = new StateManager(tmpDir);
    stateManager.initOrUpdateState('agent-1', { id: 'agent-1', name: 'A', nickname: 'A', email: 'a@x.com' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports no prior comment for a fresh post', () => {
    expect(stateManager.hasCommentedOnPost('agent-1', 'post-1')).toBe(false);
  });

  it('remembers a post once recorded (자기 루프 방지)', () => {
    stateManager.recordCommentedPost('agent-1', 'post-1');
    expect(stateManager.hasCommentedOnPost('agent-1', 'post-1')).toBe(true);
    expect(stateManager.hasCommentedOnPost('agent-1', 'post-2')).toBe(false);
  });

  it('does not duplicate the same postId when recorded twice', () => {
    stateManager.recordCommentedPost('agent-1', 'post-1');
    stateManager.recordCommentedPost('agent-1', 'post-1');
    const state = stateManager.getAgentState('agent-1');
    expect(state?.commentedPostIds?.filter((id) => id === 'post-1')).toHaveLength(1);
  });

  it('caps the tracked list so it does not grow unbounded', () => {
    for (let i = 0; i < 400; i++) {
      stateManager.recordCommentedPost('agent-1', `post-${i}`);
    }
    const state = stateManager.getAgentState('agent-1');
    expect(state?.commentedPostIds?.length).toBeLessThanOrEqual(300);
    // 가장 최근 것은 남아있어야 함
    expect(stateManager.hasCommentedOnPost('agent-1', 'post-399')).toBe(true);
  });

  it('persists across StateManager instances backed by the same directory', () => {
    stateManager.recordCommentedPost('agent-1', 'post-1');
    const reloaded = new StateManager(tmpDir);
    expect(reloaded.hasCommentedOnPost('agent-1', 'post-1')).toBe(true);
  });
});

describe('StateManager session replay (T10)', () => {
  let tmpDir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reafy-state-test-'));
    stateManager = new StateManager(tmpDir);
    stateManager.initOrUpdateState('agent-1', { id: 'agent-1', name: 'A', nickname: 'A', email: 'a@x.com' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('groups logs by sessionId and returns them in chronological order', () => {
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'browse', summary: 'browsed', sessionId: 'session-x' });
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'comment', summary: 'commented', sessionId: 'session-x' });
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'browse', summary: 'other session', sessionId: 'session-y' });

    const replay = stateManager.getLogsBySession('session-x');
    expect(replay).toHaveLength(2);
    expect(replay[0].summary).toBe('browsed');
    expect(replay[1].summary).toBe('commented');
  });

  it('returns an empty array for an unknown sessionId', () => {
    expect(stateManager.getLogsBySession('nope')).toEqual([]);
  });

  it('lists recent sessions for an agent with start/end/count', () => {
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'browse', summary: 'a', sessionId: 'session-1' });
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'post', summary: 'b', sessionId: 'session-1' });
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'browse', summary: 'c', sessionId: 'session-2' });

    const sessions = stateManager.getRecentSessions('agent-1', 10);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(['session-1', 'session-2']);
    const session1 = sessions.find((s) => s.sessionId === 'session-1');
    expect(session1?.logCount).toBe(2);
  });

  it('getLogs filters by agentId when given, and returns all agents when omitted', () => {
    stateManager.initOrUpdateState('agent-2', { id: 'agent-2', name: 'B', nickname: 'B', email: 'b@x.com' });
    stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'browse', summary: 'a1' });
    stateManager.addLog({ agentId: 'agent-2', agentName: 'B', type: 'browse', summary: 'b1' });

    const onlyAgent1 = stateManager.getLogs(20, 'agent-1');
    expect(onlyAgent1.every((l) => l.agentId === 'agent-1')).toBe(true);
    expect(onlyAgent1.some((l) => l.summary === 'a1')).toBe(true);

    const all = stateManager.getLogs(20);
    expect(all.some((l) => l.summary === 'a1')).toBe(true);
    expect(all.some((l) => l.summary === 'b1')).toBe(true);
  });

  it('tracks used source URLs so a repost of the same external article can be detected ahead of time', () => {
    const url = 'https://www.etnews.com/20260906000001';
    expect(stateManager.hasUsedSourceUrl(url)).toBe(false);

    stateManager.recordUsedSourceUrl(url, 'agent-1');
    expect(stateManager.hasUsedSourceUrl(url)).toBe(true);

    // 다른 에이전트가 같은 URL을 다시 기록하려 해도(동시성 등) 에러 없이 무시됨
    expect(() => stateManager.recordUsedSourceUrl(url, 'agent-2')).not.toThrow();
    expect(stateManager.hasUsedSourceUrl('https://www.etnews.com/never-posted')).toBe(false);
  });
});

describe('StateManager error-rate alert (T10)', () => {
  let tmpDir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reafy-state-test-'));
    stateManager = new StateManager(tmpDir);
    stateManager.initOrUpdateState('agent-1', { id: 'agent-1', name: 'A', nickname: 'A', email: 'a@x.com' });
    delete process.env.WEBHOOK_URL;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs an error-type entry without throwing even when the error rate crosses the threshold', () => {
    for (let i = 0; i < 10; i++) {
      expect(() =>
        stateManager.addLog({ agentId: 'agent-1', agentName: 'A', type: 'error', summary: `err ${i}` })
      ).not.toThrow();
    }
    const logs = stateManager.getLogs(20);
    expect(logs.filter((l) => l.type === 'error')).toHaveLength(10);
  });
});
