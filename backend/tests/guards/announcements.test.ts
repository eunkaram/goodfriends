/**
 * 시스템 공지사항 — 이슈 #10. moderation.test.ts와 같은 픽스처 패턴
 * (modtest_% 유저), announcements 자체엔 RLS가 없어 owner 풀로 직접 확인한다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import {
  createAnnouncement,
  listAnnouncementsForAdmin,
  fetchActiveAnnouncements,
  setAnnouncementActive,
} from '../../src/announcements.ts';

let owner: pg.Pool;
let moderatorId: string;

async function cleanup() {
  await owner.query(`DELETE FROM moderation_access_log WHERE moderator_id IN (SELECT id FROM users WHERE username LIKE 'anntest_%')`);
  await owner.query(`DELETE FROM announcements WHERE title LIKE 'ANNTEST::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'anntest_%'`);
}

beforeAll(async () => {
  owner = ownerPool();
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  const u = await owner.query<{ id: string }>(`INSERT INTO users (username, is_moderator) VALUES ('anntest_moderator', true) RETURNING id`);
  moderatorId = u.rows[0].id;
});

afterAll(async () => {
  await cleanup();
  await owner?.end();
});

describe('createAnnouncement', () => {
  it('제목·본문이 있으면 생성되고 moderation_access_log에 announcement_create 1행', async () => {
    const result = await createAnnouncement(moderatorId, 'ANNTEST::제목', '본문 내용');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const row = await owner.query(`SELECT title, body, is_active, created_by FROM announcements WHERE id = $1`, [result.id]);
    expect(row.rows[0]).toMatchObject({ title: 'ANNTEST::제목', body: '본문 내용', is_active: true, created_by: moderatorId });

    const log = await owner.query(`SELECT target_type, target_id FROM moderation_access_log WHERE moderator_id = $1`, [moderatorId]);
    expect(log.rows).toEqual([{ target_type: 'announcement_create', target_id: result.id }]);
  });

  it('제목/본문이 비었으면 INVALID_INPUT — 행이 생기지 않는다', async () => {
    const result = await createAnnouncement(moderatorId, '   ', '본문');
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
    const count = await owner.query(`SELECT count(*) FROM announcements WHERE title LIKE 'ANNTEST::%'`);
    expect(Number(count.rows[0].count)).toBe(0);
  });
});

describe('listAnnouncementsForAdmin / fetchActiveAnnouncements', () => {
  it('관리자 목록은 비활성도 포함하지만, 유저용은 활성만 준다', async () => {
    const active = await createAnnouncement(moderatorId, 'ANNTEST::활성', '본문');
    const inactive = await createAnnouncement(moderatorId, 'ANNTEST::비활성', '본문');
    if (!active.ok || !inactive.ok) throw new Error('unreachable');
    await setAnnouncementActive(moderatorId, inactive.id, false);

    const adminList = await listAnnouncementsForAdmin(20, 0);
    const adminIds = adminList.map((a) => a.id);
    expect(adminIds).toContain(active.id);
    expect(adminIds).toContain(inactive.id);

    const userList = await fetchActiveAnnouncements();
    const userIds = userList.map((a) => a.id);
    expect(userIds).toContain(active.id);
    expect(userIds).not.toContain(inactive.id);
  });
});

describe('setAnnouncementActive', () => {
  it('토글하면 is_active·updated_at이 바뀌고 감사 로그가 남는다', async () => {
    const created = await createAnnouncement(moderatorId, 'ANNTEST::토글', '본문');
    if (!created.ok) throw new Error('unreachable');

    const off = await setAnnouncementActive(moderatorId, created.id, false);
    expect(off).toEqual({ ok: true });
    const rowOff = await owner.query(`SELECT is_active FROM announcements WHERE id = $1`, [created.id]);
    expect(rowOff.rows[0].is_active).toBe(false);

    const on = await setAnnouncementActive(moderatorId, created.id, true);
    expect(on).toEqual({ ok: true });
    const rowOn = await owner.query(`SELECT is_active FROM announcements WHERE id = $1`, [created.id]);
    expect(rowOn.rows[0].is_active).toBe(true);

    const log = await owner.query(
      `SELECT target_type FROM moderation_access_log WHERE moderator_id = $1 AND target_id = $2 ORDER BY accessed_at`,
      [moderatorId, created.id],
    );
    expect(log.rows.map((r) => r.target_type)).toEqual(['announcement_create', 'announcement_deactivate', 'announcement_activate']);
  });

  it('존재하지 않는 id는 NOT_FOUND', async () => {
    const result = await setAnnouncementActive(moderatorId, '00000000-0000-0000-0000-000000000000', true);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
