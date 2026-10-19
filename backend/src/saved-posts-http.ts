/**
 * 저장한 글 취소 HTTP 라우트 — §11.7.7 `/saved`. 저장(추가)은 이미 있는
 * P4 경로(`POST /api/intent/execute`, action:'save')를 그대로 재사용하고,
 * 이 파일은 그 반대(취소)만 담당한다 — reports-http.ts와 같은 얇은 패턴.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { unsavePost, fetchSavedPosts } from './feed.ts';

export async function handleSavedPostsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'GET' && url.pathname === '/api/saved-posts') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const posts = await fetchSavedPosts(userId, limit, offset);
    json(res, 200, { posts });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/saved-posts') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { postId } = JSON.parse(await readBody(req)) as { postId?: string };
    if (!isUuid(postId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await unsavePost(userId, postId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
