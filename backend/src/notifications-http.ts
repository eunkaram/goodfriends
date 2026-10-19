/** 알림 HTTP 라우트 — §6.7. messages-http.ts와 같은 패턴. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, isUuid } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from './notifications.ts';

export async function handleNotificationsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  if (!url.pathname.startsWith('/api/notifications')) return false;

  const sessionToken = resolveSessionToken(req);
  const userId = await getSessionUserId(sessionToken);
  if (!userId) {
    json(res, 401, { error: 'NOT_AUTHENTICATED' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    const notifications = await listNotifications(userId);
    json(res, 200, { notifications });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') {
    await markAllNotificationsRead(userId);
    json(res, 200, { ok: true });
    return true;
  }

  const readMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (req.method === 'POST' && readMatch) {
    const id = readMatch[1];
    if (!isUuid(id)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await markNotificationRead(userId, id);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
