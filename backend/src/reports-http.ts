/**
 * 신고하기 HTTP 라우트 — posts-http.ts와 같은 패턴.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { createReport, listReports, type ReportTargetType } from './reports.ts';
import { isActiveModerator } from './moderation.ts';

export async function handleReportsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  // 🔒 CEO 리뷰 cherry-pick(2026-08) — 읽기 전용 신고 목록. admin-http.ts와
  // 같은 존재-은폐 원칙: 비모더레이터는 다른 API 404들과 같은 JSON 모양.
  if (req.method === 'GET' && url.pathname === '/api/reports') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId || !(await isActiveModerator(userId))) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
    const rows = await listReports(userId, limit, offset);
    json(res, 200, { reports: rows });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/reports') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }

    const { targetType, targetId, reason } = JSON.parse(await readBody(req)) as {
      targetType?: ReportTargetType;
      targetId?: string;
      reason?: string;
    };
    // 불변식 19 — client-supplied id는 라우트 경계에서 먼저 걸러낸다.
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    if (targetType !== 'post' && targetType !== 'comment') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }

    const result = await createReport(userId, targetType, targetId, reason);
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'RATE_LIMITED' ? 429 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 201, { ok: true });
    return true;
  }

  return false;
}
