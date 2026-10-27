/**
 * 인기글 HTTP 라우트 — src/popularity.ts.
 *
 * GitHub #8 — "인기글" 위젯(홈/카테고리/저장됨/게시글 상세 등 반복 노출)이
 * SSR 직접 호출뿐이었다(프론트/백엔드 분리 준비, 2단계 API 갭). 모든 소비처가
 * `window='24h'`, `limit=5`(오버페치 10) 조합만 쓰지만 라우트는 그대로 파라미터화한다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { getOrComputePopularity, fetchPopularPosts, overFetchCount, type PopularityWindow } from './popularity.ts';
import { appPool } from './db.ts';

const pool = appPool('exists'); // 불변식 20 — 모듈 스코프에서 한 번만.

export async function handlePopularityRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 공개 GET — 인기순 자체는 §5.1.1 전제상 전역 랭킹이라 개인화 없음
  // (불변식 1 Set-Cookie 금지, 불변식 5 캐시 키에 사용자 식별자 금지 —
  // getPopularity/cachePopularity가 이미 지키는 것을 그대로 재사용).
  if (req.method === 'GET' && url.pathname === '/api/popularity') {
    const categoryIdParam = url.searchParams.get('categoryId');
    if (categoryIdParam !== null && !isUuid(categoryIdParam)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const categoryId = categoryIdParam;
    const windowParam = url.searchParams.get('window');
    const window: PopularityWindow = windowParam === '7d' ? '7d' : '24h';
    const limit = parsePageParam(url.searchParams.get('limit'), 5, { min: 1, max: 50 });

    const userId = await getSessionUserId(resolveSessionToken(req));

    const rankedIds = await getOrComputePopularity(pool, categoryId, window);
    const posts = await fetchPopularPosts(userId, rankedIds.slice(0, overFetchCount(limit)), limit);

    json(res, 200, { posts });
    return true;
  }

  return false;
}
