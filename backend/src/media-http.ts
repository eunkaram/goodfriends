/**
 * Media HTTP 라우트 — src/media.ts 주석 참고(2026-10 버그 수정, 업로드를
 * 부르는 프론트는 있었지만 받는 백엔드가 없었다).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBodyBuffer, json } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { checkRateLimit } from './rate-limit.ts';
import { saveUpload, readMediaFile, MAX_UPLOAD_BYTES } from './media.ts';

export async function handleMediaRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 프론트가 실제로 부르는 그대로: Content-Type 헤더에 mime, 바디에 raw 바이트
  // (multipart 아님) — ProfileEditModal.tsx·PostComposerModal.tsx·
  // CommentSection.tsx 세 곳 전부 이 계약으로 fetch한다.
  if (req.method === 'POST' && url.pathname === '/api/media/upload') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    // 🔒 username-available 등 다른 라우트와 같은 관례 — 로그인 사용자의
    // 과도한 업로드 시도를 막는다(스토리지 소모 방지).
    if (!(await checkRateLimit(`media-upload:${userId}`, 30, 600))) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }
    const mimeType = (req.headers['content-type'] ?? '').split(';')[0].trim();
    let buffer: Buffer;
    try {
      buffer = await readBodyBuffer(req, MAX_UPLOAD_BYTES);
    } catch {
      json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return true;
    }
    // 🔒 리버스 프록시(Cloudflare 등) 뒤에서도 맞는 origin을 돌려주려고
    // x-forwarded-proto를 우선한다(rate-limit.ts의 같은 관례).
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
    const origin = `${proto}://${req.headers.host}`;
    const result = await saveUpload(userId, mimeType, buffer, origin);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, { url: result.url });
    return true;
  }

  // 🔒 업로드한 이미지를 보여주는 GET — media.ts readMediaFile()이 key
  // 형식을 화이트리스트로 검증하므로 경로 조작 걱정 없이 그대로 읽는다.
  // 인증 없이 공개 서빙(0020 migration 주석과 같은 전제).
  const mediaMatch = req.method === 'GET' && url.pathname.match(/^\/media\/([^/]+)$/);
  if (mediaMatch) {
    const file = await readMediaFile(mediaMatch[1]);
    if (!file) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Length': file.buffer.byteLength,
      // 🔒 파일명이 randomUUID라 내용이 절대 안 바뀐다 — 영구 캐시해도 안전하다.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(file.buffer);
    return true;
  }

  return false;
}
