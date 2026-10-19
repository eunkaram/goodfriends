/**
 * 유저용 공지사항 조회 — 이슈 #10. `/messages` 페이지가 호출해 활성
 * 공지사항을 배너로 보여준다. 관리자 CRUD는 admin-http.ts(`/api/admin/
 * announcements`) 쪽 — requireModerator() 게이트가 필요해서 파일을 분리했다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { fetchActiveAnnouncements } from './announcements.ts';

export async function handleAnnouncementsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'GET' && url.pathname === '/api/announcements/active') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const announcements = await fetchActiveAnnouncements();
    json(res, 200, { announcements });
    return true;
  }

  return false;
}
