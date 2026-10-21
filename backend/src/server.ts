/**
 * 앱 진입점 — API+WS 단일 프로세스
 *
 * web(Next.js)이 여기 라우트만 호출한다 — 이 프로세스는 SSR을 하지 않는다.
 * 인증 라우트를 먼저 태우고, 아무도 처리 못 한 요청은 404 JSON을 낸다.
 */
import './load-env.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleHealthRoutes } from './health-http.ts';
import { handleAuthRoutes } from './auth-http.ts';
import { handlePostsRoutes } from './posts-http.ts';
import { handleCategoriesRoutes } from './categories-http.ts';
import { handlePopularityRoutes } from './popularity-http.ts';
import { handleRelationshipsRoutes } from './relationships-http.ts';
import { handleIntentRoutes } from './intent-http.ts';
import { handleSeriesRoutes } from './series-http.ts';
import { handleLinkPreviewRoutes } from './link-preview-http.ts';
import { handleReportsRoutes } from './reports-http.ts';
import { handleUserLogRoutes } from './user-log-http.ts';
import { handleProfileLinksRoutes } from './profile-links-http.ts';
import { handleSavedPostsRoutes } from './saved-posts-http.ts';
import { handleNotificationsRoutes } from './notifications-http.ts';
import { handleAdminRoutes } from './admin-http.ts';
import { handleDigestAdminRoutes } from './admin-digest-http.ts';
import { handleSitemapRoutes } from './sitemap-http.ts';
import { handleAnnouncementsRoutes } from './announcements-http.ts';
import { handleLoungeRoutes } from './lounge-http.ts';
import { attachWsServer } from './ws-server.ts';
import { json } from './http-utils.ts';
import { alertAdminOfError } from './error-alert.ts';

// 3000은 이 머신에서 다른 프로젝트가 이미 쓰고 있어 충돌한다 — 3010을 기본값으로 둔다.
const PORT = Number(process.env.PORT ?? 3010);
const dev = process.env.NODE_ENV !== 'production';

// 🔒 실전 발견(2026-09-04) — 프론트/백엔드 분리 전엔 같은 오리진이라 CORS가
// 필요 없었다. 지금은 web가 별도 오리진이고, /ws(웹소켓)처럼
// 브라우저가 SSR을 안 거치고 이 서버에 직접 붙는 경로가 있어 크로스오리진
// 요청이 실제로 발생한다 — 세션 쿠키를 실어야 하니 '*'가 아니라 단일
// 오리진(APP_BASE_URL, OAuth 리다이렉트와 같은 값)만 명시적으로 허용한다.
function applyCors(req: IncomingMessage, res: ServerResponse) {
  const allowedOrigin = process.env.APP_BASE_URL || 'http://localhost:3010';
  if (req.headers.origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

/** server.ts 자체 라우팅(CORS·404·에러 포맷)을 테스트가 독립된 http 서버로 감쌀 수 있게 분리 — 다른 *-http.ts 핸들러들과 같은 패턴. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    if (await handleHealthRoutes(req, res)) return;
    if (await handleAuthRoutes(req, res)) return;
    if (await handlePostsRoutes(req, res)) return;
    if (await handleCategoriesRoutes(req, res)) return;
    if (await handlePopularityRoutes(req, res)) return;
    if (await handleRelationshipsRoutes(req, res)) return;
    if (await handleIntentRoutes(req, res)) return;
    if (await handleSeriesRoutes(req, res)) return;
    if (await handleLinkPreviewRoutes(req, res)) return;
    if (await handleReportsRoutes(req, res)) return;
    if (await handleUserLogRoutes(req, res)) return;
    if (await handleProfileLinksRoutes(req, res)) return;
    if (await handleSavedPostsRoutes(req, res)) return;
    if (await handleLoungeRoutes(req, res)) return;
    if (await handleNotificationsRoutes(req, res)) return;
    // 🔒 순서 — /api/admin/*는 admin-http.ts가 마지막에 catch-all 404로 닫기
    // 때문에, digest(같은 prefix)는 반드시 앞에서 처리한다.
    if (await handleDigestAdminRoutes(req, res)) return;
    if (await handleAdminRoutes(req, res)) return;
    if (await handleSitemapRoutes(req, res)) return;
    if (await handleAnnouncementsRoutes(req, res)) return;
    json(res, 404, { error: 'NOT_FOUND' });
  } catch (err) {
    console.error(err);
    // 🔒 /review 발견(api-contract) — 이 catch만 평문 500을 냈다. 다른 모든
    // 라우트는 json()으로 {error: CODE} 구조를 지킨다 — 클라이언트가 모든
    // 응답을 JSON으로 가정하고 res.json()을 부르면 이 catch에서만 깨졌다.
    if (res.headersSent) {
      res.end();
    } else if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      // 🔒 클라이언트가 큰 요청을 보낸 것뿐 — 서버 장애가 아니라 알림 대상이 아니다.
      json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
    } else {
      json(res, 500, { error: 'INTERNAL_ERROR' });
      // 🔒 응답을 먼저 보낸 뒤 fire-and-forget — await하면 관리자 메일
      // 발송(SMTP 왕복)이 끝날 때까지 클라이언트가 500 응답조차 못 받는다.
      alertAdminOfError(err, req.url ?? 'unknown').catch(() => {});
    }
  }
}

// 🔒 handleRequest를 테스트가 import해서 자체 http 서버로 감쌀 수 있게 했더니
// (위 주석) 이 파일 자체를 import하는 것만으로 진짜 PORT에 listen이 걸려버렸다
// — `node src/server.ts`로 직접 실행됐을 때만 실제로 뜨도록 표준 ESM
// entry-point 가드를 둔다.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(handleRequest);

  // /ws는 attachWsServer가 가져간다. Next.js가 없으니 그 외 업그레이드 요청을
  // 받아줄 프레임워크도 없다 — onOtherPath를 안 넘기면 그냥 지나친다(ws-server.ts
  // 주석 참고. 예전 Next.js HMR 얽힘 문제는 이 프로세스에 Next.js가 없으므로
  // 원천적으로 해당 없음).
  attachWsServer(server);

  server.listen(PORT, () => {
    console.log(`ai-community-backend ${dev ? 'dev' : 'prod'} server on :${PORT} (http + ws)`);
  });
}
