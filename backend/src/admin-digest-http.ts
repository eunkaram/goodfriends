/**
 * /api/admin/digest/* HTTP 라우트 — 화제 다이제스트 제작 UI(M3)의 배선.
 * admin-http.ts와 같은 패턴(raw regex 매칭, 프레임워크 없음, 프레임워크
 * 없음): 모자레이터 아닌 요청은 다른 404와 동일한 모양으로 응답해 존재를
 * 숨긴다. `requireModerator`는 admin-http.ts의 것을 그대로 쓴다 — 이 파일
 * 분리는 admin-http.ts가 이미 비대해진 것을 막기 위해서지 게이트가 다른 건
 * 아니다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid } from './http-utils.ts';
import { requireModerator } from './admin-http.ts';
import {
  addDigestSource,
  listDigestSources,
  removeDigestSource,
  createDigestDraft,
  listDigestDrafts,
  updateDigestDraft,
  publishDigestDraft,
} from './admin-digest.ts';

export async function handleDigestAdminRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  if (!url.pathname.startsWith('/api/admin/digest')) return false;

  const moderatorId = await requireModerator(req);
  if (!moderatorId) {
    json(res, 404, { error: 'NOT_FOUND' });
    return true;
  }

  // GET /api/admin/digest/sources
  if (req.method === 'GET' && url.pathname === '/api/admin/digest/sources') {
    json(res, 200, { sources: await listDigestSources() });
    return true;
  }

  // POST /api/admin/digest/sources {username}
  if (req.method === 'POST' && url.pathname === '/api/admin/digest/sources') {
    const body = JSON.parse(await readBody(req)) as { username?: string };
    if (!body.username) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const added = await addDigestSource(body.username, moderatorId);
    if (!added.ok) {
      json(res, 404, { error: 'USER_NOT_FOUND' });
      return true;
    }
    json(res, 201, { ok: true });
    return true;
  }

  // DELETE /api/admin/digest/sources/:id
  const delSource = req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/digest\/sources\/([^/]+)$/);
  if (delSource && isUuid(delSource[1])) {
    await removeDigestSource(delSource[1]);
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/admin/digest/drafts/generate
  if (req.method === 'POST' && url.pathname === '/api/admin/digest/drafts/generate') {
    const created = await createDigestDraft(moderatorId);
    if (!created.ok) {
      const status = created.error === 'EMPTY_SOURCES_ACTIVITY' ? 400 : created.error.startsWith('LLM_FAILED') ? 502 : 500;
      json(res, status, { error: created.error });
      return true;
    }
    json(res, 201, { draft: created.draft });
    return true;
  }

  // GET /api/admin/digest/drafts?status=draft|published|all
  if (req.method === 'GET' && url.pathname === '/api/admin/digest/drafts') {
    const statusParam = url.searchParams.get('status');
    const status = statusParam === 'draft' || statusParam === 'published' ? statusParam : 'all';
    json(res, 200, { drafts: await listDigestDrafts(status) });
    return true;
  }

  // PATCH /api/admin/digest/drafts/:id {title?, content?}
  const patchDraft = req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/digest\/drafts\/([^/]+)$/);
  if (patchDraft && isUuid(patchDraft[1])) {
    const body = JSON.parse(await readBody(req)) as { title?: string; content?: string };
    const updated = await updateDigestDraft(patchDraft[1], body);
    if (!updated.ok) {
      json(res, updated.error === 'NOT_FOUND' ? 404 : 400, { error: updated.error });
      return true;
    }
    json(res, 200, { draft: updated.draft });
    return true;
  }

  // POST /api/admin/digest/drafts/:id/publish
  const publishDraft = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/digest\/drafts\/([^/]+)\/publish$/);
  if (publishDraft && isUuid(publishDraft[1])) {
    const published = await publishDigestDraft(publishDraft[1]);
    if (!published.ok) {
      const status = published.error === 'NOT_FOUND' ? 404 : published.error === 'ALREADY_PUBLISHED' ? 409 : 500;
      json(res, status, { error: published.error });
      return true;
    }
    json(res, 200, { ok: true, postPublicId: published.postPublicId });
    return true;
  }

  return false;
}
