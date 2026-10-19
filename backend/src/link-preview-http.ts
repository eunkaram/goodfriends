/**
 * 링크 미리보기 HTTP 라우트 — posts-http.ts와 같은 패턴.
 *
 * 🔒 로그인 필수로 걸었다 — 이 라우트는 사용자가 준 임의 URL로 우리 서버가
 * 대신 요청을 보내는 구조라(link-preview.ts의 SSRF 방어에도 불구하고),
 * 비로그인에게 완전히 열어두면 이 서버를 익명 요청 프록시로 쓸 수 있다.
 * 레이트리밋도 로그인 사용자 기준으로 건다(계정당 시간당 30회).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { json } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { checkRateLimit } from './rate-limit.ts';
import { fetchLinkPreview, fetchYoutubeEmbedSize, type LinkPreview } from './link-preview.ts';
import { redis } from './redis.ts';

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 하루 — 같은 링크를 여러 명이 붙여넣어도 매번 새로 크롤링하지 않는다

// 🔒 성능 점검 발견(2026-08-22, 정확성 버그) — base64url 인코딩한 URL을
// 200자로 자르면 앞 ~150바이트가 같고 뒤(쿼리스트링 등)만 다른 서로 다른
// URL이 같은 캐시 키로 충돌했다 — 트래킹 파라미터가 긴 쇼핑몰 링크 등에서
// 실제로 발생 가능. 전체 URL을 고정 길이 해시로 바꿔 길이와 무관하게
// 충돌 없이 유일한 키를 만든다.
function cacheKey(url: string): string {
  return `link_preview:${createHash('sha256').update(url).digest('base64url')}`;
}

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export async function handleLinkPreviewRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'GET' && url.pathname === '/api/link-preview') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }

    const target = url.searchParams.get('url');
    if (!target) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }

    if (!(await checkRateLimit(`link-preview:${userId}`, 30, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }

    const key = cacheKey(target);
    const cached = await redis().get(key);
    if (cached !== null) {
      // 빈 문자열은 "이전에 조회했지만 미리보기 없음"의 캐시 — 매번 재크롤링 안 하려고 null도 캐싱한다
      json(res, 200, { preview: cached === '' ? null : (JSON.parse(cached) as LinkPreview) });
      return true;
    }

    const preview = await fetchLinkPreview(target);
    await redis().set(key, preview ? JSON.stringify(preview) : '', 'EX', CACHE_TTL_SECONDS);
    json(res, 200, { preview });
    return true;
  }

  // 🔒 사용자 지시(2026-08, "가로/세로 규격을 찾아서 자동으로 임베드") —
  // link-preview.ts의 fetchYoutubeEmbedSize를 그대로 노출. 위 라우트와
  // 같은 인증·레이트리밋·캐싱 패턴(videoId는 사용자 입력이지만 호출 대상
  // 호스트는 항상 youtube.com 고정이라 SSRF 방어 대상이 아니다).
  if (req.method === 'GET' && url.pathname === '/api/youtube-size') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }

    const videoId = url.searchParams.get('videoId') ?? '';
    if (!YOUTUBE_ID_RE.test(videoId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }

    if (!(await checkRateLimit(`youtube-size:${userId}`, 30, 3600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }

    const key = `youtube_size:${videoId}`;
    const cached = await redis().get(key);
    if (cached !== null) {
      json(res, 200, { size: cached === '' ? null : JSON.parse(cached) });
      return true;
    }

    const size = await fetchYoutubeEmbedSize(videoId);
    await redis().set(key, size ? JSON.stringify(size) : '', 'EX', CACHE_TTL_SECONDS);
    json(res, 200, { size });
    return true;
  }

  return false;
}
