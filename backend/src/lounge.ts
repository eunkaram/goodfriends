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

/** 🔒 사용자 지시(2026-10, "댓글 달기하면 내 글에 원글이 일부 포함되어야 하고
 * 원글을 클릭하면 원글위치로 옮겨져서") — 0056 reply_to_id. 클릭 시 스크롤은
 * 프론트가 현재 로드된 목록(최근 LOUNGE_HISTORY_LIMIT건) 안에서 DOM으로
 * 찾는다 — 그보다 오래된 원글로의 점프는 범위 밖(페이지네이션 자체가 없다). */
export type ReplyToSummary = { id: string; authorUsername: string; authorNickname: string | null; bodyExcerpt: string };

export type ChatMessage = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string | null;
  authorIsAgent: boolean;
  body: string;
  createdAt: string;
  replyTo: ReplyToSummary | null;
};

export function chatBodyTooLong(value: string): boolean {
  return value.length > MAX_CHAT_BODY_LENGTH;
}

const REPLY_EXCERPT_LENGTH = 80;

function excerpt(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > REPLY_EXCERPT_LENGTH ? `${trimmed.slice(0, REPLY_EXCERPT_LENGTH)}…` : trimmed;
}

export type PresenceUserInfo = { username: string; nickname: string | null; isAgent: boolean };

/** 🔒 사용자 지시(2026-10, "오른쪽 영역에 접속된 사용자 리스트도... 온라인상태도") —
 * lounge-ws.ts가 접속 시점에 소켓→userId만 들고 있던 걸 표시용 닉네임/에이전트
 * 여부까지 들고 있게 확장하며 추가. recentMessages()/insertMessage()와 같은
 * users 조인 필드 세트(username/nickname/is_agent)만 쓴다 — 메시지 표시와
 * 접속자 표시가 같은 신원 정보를 보여줘야 하므로 일관되게 유지한다. */
export async function fetchPresenceInfo(userId: string): Promise<PresenceUserInfo | null> {
  const r = await queryRaw<{ username: string; nickname: string | null; is_agent: boolean }>(
    pool,
    `SELECT username, nickname, is_agent FROM users WHERE id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { username: row.username, nickname: row.nickname, isAgent: row.is_agent };
}

/** 최근 기록(최신순 저장, 오래된 순으로 되돌려 준다 — 채팅은 아래로 쌓인다).
 * 🔒 0056 — 답장 대상(rm/ru)은 LEFT JOIN: reply_to_id가 NULL(보통 메시지)이거나
 * 원글이 숨겨졌으면(hidden_at) 조용히 replyTo:null로 떨어진다 — 숨긴 내용을
 * 인용으로 다시 노출하지 않는다. */
export async function recentMessages(limit: number = LOUNGE_HISTORY_LIMIT): Promise<ChatMessage[]> {
  const rows = await queryRaw<{
    id: string;
    author_id: string;
    body: string;
    created_at: Date;
    username: string;
    nickname: string | null;
    is_agent: boolean;
    reply_id: string | null;
    reply_body: string | null;
    reply_username: string | null;
    reply_nickname: string | null;
  }>(
    pool,
    `SELECT m.id, m.author_id, m.body, m.created_at, u.username, u.nickname, u.is_agent,
       rm.id AS reply_id, rm.body AS reply_body, ru.username AS reply_username, ru.nickname AS reply_nickname
     FROM chat_messages m
     JOIN users u ON u.id = m.author_id
     LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id AND rm.hidden_at IS NULL
     LEFT JOIN users ru ON ru.id = rm.author_id
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
      replyTo:
        r.reply_id && r.reply_username
          ? { id: r.reply_id, authorUsername: r.reply_username, authorNickname: r.reply_nickname, bodyExcerpt: excerpt(r.reply_body ?? '') }
          : null,
    }))
    .reverse();
}

/** 🔒 0056 — replyToId는 클라이언트가 보낸 값이라(ws 핸들러가 UUID 형식만
 * 확인) 그대로 INSERT에 꽂지 않는다: 존재하지 않거나 이미 숨겨진 메시지를
 * 가리키면 FK 위반 예외를 던지는 대신 조용히 "답장 아님"으로 떨어뜨린다
 * (상대가 보내는 그 찰나 원글이 사라지는 경쟁 상태를 사용자 에러로 만들지
 * 않는다 — recentMessages의 LEFT JOIN과 같은 태도). */
export async function insertMessage(authorId: string, body: string, replyToId?: string | null): Promise<ChatMessage> {
  let validReplyToId: string | null = null;
  if (replyToId) {
    const existing = await queryRaw<{ id: string }>(pool, `SELECT id FROM chat_messages WHERE id = $1 AND hidden_at IS NULL`, [replyToId]);
    validReplyToId = existing.rows[0]?.id ?? null;
  }

  const res = await queryRaw<{
    id: string;
    created_at: Date;
    username: string;
    nickname: string | null;
    is_agent: boolean;
  }>(
    pool,
    `INSERT INTO chat_messages (author_id, body, reply_to_id)
     VALUES ($1, $2, $3)
     RETURNING id, created_at,
       (SELECT username FROM users WHERE id = $1) AS username,
       (SELECT nickname FROM users WHERE id = $1) AS nickname,
       (SELECT is_agent FROM users WHERE id = $1) AS is_agent`,
    [authorId, body, validReplyToId],
  );
  const r = res.rows[0];

  let replyTo: ReplyToSummary | null = null;
  if (validReplyToId) {
    const target = await queryRaw<{ id: string; body: string; username: string; nickname: string | null }>(
      pool,
      `SELECT m.id, m.body, u.username, u.nickname FROM chat_messages m JOIN users u ON u.id = m.author_id WHERE m.id = $1`,
      [validReplyToId],
    );
    const t = target.rows[0];
    if (t) replyTo = { id: t.id, authorUsername: t.username, authorNickname: t.nickname, bodyExcerpt: excerpt(t.body) };
  }

  return {
    id: r.id,
    authorId,
    authorUsername: r.username,
    authorNickname: r.nickname,
    authorIsAgent: r.is_agent,
    body,
    createdAt: r.created_at.toISOString(),
    replyTo,
  };
}
