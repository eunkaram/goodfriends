/**
 * 시리즈(개발 로그 연재) HTTP 라우트 — M2. 플러드 방지(전면 쓰기는 로그인 필수,
 * rate limit은 1차에서 조금 후한 수위 유지)이고, 공개 GET은 RLS 없는 series
 * 테이블이지만 목록은 public scope만을 다룬다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import {
  createSeries,
  listSeries,
  fetchSeriesWithPosts,
  attachPostToSeries,
  detachPostFromSeries,
  updateSeries,
  deleteSeries,
} from './series.ts';
import { checkRateLimit } from './rate-limit.ts';
import { resolvePostId } from './posts.ts';

async function requireUserId(req: IncomingMessage): Promise<string | null> {
  const token = resolveSessionToken(req);
  return getSessionUserId(token);
}

export async function handleSeriesRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 공개 — 시리즈 탐색/프로필 표시용. username 없으면 전체 최신 50개.
  if (req.method === 'GET' && url.pathname === '/api/series') {
    const username = url.searchParams.get('username');
    const limit = parsePageParam(url.searchParams.get('limit'), 50, { min: 1, max: 100 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const series = await listSeries(username, limit, offset);
    json(res, 200, { series });
    return true;
  }

  // 공개 — 시리즈 상세(헤더 + 공개 글 목록, 순번순)
  const getMatch = req.method === 'GET' && url.pathname.match(/^\/api\/series\/([^/]+)$/);
  if (getMatch) {
    if (!isUuid(getMatch[1])) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const found = await fetchSeriesWithPosts(getMatch[1]);
    if (!found) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    json(res, 200, found);
    return true;
  }

  // 생성 — 로그인 필수. 계정당 시간당 10개로 막는다(시리즈 남발).
  if (req.method === 'POST' && url.pathname === '/api/series') {
    const userId = await requireUserId(req);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!(await checkRateLimit(`series:${userId}`, 10, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const input = JSON.parse(await readBody(req)) as { title: unknown; description?: unknown };
    const result = await createSeries(userId, {
      title: input.title as string,
      description: typeof input.description === 'string' ? input.description : undefined,
    });
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 201, { series: result.series });
    return true;
  }

  // 수정 — 소유자만
  const updateMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/series\/([^/]+)$/);
  if (updateMatch) {
    const userId = await requireUserId(req);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!isUuid(updateMatch[1])) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const input = JSON.parse(await readBody(req)) as { title?: unknown; description?: unknown };
    const result = await updateSeries(userId, updateMatch[1], {
      title: typeof input.title === 'string' ? input.title : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
    });
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 삭제 — 소유자만. 글은 유지(SET NULL).
  const deleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/series\/([^/]+)$/);
  if (deleteMatch) {
    const userId = await requireUserId(req);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!isUuid(deleteMatch[1])) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await deleteSeries(userId, deleteMatch[1]);
    if (!result.ok) {
      json(res, 404, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 글 담기 — 시리즈 소유자 == 글 작성자 조건이 series.ts에서 재검증된다.
  const attachMatch = req.method === 'POST' && url.pathname.match(/^\/api\/series\/([^/]+)\/posts$/);
  if (attachMatch) {
    const userId = await requireUserId(req);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!isUuid(attachMatch[1])) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const input = JSON.parse(await readBody(req)) as { postId: unknown };
    // 글 식별자는 내부 uuid와 public_id(0038) 둘 다 받는다 — intent-http와 같은 해석 패턴.
    let postId: string;
    if (typeof input.postId !== 'string') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    postId = input.postId;
    if (!isUuid(postId)) {
      const resolvedId = await resolvePostId(postId);
      if (!resolvedId) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
      postId = resolvedId;
    }
    const result = await attachPostToSeries(userId, attachMatch[1], postId);
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 글 빼기
  const detachMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/series\/([^/]+)\/posts\/([^/]+)$/);
  if (detachMatch) {
    const userId = await requireUserId(req);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!isUuid(detachMatch[1]) || !isUuid(detachMatch[2])) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await detachPostFromSeries(userId, detachMatch[1], detachMatch[2]);
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
