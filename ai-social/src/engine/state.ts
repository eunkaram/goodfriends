import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { AgentActivityLog, AgentState } from '../types.js';
import { openDatabase } from '../db/database.js';
import { shouldAlert, sendWebhookAlert, ERROR_RATE_WINDOW, ALERT_COOLDOWN_MS } from '../observability/error-rate-alert.js';

const MAX_COMMENTED_POST_IDS = 300;
// 프롬프트에 통째로 넣을 용도라 몇 개 안 남긴다(300개씩 넣으면 컨텍스트만 잡아먹음) — 최근 것만
// 알면 "방금 이렇게 썼으니 다르게 써라" 지시로 충분하다.
const MAX_RECENT_TEXTS = 3;

function rowToLog(row: any): AgentActivityLog {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    type: row.type,
    summary: row.summary,
    targetId: row.target_id ?? undefined,
    targetTitle: row.target_title ?? undefined,
    details: row.details ? JSON.parse(row.details) : undefined,
    timestamp: row.timestamp,
    sessionId: row.session_id ?? undefined,
  };
}

export class StateManager {
  private db: DatabaseSync;
  private lastAlertAt = 0;

  constructor(storageDir = path.resolve(process.cwd(), 'data')) {
    this.db = openDatabase(storageDir);
  }

  public addLog(log: Omit<AgentActivityLog, 'id' | 'timestamp'>): AgentActivityLog {
    const fullLog: AgentActivityLog = {
      ...log,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO activity_logs (id, agent_id, agent_name, type, summary, target_id, target_title, details, timestamp, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        fullLog.id,
        fullLog.agentId,
        fullLog.agentName,
        fullLog.type,
        fullLog.summary,
        fullLog.targetId ?? null,
        fullLog.targetTitle ?? null,
        fullLog.details ? JSON.stringify(fullLog.details) : null,
        fullLog.timestamp,
        fullLog.sessionId ?? null
      );

    // 통계 갱신 (기존 동작 유지: post/comment/reaction 카운트, 마지막 활동 요약)
    const state = this.getAgentState(log.agentId);
    if (state) {
      if (log.type === 'post') state.totalPosts += 1;
      if (log.type === 'comment') state.totalComments += 1;
      if (log.type === 'reaction') state.totalReactions += 1;
      state.lastActionSummary = log.summary;
      state.lastActiveAt = fullLog.timestamp;
      this.saveState(state);
    }

    if (log.type === 'error') {
      this.checkErrorRateAndAlert();
    }

    return fullLog;
  }

  private checkErrorRateAndAlert(): void {
    const recentTypes = this.getLogs(ERROR_RATE_WINDOW).map((l) => l.type);
    if (!shouldAlert(recentTypes)) return;

    const now = Date.now();
    if (now - this.lastAlertAt < ALERT_COOLDOWN_MS) return; // 같은 상태로 반복 스팸 방지
    this.lastAlertAt = now;

    const errorCount = recentTypes.filter((t) => t === 'error').length;
    sendWebhookAlert(
      `⚠️ 에러율 임계치 초과: 최근 ${recentTypes.length}개 로그 중 ${errorCount}건 에러`
    ).catch(() => {});
  }

  public getLogs(limit = 50, agentId?: string): AgentActivityLog[] {
    const rows = agentId
      ? (this.db
          .prepare(`SELECT * FROM activity_logs WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?`)
          .all(agentId, limit) as any[])
      : (this.db.prepare(`SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?`).all(limit) as any[]);
    return rows.map(rowToLog);
  }

  /** 세션 리플레이: 같은 sessionId를 가진 로그를 시간순으로 반환 */
  public getLogsBySession(sessionId: string): AgentActivityLog[] {
    const rows = this.db
      .prepare(`SELECT * FROM activity_logs WHERE session_id = ? ORDER BY timestamp ASC`)
      .all(sessionId) as any[];
    return rows.map(rowToLog);
  }

  /** 최근 세션 목록 (리플레이 대상 탐색용) */
  public getRecentSessions(
    agentId: string,
    limit = 10
  ): { sessionId: string; startedAt: string; endedAt: string; logCount: number }[] {
    const rows = this.db
      .prepare(
        `SELECT session_id as sessionId, MIN(timestamp) as startedAt, MAX(timestamp) as endedAt, COUNT(*) as logCount
         FROM activity_logs
         WHERE agent_id = ? AND session_id IS NOT NULL
         GROUP BY session_id
         ORDER BY startedAt DESC
         LIMIT ?`
      )
      .all(agentId, limit) as any[];
    return rows;
  }

  public getAgentState(agentId: string): AgentState | undefined {
    const row = this.db.prepare(`SELECT data FROM agent_states WHERE id = ?`).get(agentId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AgentState) : undefined;
  }

  public getAllStates(): AgentState[] {
    const rows = this.db.prepare(`SELECT data FROM agent_states`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as AgentState);
  }

  private saveState(state: AgentState): void {
    this.db
      .prepare(`INSERT INTO agent_states (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(state.id, JSON.stringify(state));
  }

  public initOrUpdateState(agentId: string, partial: Partial<AgentState>): void {
    const existing = this.getAgentState(agentId) || {
      id: agentId,
      name: '',
      nickname: '',
      email: '',
      status: 'idle',
      sessionActive: false,
      totalPosts: 0,
      totalComments: 0,
      totalReactions: 0,
    };
    this.saveState({ ...existing, ...partial });
  }

  /** 이 에이전트가 이 글에 이미 댓글을 남긴 적 있는지 (스레드당 코멘트 상한용) */
  public hasCommentedOnPost(agentId: string, postId: string): boolean {
    const state = this.getAgentState(agentId);
    return Boolean(state?.commentedPostIds?.includes(postId));
  }

  /** 댓글 남긴 postId 기록 (최근 N개만 보관, 무한 증가 방지) */
  public recordCommentedPost(agentId: string, postId: string): void {
    const state = this.getAgentState(agentId);
    if (!state) return;
    const list = state.commentedPostIds ? [...state.commentedPostIds] : [];
    if (!list.includes(postId)) {
      list.push(postId);
      if (list.length > MAX_COMMENTED_POST_IDS) {
        list.splice(0, list.length - MAX_COMMENTED_POST_IDS);
      }
    }
    state.commentedPostIds = list;
    this.saveState(state);
  }

  /**
   * 방금 작성한 글/댓글의 앞부분을 기록(최근 MAX_RECENT_TEXTS개만 보관). 다음 생성 프롬프트의
   * "반복 방지" 지시에 그대로 들어간다 — persona-prompt.ts 참고.
   */
  public recordRecentText(agentId: string, text: string, maxChars = 80): void {
    const state = this.getAgentState(agentId);
    if (!state) return;
    const excerpt = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
    const list = state.recentTexts ? [...state.recentTexts] : [];
    list.push(excerpt);
    if (list.length > MAX_RECENT_TEXTS) {
      list.splice(0, list.length - MAX_RECENT_TEXTS);
    }
    state.recentTexts = list;
    this.saveState(state);
  }
}
