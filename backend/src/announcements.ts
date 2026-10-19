/**
 * 시스템 공지사항 — 이슈 #10. 관리자가 작성하면 모든 유저의 메시지창
 * (`/messages`)에 노출된다. `announcements`엔 RLS가 없다(0048 — users처럼
 * 사용자별 분기가 없는 전체공개 성격, 쓰기는 앱 레이어 requireModerator()로만
 * 막는다). moderation.ts의 트랜잭션+감사로그 패턴(setModeratorStatus 등)을
 * 그대로 따른다.
 */
import { appPool, withRelationCtx } from './db.ts';

const pool = appPool('exists');

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 2000;

export type Announcement = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementActionResult = { ok: true; id: string } | { ok: false; error: 'INVALID_INPUT' };
export type AnnouncementToggleResult = { ok: true } | { ok: false; error: 'NOT_FOUND' };

function toAnnouncement(row: {
  id: string;
  title: string;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createAnnouncement(moderatorId: string, title: string, body: string): Promise<AnnouncementActionResult> {
  const t = title.trim();
  const b = body.trim();
  if (!t || t.length > MAX_TITLE_LENGTH || !b || b.length > MAX_BODY_LENGTH) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const id = await withRelationCtx(pool, { userId: moderatorId }, async (client) => {
    const row = await client.query<{ id: string }>(
      `INSERT INTO announcements (title, body, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [t, b, moderatorId],
    );
    const announcementId = row.rows[0].id;
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, 'announcement_create', $2)`, [
      moderatorId,
      announcementId,
    ]);
    return announcementId;
  });
  return { ok: true, id };
}

/** 관리자 화면용 — 활성/비활성 다 포함, 최신순. */
export async function listAnnouncementsForAdmin(limit: number, offset: number): Promise<Announcement[]> {
  const r = await pool.query<{
    id: string;
    title: string;
    body: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(`SELECT id, title, body, is_active, created_at, updated_at FROM announcements ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [
    limit,
    offset,
  ]);
  return r.rows.map(toAnnouncement);
}

/** 유저용 — `is_active = true`인 것만, `/messages` 페이지가 호출. */
export async function fetchActiveAnnouncements(): Promise<Announcement[]> {
  const r = await pool.query<{
    id: string;
    title: string;
    body: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(`SELECT id, title, body, is_active, created_at, updated_at FROM announcements WHERE is_active = true ORDER BY created_at DESC`);
  return r.rows.map(toAnnouncement);
}

export async function setAnnouncementActive(moderatorId: string, id: string, isActive: boolean): Promise<AnnouncementToggleResult> {
  const updated = await withRelationCtx(pool, { userId: moderatorId }, async (client) => {
    const res = await client.query(`UPDATE announcements SET is_active = $1, updated_at = now() WHERE id = $2`, [isActive, id]);
    if ((res.rowCount ?? 0) === 0) return false;
    await client.query(
      `INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, $2, $3)`,
      [moderatorId, isActive ? 'announcement_activate' : 'announcement_deactivate', id],
    );
    return true;
  });
  return updated ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}
