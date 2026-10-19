/**
 * 유저 밴/정지 — /office-hours+/plan-ceo-review+/plan-eng-review 3라운드
 * 리뷰에서 확정된 admin 관리 페이지의 핵심 안전장치. 0007이 "보기"(is_moderator/
 * reports/moderation_access_log)만 만들어뒀던 걸 0034가 "조치"(is_banned 등)로
 * 채웠다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { createSession, getSessionUserId } from '../../src/session.ts';
import { closeRedis } from '../../src/redis.ts';
import { isEmailVerified } from '../../src/auth.ts';
import {
  banUser,
  unbanUser,
  isActiveModerator,
  searchUsers,
  listUsers,
  getUserDetail,
  getAdminUserDetail,
  setModeratorStatus,
  setAgentStatus,
  updateNickname,
  listAuditLog,
  resolveReport,
  deletePostAsModerator,
  deleteCommentAsModerator,
} from '../../src/moderation.ts';
import { fetchPostDetail } from '../../src/post-detail.ts';

let owner: pg.Pool;
let moderatorId: string;
let targetId: string;
let category: string;

async function cleanup() {
  // moderation_access_log.report_id는 reports를 FK로 참조한다(CASCADE 없음) — reports보다 먼저 지운다.
  await owner.query(`DELETE FROM moderation_access_log WHERE moderator_id IN (SELECT id FROM users WHERE username LIKE 'modtest_%')`);
  await owner.query(`DELETE FROM reactions WHERE target_id IN (SELECT id FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'MODTEST::%'))`);
  await owner.query(`DELETE FROM reports WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'MODTEST::%') OR target_id IN (SELECT id FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'MODTEST::%'))`);
  await owner.query(`DELETE FROM reports WHERE reporter_id IN (SELECT id FROM users WHERE username LIKE 'modtest_%')`);
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'MODTEST::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'MODTEST::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'modtest_%'`);
}

/**
 * 🔒 자기밴 잠금 가드는 시스템 전체의 활성 모더레이터 수를 센다(의도된
 * 동작 — modtest_% 픽스처로 스코프를 좁히면 안 된다, 실제 락아웃 방지가
 * 목적이므로). 이 dev DB엔 실제 계정(@eunkaram 등)이 이미 모더레이터일 수
 * 있어 — "modtest_moderator 하나뿐"이라는 테스트 전제가 깨진다. 잠금 테스트
 * 동안만 다른 활성 모더레이터를 임시로 내렸다가 반드시 복구한다.
 */
async function withOnlySelfAsActiveModerator(id: string, fn: () => Promise<void>) {
  const others = await owner.query<{ id: string }>(`SELECT id FROM users WHERE is_moderator AND NOT is_banned AND id <> $1`, [id]);
  const otherIds = others.rows.map((r) => r.id);
  if (otherIds.length > 0) await owner.query(`UPDATE users SET is_moderator = false WHERE id = ANY($1::uuid[])`, [otherIds]);
  try {
    await fn();
  } finally {
    if (otherIds.length > 0) await owner.query(`UPDATE users SET is_moderator = true WHERE id = ANY($1::uuid[])`, [otherIds]);
  }
}

beforeAll(async () => {
  owner = ownerPool();
  await cleanup();
  category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;
});

beforeEach(async () => {
  await cleanup();
  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username, is_moderator) VALUES ('modtest_moderator', true), ('modtest_target', false) RETURNING id, username`,
  );
  moderatorId = u.rows.find((r) => r.username === 'modtest_moderator')!.id;
  targetId = u.rows.find((r) => r.username === 'modtest_target')!.id;
});

afterAll(async () => {
  await cleanup();
  await owner?.end();
  await closeRedis();
});

describe('banUser', () => {
  it('사유와 함께 밴하면 users.is_banned=true, moderation_access_log에 user_ban 1행', async () => {
    const result = await banUser(moderatorId, targetId, '스팸 유저');
    expect(result).toEqual({ ok: true });

    const row = await owner.query(`SELECT is_banned, banned_reason, banned_by FROM users WHERE id = $1`, [targetId]);
    expect(row.rows[0]).toMatchObject({ is_banned: true, banned_reason: '스팸 유저', banned_by: moderatorId });

    const log = await owner.query(`SELECT target_type, target_id FROM moderation_access_log WHERE moderator_id = $1`, [moderatorId]);
    expect(log.rows).toEqual([{ target_type: 'user_ban', target_id: targetId }]);
  });

  it('사유 없이는 INVALID_INPUT — 감사 기록에 "왜"가 안 남는 걸 막는다', async () => {
    const result = await banUser(moderatorId, targetId, '   ');
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('존재하지 않는 유저는 NOT_FOUND', async () => {
    const result = await banUser(moderatorId, '00000000-0000-0000-0000-000000000000', '이유');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('이미 밴된 유저는 ALREADY_BANNED', async () => {
    await banUser(moderatorId, targetId, '1차');
    const result = await banUser(moderatorId, targetId, '2차');
    expect(result).toEqual({ ok: false, error: 'ALREADY_BANNED' });
  });

  it('🔒 유일하게 활성 상태인 모더레이터는 밴할 수 없다(자기밴 잠금)', async () => {
    await withOnlySelfAsActiveModerator(moderatorId, async () => {
      // moderatorId 하나뿐 — 자기 자신을 밴하면 활성 모더레이터가 0명이 된다.
      const result = await banUser(moderatorId, moderatorId, '실수로 자기 자신');
      expect(result).toEqual({ ok: false, error: 'SELF_LOCKOUT' });

      const row = await owner.query(`SELECT is_banned FROM users WHERE id = $1`, [moderatorId]);
      expect(row.rows[0].is_banned).toBe(false); // 실제로 안 바뀌었어야 한다
    });
  });

  it('활성 모더레이터가 2명이면 한 명을 밴해도 SELF_LOCKOUT이 아니다', async () => {
    const second = await owner.query<{ id: string }>(`INSERT INTO users (username, is_moderator) VALUES ('modtest_mod2', true) RETURNING id`);
    const secondId = second.rows[0].id;

    const result = await banUser(moderatorId, secondId, '테스트');
    expect(result).toEqual({ ok: true });
  });

  it('🔒 밴 처리 즉시 대상의 기존 세션이 끊긴다(destroyAllSessionsForUser 재사용)', async () => {
    const { token } = await createSession(targetId);
    expect(await getSessionUserId(token)).toBe(targetId); // 세션이 살아있음을 먼저 확인

    await banUser(moderatorId, targetId, '즉시 킬스위치 확인');

    expect(await getSessionUserId(token)).toBeNull(); // 밴 직후 세션이 사라졌다
  });
});

describe('unbanUser', () => {
  it('밴된 유저를 해제하면 is_banned=false, user_unban 로그 1행', async () => {
    await banUser(moderatorId, targetId, '테스트용 밴');
    const result = await unbanUser(moderatorId, targetId);
    expect(result).toEqual({ ok: true });

    const row = await owner.query(`SELECT is_banned, unbanned_by FROM users WHERE id = $1`, [targetId]);
    expect(row.rows[0]).toMatchObject({ is_banned: false, unbanned_by: moderatorId });

    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'user_unban'`, [
      moderatorId,
    ]);
    expect(log.rowCount).toBe(1);
  });

  it('밴 상태가 아닌 유저를 해제하면 멱등하게 ok:true(no-op)', async () => {
    const result = await unbanUser(moderatorId, targetId);
    expect(result).toEqual({ ok: true });
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1`, [moderatorId]);
    expect(log.rowCount).toBe(0); // 실제로 아무 것도 안 기록됐다
  });

  it('존재하지 않는 유저는 NOT_FOUND', async () => {
    const result = await unbanUser(moderatorId, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('isActiveModerator — /admin 게이트가 쓰는 체크', () => {
  it('모더레이터면 true', async () => {
    expect(await isActiveModerator(moderatorId)).toBe(true);
  });

  it('모더레이터가 아니면 false', async () => {
    expect(await isActiveModerator(targetId)).toBe(false);
  });

  it('세션 없음(null)이면 false', async () => {
    expect(await isActiveModerator(null)).toBe(false);
  });

  it('🔒 밴된 모더레이터는 false — 밴된 채로 /admin에 계속 들어오는 걸 막는다', async () => {
    await banUser(moderatorId, moderatorId === targetId ? targetId : targetId, '무관'); // targetId를 밴(모더레이터 아님, 잠금 안 걸림)
    // moderatorId 본인을 밴해야 하는 케이스는 자기밴 잠금에 걸리므로, 두 번째 모더레이터로 검증한다.
    const second = await owner.query<{ id: string }>(`INSERT INTO users (username, is_moderator) VALUES ('modtest_mod2', true) RETURNING id`);
    await banUser(moderatorId, second.rows[0].id, '밴된 모더레이터 시나리오');
    expect(await isActiveModerator(second.rows[0].id)).toBe(false);
  });
});

describe('searchUsers', () => {
  it('username prefix로 검색된다', async () => {
    const rows = await searchUsers('modtest_target', 20, 0);
    expect(rows.map((r) => r.username)).toContain('modtest_target');
  });

  it('🔒 빈 검색어는 전체 목록(listUsers와 동일) — "리스트가 없다"는 문제를 막는다', async () => {
    const searched = await searchUsers('', 20, 0);
    const listed = await listUsers(20, 0);
    expect(searched.map((r) => r.id).sort()).toEqual(listed.map((r) => r.id).sort());
    expect(searched.map((r) => r.username)).toEqual(expect.arrayContaining(['modtest_moderator', 'modtest_target']));
  });
});

describe('listUsers', () => {
  it('가입 최신순으로 페이지네이션된다', async () => {
    const page1 = await listUsers(1, 0);
    expect(page1).toHaveLength(1);
    const page2 = await listUsers(1, 1);
    expect(page2).toHaveLength(1);
    expect(page1[0].id).not.toBe(page2[0].id);
  });
});

describe('getUserDetail', () => {
  it('가입일·모더레이터·밴 여부를 포함한 상세 정보를 반환한다', async () => {
    const detail = await getUserDetail(targetId);
    expect(detail).toMatchObject({ id: targetId, username: 'modtest_target', isModerator: false, isBanned: false, bannedReason: null });
    expect(detail?.createdAt).toBeTruthy();
  });

  it('밴 정보(사유·시행자)가 채워진다', async () => {
    await banUser(moderatorId, targetId, '상세페이지 확인용');
    const detail = await getUserDetail(targetId);
    expect(detail).toMatchObject({ isBanned: true, bannedReason: '상세페이지 확인용', bannedByUsername: 'modtest_moderator' });
  });

  it('존재하지 않는 유저는 null', async () => {
    expect(await getUserDetail('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('아바타·생년월일·국가·우편번호를 포함한다', async () => {
    await owner.query(`UPDATE users SET avatar_url = '/a.png', birthdate = '1990-01-01', country = 'KR', postal_code = '12345' WHERE id = $1`, [
      targetId,
    ]);
    const detail = await getUserDetail(targetId);
    expect(detail).toMatchObject({ avatarUrl: '/a.png', country: 'KR', postalCode: '12345' });
    expect(detail?.birthdate).toBeTruthy();
  });
});

describe('getAdminUserDetail', () => {
  it('🔒 users 상세 정보에 email/emailVerified가 합쳐진다(auth_credentials는 다른 pool 소관)', async () => {
    await owner.query(`INSERT INTO auth_credentials (user_id, email, email_verified_at) VALUES ($1, 'modtest_target@example.com', now())`, [
      targetId,
    ]);
    const detail = await getAdminUserDetail(targetId);
    expect(detail).toMatchObject({ id: targetId, email: 'modtest_target@example.com', emailVerified: true });
  });

  it('소셜 전용 계정(auth_credentials 없음)은 email:null', async () => {
    const detail = await getAdminUserDetail(targetId);
    expect(detail).toMatchObject({ email: null });
  });

  it('존재하지 않는 유저는 null', async () => {
    expect(await getAdminUserDetail('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('setModeratorStatus', () => {
  it('권한을 부여하면 is_moderator=true, moderator_grant 로그 1행', async () => {
    const result = await setModeratorStatus(moderatorId, targetId, true);
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT is_moderator FROM users WHERE id = $1`, [targetId]);
    expect(row.rows[0].is_moderator).toBe(true);
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'moderator_grant'`, [
      moderatorId,
    ]);
    expect(log.rowCount).toBe(1);
  });

  it('이미 원하는 상태면 멱등하게 ok:true(로그 안 남음)', async () => {
    const result = await setModeratorStatus(moderatorId, targetId, false); // targetId는 이미 is_moderator=false
    expect(result).toEqual({ ok: true });
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1`, [moderatorId]);
    expect(log.rowCount).toBe(0);
  });

  it('🔒 유일한 활성 모더레이터의 권한은 회수할 수 없다(밴과 같은 자기밴 잠금)', async () => {
    await withOnlySelfAsActiveModerator(moderatorId, async () => {
      const result = await setModeratorStatus(moderatorId, moderatorId, false);
      expect(result).toEqual({ ok: false, error: 'SELF_LOCKOUT' });
      const row = await owner.query(`SELECT is_moderator FROM users WHERE id = $1`, [moderatorId]);
      expect(row.rows[0].is_moderator).toBe(true); // 실제로 안 바뀌었어야 한다
    });
  });

  it('모더레이터가 2명이면 한 명의 권한을 회수해도 SELF_LOCKOUT이 아니다', async () => {
    const second = await owner.query<{ id: string }>(`INSERT INTO users (username, is_moderator) VALUES ('modtest_mod2', true) RETURNING id`);
    const result = await setModeratorStatus(moderatorId, second.rows[0].id, false);
    expect(result).toEqual({ ok: true });
  });

  it('존재하지 않는 유저는 NOT_FOUND', async () => {
    const result = await setModeratorStatus(moderatorId, '00000000-0000-0000-0000-000000000000', true);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('setAgentStatus', () => {
  it('지정하면 is_agent=true, agent_grant 로그 1행', async () => {
    const result = await setAgentStatus(moderatorId, targetId, true);
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT is_agent FROM users WHERE id = $1`, [targetId]);
    expect(row.rows[0].is_agent).toBe(true);
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'agent_grant'`, [
      moderatorId,
    ]);
    expect(log.rowCount).toBe(1);
  });

  it('이미 원하는 상태면 멱등하게 ok:true(로그 안 남음)', async () => {
    const result = await setAgentStatus(moderatorId, targetId, false); // targetId는 이미 is_agent=false
    expect(result).toEqual({ ok: true });
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1`, [moderatorId]);
    expect(log.rowCount).toBe(0);
  });

  it('존재하지 않는 유저는 NOT_FOUND', async () => {
    const result = await setAgentStatus(moderatorId, '00000000-0000-0000-0000-000000000000', true);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('🔒 에이전트로 지정하면 이메일 미인증이어도 isEmailVerified가 true(auth.ts 우회 로직)', async () => {
    await owner.query(`INSERT INTO auth_credentials (user_id, email, email_verified_at) VALUES ($1, 'modtest_target@example.com', NULL)`, [
      targetId,
    ]);
    expect(await isEmailVerified(targetId)).toBe(false); // 지정 전엔 정상적으로 막힌다

    await setAgentStatus(moderatorId, targetId, true);
    expect(await isEmailVerified(targetId)).toBe(true);
  });
});

describe('updateNickname', () => {
  it('닉네임을 바꾸고 nickname_edit 로그 1행 남긴다', async () => {
    const result = await updateNickname(moderatorId, targetId, '새닉네임');
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT nickname FROM users WHERE id = $1`, [targetId]);
    expect(row.rows[0].nickname).toBe('새닉네임');
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'nickname_edit'`, [
      moderatorId,
    ]);
    expect(log.rowCount).toBe(1);
  });

  it('빈 닉네임은 INVALID_INPUT', async () => {
    const result = await updateNickname(moderatorId, targetId, '   ');
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('30자를 넘으면 INVALID_INPUT(프로필 편집과 같은 상한)', async () => {
    const result = await updateNickname(moderatorId, targetId, 'a'.repeat(31));
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('존재하지 않는 유저는 NOT_FOUND', async () => {
    const result = await updateNickname(moderatorId, '00000000-0000-0000-0000-000000000000', '이름');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('listAuditLog', () => {
  it('🔒 밴/해제 액션의 target_username은 붙고, 다른 target_type은 안 붙는다(eng-review outside voice 발견)', async () => {
    await banUser(moderatorId, targetId, '조인 확인용');
    const entries = await listAuditLog(moderatorId, 50, 0);
    const banEntry = entries.find((e) => e.targetId === targetId && e.targetType === 'user_ban');
    expect(banEntry?.targetUsername).toBe('modtest_target');
    expect(banEntry?.moderatorUsername).toBe('modtest_moderator');
  });

  it('모더레이터 권한 부여·닉네임 수정도 target_username이 붙는다(유저 대상 액션 확장)', async () => {
    await setModeratorStatus(moderatorId, targetId, true);
    await updateNickname(moderatorId, targetId, '감사로그확인용');
    const entries = await listAuditLog(moderatorId, 50, 0);
    expect(entries.find((e) => e.targetType === 'moderator_grant')?.targetUsername).toBe('modtest_target');
    expect(entries.find((e) => e.targetType === 'nickname_edit')?.targetUsername).toBe('modtest_target');
  });

  // 🔒 사용자 지시(2026-08-19, "감사로그는 어떤 게시물을 어떻게 처리 했는지 정보가 나와줘야") — 아래 3개.
  it('post_delete는 글 제목·본문 일부·원문 링크 정보를 담는다(라이브 조인, 소프트삭제라 행이 남아있다)', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'MODTEST::감사로그글', 'MODTEST::감사로그본문', 'public') RETURNING id`,
      [targetId, category],
    );
    await deletePostAsModerator(moderatorId, p.rows[0].id);
    const entries = await listAuditLog(moderatorId, 50, 0);
    const entry = entries.find((e) => e.targetType === 'post_delete' && e.targetId === p.rows[0].id);
    expect(entry).toMatchObject({
      contentTitle: 'MODTEST::감사로그글',
      contentExcerpt: 'MODTEST::감사로그본문',
      linkPostId: p.rows[0].id,
      linkIsComment: false,
    });
    expect(entry?.linkCategorySlug).toBeTruthy();
  });

  it('comment_delete는 스냅샷 본문·부모 글 링크 정보를 담는다(하드삭제라 스냅샷 없인 복원 불가)', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::감사로그댓글용글', 'public') RETURNING id`,
      [targetId, category],
    );
    const c = await owner.query<{ id: string }>(
      `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'MODTEST::감사로그댓글') RETURNING id`,
      [p.rows[0].id, targetId],
    );
    await deleteCommentAsModerator(moderatorId, c.rows[0].id);
    const entries = await listAuditLog(moderatorId, 50, 0);
    const entry = entries.find((e) => e.targetType === 'comment_delete' && e.targetId === c.rows[0].id);
    expect(entry).toMatchObject({
      contentExcerpt: 'MODTEST::감사로그댓글',
      linkPostId: p.rows[0].id,
      linkIsComment: true,
    });
  });

  it('report_resolve는 신고 대상 글의 제목·링크 정보를 담는다(reports/posts 둘 다 안 지워지는 테이블이라 라이브 조인)', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'MODTEST::감사로그신고글', 'MODTEST::감사로그신고본문', 'public') RETURNING id`,
      [targetId, category],
    );
    const r = await owner.query<{ id: string }>(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, 'post', $2, '감사로그 신고 테스트') RETURNING id`,
      [targetId, p.rows[0].id],
    );
    await resolveReport(moderatorId, r.rows[0].id);
    const entries = await listAuditLog(moderatorId, 50, 0);
    const entry = entries.find((e) => e.targetType === 'report_resolve' && e.targetId === r.rows[0].id);
    expect(entry).toMatchObject({
      contentTitle: 'MODTEST::감사로그신고글',
      contentExcerpt: 'MODTEST::감사로그신고본문',
      linkPostId: p.rows[0].id,
      linkIsComment: false,
    });
  });
});

describe('resolveReport', () => {
  async function makeReport(): Promise<string> {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::신고대상', 'public') RETURNING id`,
      [targetId, category],
    );
    const r = await owner.query<{ id: string }>(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, 'post', $2, '테스트 신고') RETURNING id`,
      [targetId, p.rows[0].id],
    );
    return r.rows[0].id;
  }

  it('처리하면 status=resolved, handled_by, report_resolve 로그 1행', async () => {
    const reportId = await makeReport();
    const result = await resolveReport(moderatorId, reportId);
    expect(result).toEqual({ ok: true });

    const row = await owner.query(`SELECT status, handled_by FROM reports WHERE id = $1`, [reportId]);
    expect(row.rows[0]).toMatchObject({ status: 'resolved', handled_by: moderatorId });

    const log = await owner.query(`SELECT target_id, report_id FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'report_resolve'`, [
      moderatorId,
    ]);
    expect(log.rows).toEqual([{ target_id: reportId, report_id: reportId }]);
  });

  it('이미 처리된 신고를 다시 처리해도 멱등하게 ok:true(로그는 안 남음)', async () => {
    const reportId = await makeReport();
    await resolveReport(moderatorId, reportId);
    const result = await resolveReport(moderatorId, reportId);
    expect(result).toEqual({ ok: true });
    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'report_resolve'`, [moderatorId]);
    expect(log.rowCount).toBe(1); // 두 번째 호출에서 추가로 안 쌓였다
  });

  it('존재하지 않는 신고는 NOT_FOUND', async () => {
    const result = await resolveReport(moderatorId, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('deletePostAsModerator', () => {
  /**
   * 🔒 실측으로 발견 — 이 함수는 "열린 신고가 있는 글" 또는(0036 이후)
   * "전체공개 글"만 지울 수 있다(UPDATE 정책이 app_moderator_can_view() OR
   * (app_is_moderator() AND visibility='public')을 씀 — 파일 상단 주석 참고).
   * 픽스처는 신고를 같이 만든다 — 전체공개 글이라 신고 없이도 지워지지만,
   * "신고 경유 삭제" 자체를 검증하는 테스트들이 이 픽스처를 쓴다.
   */
  async function makePost(): Promise<string> {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::삭제대상글', 'public') RETURNING id`,
      [targetId, category],
    );
    await owner.query(`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, 'post', $2, '삭제 테스트용 신고')`, [
      targetId,
      p.rows[0].id,
    ]);
    return p.rows[0].id;
  }

  /** category_id 없이 log_id + 비공개 visibility — posts_community_is_public CHECK를 피해간다. */
  async function makePrivatePost(): Promise<string> {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, $1, 'MODTEST::비공개글', 'private') RETURNING id`,
      [targetId],
    );
    return p.rows[0].id;
  }

  it('🔒 소프트삭제 — deleted_at만 채우고 행은 남긴다(사용자 본인의 하드삭제와 다름), post_delete 로그 1행', async () => {
    const postId = await makePost();
    const result = await deletePostAsModerator(moderatorId, postId);
    expect(result).toEqual({ ok: true });

    const row = await owner.query(`SELECT deleted_at FROM posts WHERE id = $1`, [postId]);
    expect(row.rows[0].deleted_at).not.toBeNull(); // 행 자체는 남아있다 — 하드삭제였으면 이 SELECT가 0행이었을 것

    const log = await owner.query(`SELECT 1 FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'post_delete' AND target_id = $2`, [
      moderatorId,
      postId,
    ]);
    expect(log.rowCount).toBe(1);
  });

  it('🔒 전체공개 글은 신고 없이도 지울 수 있다(0036 — "유저 관리처럼 신고 여부와 무관하게 삭제" 요청)', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::신고없는공개글', 'public') RETURNING id`,
      [targetId, category],
    );
    const result = await deletePostAsModerator(moderatorId, p.rows[0].id);
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT deleted_at FROM posts WHERE id = $1`, [p.rows[0].id]);
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  // 🔒 실전 발견(2026-09-06, admin 실사용) — admin이 지운 전체공개 글이
  // 사이트에서 여전히 보인다고 보고했다. RLS(0036)의 "(app_is_moderator()
  // AND visibility='public')" SELECT 카브아웃엔 deleted_at 체크가 없는데,
  // 이건 버그가 아니라 의도다 — 그 체크를 빼려고 하면 UPDATE의 WITH CHECK가
  // 깨진다(불변식 22, 소프트삭제 직후 새 행이 SELECT 정책도 통과해야 함을
  // 실측으로 재확인함). 대신 사용자 지시대로 "모더레이터에게는 보이되
  // 삭제됨 표시"로 처리한다 — fetchPostDetail()이 deletedAt을 실어 보내고
  // 프론트가 배지로 그린다. 일반 유저는 RLS가 애초에 행 자체를 안 보여줘서
  // (0행) deletedAt 유무와 무관하게 null만 받는다.
  it('🔒 삭제한 전체공개 글은 모더레이터에게 deletedAt이 채워진 채로 계속 조회된다(화면에서 "삭제됨" 표시용)', async () => {
    const p = await owner.query<{ id: string; public_id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::모더레이터삭제표시', 'public') RETURNING id, public_id`,
      [targetId, category],
    );
    const result = await deletePostAsModerator(moderatorId, p.rows[0].id);
    expect(result).toEqual({ ok: true });

    const detail = await fetchPostDetail(moderatorId, p.rows[0].public_id);
    expect(detail?.deletedAt).not.toBeNull();

    // 일반 유저(비모더레이터)는 삭제된 글을 아예 못 본다 — RLS가 0행.
    const asRegularUser = await fetchPostDetail(targetId, p.rows[0].public_id);
    expect(asRegularUser).toBeNull();
  });

  it('🔒 비공개 글은 열린 신고가 없으면 못 지운다(NOT_FOUND) — 공개 글과 다르게 RLS가 신고를 여전히 요구한다', async () => {
    const postId = await makePrivatePost();
    const result = await deletePostAsModerator(moderatorId, postId);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    const row = await owner.query(`SELECT deleted_at FROM posts WHERE id = $1`, [postId]);
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it('비공개 글은 신고가 resolve되면 그 이후엔 못 지운다', async () => {
    const postId = await makePrivatePost();
    await owner.query(`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, 'post', $2, '비공개글 신고')`, [
      targetId,
      postId,
    ]);
    await owner.query(`UPDATE reports SET status = 'resolved' WHERE target_id = $1`, [postId]);
    const result = await deletePostAsModerator(moderatorId, postId);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('이미 삭제된 글은 NOT_FOUND', async () => {
    const postId = await makePost();
    await deletePostAsModerator(moderatorId, postId);
    const result = await deletePostAsModerator(moderatorId, postId);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('존재하지 않는 글은 NOT_FOUND', async () => {
    const result = await deletePostAsModerator(moderatorId, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('deleteCommentAsModerator', () => {
  it('🔒 하드삭제되고(comments엔 deleted_at이 없다) comment_delete 로그 1행 — 작성자 본인이 아니어도 지운다', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::댓글삭제용글', 'public') RETURNING id`,
      [targetId, category],
    );
    const c = await owner.query<{ id: string }>(
      `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'MODTEST::지워질댓글') RETURNING id`,
      [p.rows[0].id, targetId], // targetId가 작성자, moderatorId가 지운다 — 작성자 아님
    );
    const commentId = c.rows[0].id;
    await owner.query(`INSERT INTO reactions (user_id, target_type, target_id, emoticon_type) VALUES ($1, 'comment', $2, 'empathy')`, [
      moderatorId,
      commentId,
    ]);

    const result = await deleteCommentAsModerator(moderatorId, commentId);
    expect(result).toEqual({ ok: true });

    const row = await owner.query(`SELECT 1 FROM comments WHERE id = $1`, [commentId]);
    expect(row.rowCount).toBe(0); // 행 자체가 없어졌다 — 소프트삭제 아님

    const reaction = await owner.query(`SELECT 1 FROM reactions WHERE target_type = 'comment' AND target_id = $1`, [commentId]);
    expect(reaction.rowCount).toBe(0); // 다형성이라 FK가 없어 직접 지워야 한다

    const log = await owner.query<{ detail: string; target_post_id: string }>(
      `SELECT detail, target_post_id FROM moderation_access_log WHERE moderator_id = $1 AND target_type = 'comment_delete' AND target_id = $2`,
      [moderatorId, commentId],
    );
    expect(log.rowCount).toBe(1);
    // 🔒 사용자 지시(2026-08-19, "감사로그는 어떤 게시물을 어떻게 처리 했는지") —
    // 댓글은 하드삭제라 지운 뒤 복원 불가 — 지우기 직전 스냅샷(detail)과 부모 글 id를 남겨야 한다.
    expect(log.rows[0].detail).toBe('MODTEST::지워질댓글');
    expect(log.rows[0].target_post_id).toBe(p.rows[0].id);
  });

  it('🔒 1-depth 답글도 같이 지워진다(parent_comment_id ON DELETE CASCADE, 0021)', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'MODTEST::답글삭제용글', 'public') RETURNING id`,
      [targetId, category],
    );
    const parent = await owner.query<{ id: string }>(
      `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'MODTEST::부모댓글') RETURNING id`,
      [p.rows[0].id, targetId],
    );
    const reply = await owner.query<{ id: string }>(
      `INSERT INTO comments (target_type, target_id, author_id, body, parent_comment_id) VALUES ('post', $1, $2, 'MODTEST::답글', $3) RETURNING id`,
      [p.rows[0].id, targetId, parent.rows[0].id],
    );

    const result = await deleteCommentAsModerator(moderatorId, parent.rows[0].id);
    expect(result).toEqual({ ok: true });

    const row = await owner.query(`SELECT 1 FROM comments WHERE id = ANY($1::uuid[])`, [[parent.rows[0].id, reply.rows[0].id]]);
    expect(row.rowCount).toBe(0); // 부모 + 답글 둘 다 사라졌다
  });

  it('존재하지 않는 댓글은 NOT_FOUND', async () => {
    const result = await deleteCommentAsModerator(moderatorId, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
