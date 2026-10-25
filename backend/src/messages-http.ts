/**
 * 메시징 HTTP 라우트 — posts-http.ts와 같은 패턴(경로 파라미터는 REST 관례로
 * 스레드 id를 경로에 둔다). reafy_backend(forked 전 원본) src/messages-http.ts
 * 그대로 이식.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { findOrCreateDirectThread, fetchThreads, fetchMessages, sendMessage, markThreadRead, hasUnreadMessages } from './messages.ts';

export async function handleMessagesRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 좌측 메뉴 Messages 배지용 — 모바일 쪽과 로직은 같지만(hasUnreadMessages 재사용) 라우트는 분리.
  if (req.method === 'GET' && url.pathname === '/api/messages/unread') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const hasUnread = await hasUnreadMessages(userId);
    json(res, 200, { hasUnread });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/messages/thread') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { otherUserId } = JSON.parse(await readBody(req)) as { otherUserId?: string };
    if (!isUuid(otherUserId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await findOrCreateDirectThread(userId, otherUserId);
    if (!result.ok) {
      json(res, result.error === 'BLOCKED' ? 403 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { threadId: result.threadId });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/messages/threads') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const threads = await fetchThreads(userId);
    json(res, 200, threads);
    return true;
  }

  const readMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/read$/);
  if (req.method === 'POST' && readMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const threadId = readMatch[1];
    if (!isUuid(threadId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await markThreadRead(userId, threadId);
    json(res, 200, { ok: true });
    return true;
  }

  const threadMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (threadMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const threadId = threadMatch[1];
    if (!isUuid(threadId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }

    if (req.method === 'GET') {
      const messages = await fetchMessages(userId, threadId);
      json(res, 200, { messages });
      return true;
    }

    if (req.method === 'POST') {
      const { body } = JSON.parse(await readBody(req)) as { body?: string };
      const result = await sendMessage(userId, threadId, body ?? '');
      if (!result.ok) {
        const status = result.error === 'NOT_PARTICIPANT' ? 404 : result.error === 'BLOCKED' ? 403 : 400;
        json(res, status, { error: result.error });
        return true;
      }
      json(res, 201, { id: result.messageId });
      return true;
    }
  }

  return false;
}
