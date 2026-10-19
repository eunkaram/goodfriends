/**
 * 구독 HTTP 라우트 — §11.7.3 "구독 버튼이 이 화면의 유일한 진입점".
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { subscribe, unsubscribe, fetchAllCategories, fetchSubscribedCategoryIds, fetchCategoryTree, fetchPopularCategories } from './categories.ts';

export async function handleCategoriesRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // GitHub #7 — 메가메뉴(계층형 트리)+비로그인 좌내비(인기 카테고리)가 SSR
  // 직접 호출뿐이었다(프론트/백엔드 분리 준비, 2단계 API 갭). 공개 GET —
  // 로그인 여부와 무관하게 항상 같은 데이터(불변식 1, Set-Cookie 금지).
  if (req.method === 'GET' && url.pathname === '/api/categories/tree') {
    const popularLimit = parsePageParam(url.searchParams.get('popularLimit'), 5, { min: 1, max: 50 });
    const [tree, popular] = await Promise.all([fetchCategoryTree(), fetchPopularCategories(popularLimit)]);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify({ tree, popular }));
    return true;
  }

  // GitHub #2 — 모바일 REST 클라이언트엔 카테고리 목록 API가 아예 없었다
  // (웹은 서버 컴포넌트가 DB를 직접 읽어 렌더링). 인증 선택 — 비로그인도
  // 피드 필터에 카테고리 목록 자체는 필요하다.
  if (req.method === 'GET' && url.pathname === '/api/categories') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    const categories = await fetchAllCategories();
    if (!userId) {
      json(res, 200, { categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })) });
      return true;
    }
    // fetchSubscribedCategoryIds 한 번 + 메모리 Set 매칭 — 카테고리마다 구독
    // 여부를 따로 쿼리하면 N+1이 된다(§5.1이 이미 겪은 것과 같은 종류의 함정).
    const subscribedIds = new Set(await fetchSubscribedCategoryIds(userId));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(
      JSON.stringify({
        categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, isSubscribed: subscribedIds.has(c.id) })),
      }),
    );
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/subscriptions') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { categoryId } = JSON.parse(await readBody(req)) as { categoryId?: string };
    // 🔒 /review 발견(api-contract) — categoryId가 비어있으면 subscriptions.category_id
    // NOT NULL 제약을 그대로 들이받아 잡히지 않은 500이 나갔다.
    if (!isUuid(categoryId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    // 🔒 사용자 지시(2026-08, "커뮤니티 구독은 최대 10개까지만 가능하게") —
    // subscribe()가 이제 SubscribeResult를 돌려준다. messages.ts의 sendMessage
    // 와 같은 관례로 LIMIT_REACHED도 400으로 매핑한다.
    const result = await subscribe(userId, categoryId);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/subscriptions') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const { categoryId } = JSON.parse(await readBody(req)) as { categoryId?: string };
    if (!isUuid(categoryId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    await unsubscribe(userId, categoryId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
