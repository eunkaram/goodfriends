/**
 * 전체검색 HTTP — `GET /api/search?q=&category=&limit=&offset=`.
 *
 * 응답은 제목/본문을 합친 글 목록 하나를 돌려준다. limit+1만 읽고
 * hasMore만 알려주므로 정확한 총개수는 응답에 없다(§6.8 성능 계약).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { searchAll, MIN_SEARCH_LENGTH } from './search.ts';

const MAX_QUERY_LENGTH = 100;

export async function handleSearchRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  if (req.method !== 'GET' || url.pathname !== '/api/search') return false;

  // 검색 결과는 로그인 사용자의 RLS(친구·팔로우 로그)에 따라 달라질 수 있다.
  // 공유 캐시/브라우저 캐시에 남지 않게 명시한다.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');

  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length > MAX_QUERY_LENGTH) {
    json(res, 400, { error: 'INVALID_INPUT' });
    return true;
  }

  const sessionToken = resolveSessionToken(req);
  const userId = await getSessionUserId(sessionToken);
  const limit = parsePageParam(url.searchParams.get('limit'), 10, { min: 1, max: 30 });
  const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100 });
  const categorySlug = url.searchParams.get('category') || undefined;

  // 2자 미만은 인덱스 하한이라 서비스가 빈 목록을 즉시 돌려준다 — HTTP는 200을
  // 유지해 UI가 "두 글자 이상 입력" 안내를 그대로 그릴 수 있게 한다.
  if (q.length < MIN_SEARCH_LENGTH) {
    json(res, 200, {
      query: q,
      posts: { items: [], hasMore: false, nextOffset: null },
    });
    return true;
  }

  const results = await searchAll(userId, q, { limit, offset, categorySlug });
  json(res, 200, results);
  return true;
}
