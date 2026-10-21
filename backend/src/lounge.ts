/**
 * 라운지 채팅 도메인 — M4("전체방 1개: 접속/발言/최근 기록"). 마이그레이션
 * 0052. ws는 ws-server.ts가 배선하고(HTTP는 lounge-http.ts), 이 모듈은 DB
 * 게 계층(flow: 검증 → rate limit은 ws 핸들러가 → INSERT → 브로드캐스트)만
 * 담당한다.
 *
 * 🔒 0002/0048 전례 — chat_messages는 RLS가 없다(전체방 공개 성격). 따라서
 *    "author_id를 클라이언트가 정하면 장부 조작이다"를 앱 레이어가 지킨다:
 *    insertMessage()는 authorId를 인자로만 받고(쿠키 세션에서 유도된 값),
 *    HTTP/WS 어디에도 클라이언트 제공 author가 마다 없다.
 */
import { appPool, queryRaw } from './db.ts';

const pool = appPool('exists');

export const MAX_CHAT_BODY_LENGTH = 1000; // 0052 CHECK 제약과 동일 값
export const LOUNGE_HISTORY_LIMIT = 50;

export type ChatMessage = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string | null;
  authorIsAgent: boolean;
  body: string;
  createdAt: string;
};

export function chatBodyTooLong(value: string): boolean {
  return value.length > MAX_CHAT_BODY_LENGTH;
}

/** 최근 기록(최신순 저장, 오래된 순으로 되돌려 준다 — 채팅은 아래로 쌓인다). */
export async function recentMessages(limit: number = LOUNGE_HISTORY_LIMIT): Promise<ChatMessage[]> {
  const rows = await queryRaw<{
    id: string;
    author_id: string;
    body: string;
    created_at: Date;
    username: string;
    nickname: string | null;
    is_agent: boolean;
  }>(
    pool,
    `SELECT m.id, m.author_id, m.body, m.created_at, u.username, u.nickname, u.is_agent
     FROM chat_messages m JOIN users u ON u.id = m.author_id
     WHERE m.hidden_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return rows.rows
    .map((r) => ({
      id: r.id,
      authorId: r.author_id,
      authorUsername: r.username,
      authorNickname: r.nickname,
      authorIsAgent: r.is_agent,
      body: r.body,
      createdAt: r.created_at.toISOString(),
    }))
    .reverse();
}

export async function insertMessage(authorId: string, body: string): Promise<ChatMessage> {
  const res = await queryRaw<{
    id: string;
    created_at: Date;
    username: string;
    nickname: string | null;
    is_agent: boolean;
  }>(
    pool,
    `INSERT INTO chat_messages (author_id, body)
     VALUES ($1, $2)
     RETURNING id, created_at,
       (SELECT username FROM users WHERE id = $1) AS username,
       (SELECT nickname FROM users WHERE id = $1) AS nickname,
       (SELECT is_agent FROM users WHERE id = $1) AS is_agent`,
    [authorId, body],
  );
  const r = res.rows[0];
  return {
    id: r.id,
    authorId,
    authorUsername: r.username,
    authorNickname: r.nickname,
    authorIsAgent: r.is_agent,
    body,
    createdAt: r.created_at.toISOString(),
  };
}
