/**
 * `/api/admin/*` HTTP 라우트 — posts-http.ts와 같은 패턴(raw regex 매칭,
 * 프레임워크 없음). 모든 라우트가 `requireModerator()`를 제일 먼저 거친다 —
 * 비인가는 상태 코드만이 아니라 이 앱의 다른 API 404들과 같은 JSON 모양
 * (`{error:'NOT_FOUND'}`)으로 응답해서, "이 라우트가 막혀있다"와 "이런
 * 라우트 자체가 없다"를 구분할 수 없게 한다 — 존재 자체를 숨긴다는
 * `/admin` 페이지 쪽 요구사항과 같은 원칙을 API 레이어에도 적용.
 *
 * `/admin` 페이지 자체(및 `/admin/audit`, `/admin/reports`)는 이 파일이 아니라
 * Next.js App Router 페이지(`app/admin/**`)가 `notFound()`로 직접 처리한다 —
 * 그래야 진짜 Next.js 404와 바이트 단위로 동일한 응답이 보장된다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import {
  isActiveModerator,
  banUser,
  unbanUser,
  searchUsers,
  countUsersByRole,
  listAuditLog,
  getAdminUserDetail,
  setModeratorStatus,
  setAgentStatus,
  updateNickname,
  resolveReport,
  deletePostAsModerator,
  changePostCategoryAsModerator,
  deleteCommentAsModerator,
} from './moderation.ts';
import { searchPublicPosts } from './posts.ts';
import { searchPublicComments } from './comments.ts';
import { createAnnouncement, listAnnouncementsForAdmin, setAnnouncementActive } from './announcements.ts';

/** 🔒 M3 — admin-digest-http.ts가 같은 게이트를 쓴다(모든 /api/admin/*가
 * "존재 자체를 숨긴다"는 동일한 404 모양을 지키도록 한 곳에서만 정의). */
export async function requireModerator(req: IncomingMessage): Promise<string | null> {
  const token = resolveSessionToken(req);
  const userId = await getSessionUserId(token);
  if (!(await isActiveModerator(userId))) return null;
  return userId;
}

export async function handleAdminRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  if (!url.pathname.startsWith('/api/admin/')) return false;

  const moderatorId = await requireModerator(req);
  if (!moderatorId) {
    json(res, 404, { error: 'NOT_FOUND' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    const q = url.searchParams.get('q') ?? '';
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
    // 이슈(2026-09-06, 유저 탭 — 모더레이터/에이전트/일반) — roleFilterSql이
    // 화이트리스트 외 값은 전부 "필터 없음"으로 처리하므로 여기서 따로
    // 검증할 필요는 없다(moderation.ts 참고).
    const roleParam = url.searchParams.get('role');
    const role = roleParam === 'moderator' || roleParam === 'agent' || roleParam === 'general' ? roleParam : undefined;
    const [rows, counts] = await Promise.all([searchUsers(q, limit, offset, role), countUsersByRole()]);
    json(res, 200, { users: rows, counts });
    return true;
  }

  const detailMatch = req.method === 'GET' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (detailMatch) {
    const targetId = detailMatch[1];
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const detail = await getAdminUserDetail(targetId);
    if (!detail) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    json(res, 200, { user: detail });
    return true;
  }

  const nicknameMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/nickname$/);
  if (nicknameMatch) {
    const targetId = nicknameMatch[1];
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { nickname } = JSON.parse(await readBody(req)) as { nickname?: string };
    const result = await updateNickname(moderatorId, targetId, nickname ?? '');
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const moderatorMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/moderator$/);
  if (moderatorMatch) {
    const targetId = moderatorMatch[1];
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { isModerator } = JSON.parse(await readBody(req)) as { isModerator?: boolean };
    if (typeof isModerator !== 'boolean') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await setModeratorStatus(moderatorId, targetId, isModerator);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : result.error === 'SELF_LOCKOUT' ? 400 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const agentMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/agent$/);
  if (agentMatch) {
    const targetId = agentMatch[1];
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { isAgent } = JSON.parse(await readBody(req)) as { isAgent?: boolean };
    if (typeof isAgent !== 'boolean') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await setAgentStatus(moderatorId, targetId, isAgent);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const banMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/ban$/);
  if (banMatch) {
    const targetId = banMatch[1];
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { reason } = JSON.parse(await readBody(req)) as { reason?: string };
    const result = await banUser(moderatorId, targetId, reason ?? '');
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'SELF_LOCKOUT' ? 400 : result.error === 'ALREADY_BANNED' ? 409 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const unbanMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/unban$/);
  if (unbanMatch) {
    const targetId = unbanMatch[1];
    if (!isUuid(targetId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await unbanUser(moderatorId, targetId);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/posts') {
    const q = url.searchParams.get('q') ?? '';
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
    // 🔒 사용자 지시(2026-09-08, 유저 상세에서 작성 글 트래킹) — authorId가
    // 있으면서 uuid가 아니면 조용히 무시(전체 검색으로 폴백)하지 않고
    // 400을 준다 — 잘못된 id로 "이 유저는 글이 없다"고 오해하면 안 된다.
    const authorId = url.searchParams.get('authorId');
    if (authorId && !isUuid(authorId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const rows = await searchPublicPosts(moderatorId, q, limit, offset, authorId ?? undefined);
    json(res, 200, { posts: rows });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/comments') {
    const q = url.searchParams.get('q') ?? '';
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
    const authorId = url.searchParams.get('authorId');
    if (authorId && !isUuid(authorId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const rows = await searchPublicComments(moderatorId, q, limit, offset, authorId ?? undefined);
    json(res, 200, { comments: rows });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
    const rows = await listAuditLog(moderatorId, limit, offset);
    json(res, 200, { entries: rows });
    return true;
  }

  const resolveMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/resolve$/);
  if (resolveMatch) {
    const reportId = resolveMatch[1];
    if (!isUuid(reportId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await resolveReport(moderatorId, reportId);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const deletePostMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/delete$/);
  if (deletePostMatch) {
    const postId = deletePostMatch[1];
    if (!isUuid(postId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await deletePostAsModerator(moderatorId, postId);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const categoryMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/category$/);
  if (categoryMatch) {
    const postId = categoryMatch[1];
    if (!isUuid(postId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { categoryId } = JSON.parse(await readBody(req)) as { categoryId?: string };
    if (!categoryId || !isUuid(categoryId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await changePostCategoryAsModerator(moderatorId, postId, categoryId);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  const deleteCommentMatch = req.method === 'POST' && url.pathname.match(/^\/api\/admin\/comments\/([^/]+)\/delete$/);
  if (deleteCommentMatch) {
    const commentId = deleteCommentMatch[1];
    if (!isUuid(commentId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await deleteCommentAsModerator(moderatorId, commentId);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/announcements') {
    const { title, body } = JSON.parse(await readBody(req)) as { title?: string; body?: string };
    const result = await createAnnouncement(moderatorId, title ?? '', body ?? '');
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 201, { id: result.id });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/announcements') {
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
    const announcements = await listAnnouncementsForAdmin(limit, offset);
    json(res, 200, { announcements });
    return true;
  }

  const toggleAnnouncementMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (toggleAnnouncementMatch) {
    const announcementId = toggleAnnouncementMatch[1];
    if (!isUuid(announcementId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const { isActive } = JSON.parse(await readBody(req)) as { isActive?: boolean };
    if (typeof isActive !== 'boolean') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await setAnnouncementActive(moderatorId, announcementId, isActive);
    if (!result.ok) {
      json(res, result.error === 'NOT_FOUND' ? 404 : 400, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 404, { error: 'NOT_FOUND' });
  return true;
}
