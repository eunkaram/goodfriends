/**
 * ProfileLink HTTP 라우트 — albums-http.ts/posts-http.ts(DELETE/PATCH :id
 * 경로 파라미터 패턴)와 같은 관례. userId는 항상 세션에서만 유도한다 —
 * 클라이언트가 수정 대상 소유자를 지정할 방법이 없다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { addProfileLink, updateProfileLink, deleteProfileLink } from './profile-links.ts';

export async function handleProfileLinksRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'POST' && url.pathname === '/api/profile-links') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { name, url: linkUrl } = JSON.parse(await readBody(req)) as { name: string; url: string };
    const result = await addProfileLink(userId, name ?? '', linkUrl ?? '');
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 201, { id: result.id });
    return true;
  }

  const updateMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/profile-links\/([^/]+)$/);
  if (updateMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const linkId = updateMatch[1];
    if (!isUuid(linkId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { name, url: linkUrl } = JSON.parse(await readBody(req)) as { name: string; url: string };
    const result = await updateProfileLink(userId, linkId, name ?? '', linkUrl ?? '');
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const deleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/profile-links\/([^/]+)$/);
  if (deleteMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const linkId = deleteMatch[1];
    if (!isUuid(linkId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await deleteProfileLink(userId, linkId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
