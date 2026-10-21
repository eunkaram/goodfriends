/**
 * /api/lounge HTTP 라우트 — SSR 물밑 제공(페이지 첫 렌더 때 최근 기록을
 * 서버에서 받아 그려주는 용도). 라이브 전송 자체는 `/ws/lounge`(lounge-ws.ts)
 * 가 담당한다 — REST와 WS가 같은 도메인(lounge.ts)을 공유한다.
 * posts-http.ts와 같은 패턴; 세션 없으면 401 — 라운지는 로그인한 멤버 공간.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { recentMessages } from './lounge.ts';

export async function handleLoungeRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  if (req.method === 'GET' && url.pathname === '/api/lounge/messages') {
    const token = resolveSessionToken(req);
    const userId = await getSessionUserId(token);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 50, { min: 1, max: 200 });
    json(res, 200, { messages: await recentMessages(limit) });
    return true;
  }
  return false;
}
