/**
 * 유저 밴/정지 — §4.6 모더레이션의 "조치" 절반. `reports`/`moderation_access_log`/
 * `is_moderator`(0007)는 "보기" 절반만 만들어뒀었다 — /office-hours+
 * /plan-ceo-review+/plan-eng-review 3라운드 리뷰에서 확인, 0034가 스키마를 채웠다.
 *
 * 🔒 밴 즉시성 — 세션은 Redis에 저장되는 stateful 토큰이다(JWT 아님,
 * session.ts). `destroyAllSessionsForUser()`(비밀번호 재설정에서 이미 쓰는
 * 함수)를 그대로 재사용해 기존 세션을 즉시 끊는다. Postgres(users UPDATE +
 * moderation_access_log INSERT)와 Redis(세션 파기)는 이종 스토어라 하나의
 * 트랜잭션으로 못 묶는다 — DB 커밋이 성공한 뒤에 Redis를 호출하고, 실패하면
 * 1회 재시도 후 ERROR 로그만 남기고 진행한다(밴 자체는 유효 — 남은 세션은
 * ws-server.ts의 60초 주기 재검증이 정리한다, WS 한정).
 *
 * 재로그인 우회는 이 파일이 아니라 auth.ts(signInWithEmail/findOrCreateOAuthUser)
 * 쪽 책임이다 — 이 파일은 밴 상태를 만들고 기존 세션을 끊을 뿐, 새 로그인
 * 시도를 막는 건 로그인 경로 자신이 `is_banned`를 확인해야 한다.
 */
import type pg from 'pg';
import { appPool, withRelationCtx } from './db.ts';
import { destroyAllSessionsForUser } from './session.ts';
import { getUserEmail, isEmailVerified } from './auth.ts';

const pool = appPool('exists');

/** users.nickname과 같은 상한(src/user-log.ts MAX_NICKNAME_LENGTH) — 프로필 편집과 다른 값을 쓸 이유가 없다. */
const MAX_NICKNAME_LENGTH = 30;

/** 밴/모더레이터 권한 회수 둘 다 "유일한 활성 모더레이터를 무력화하면 안 된다"는 같은 규칙을 쓴다 — 여기 한 곳에서만 잠근다. */
const USER_TARGET_TYPES = [
  'user_ban',
  'user_unban',
  'moderator_grant',
  'moderator_revoke',
  'agent_grant',
  'agent_revoke',
  'nickname_edit',
] as const;

/**
 * `/admin`(과 `/api/admin/*`)의 접근 게이트가 쓰는 체크 — `app_is_moderator()`
 * (RLS 정책 안에서만 쓰는 SQL 함수, messages RLS 0008)와는 별개로, 앱 레이어
 * 라우트 경계에서 직접 쓰는 단순 SELECT다. 밴된 모더레이터도 거부한다.
 */
export async function isActiveModerator(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const r = await pool.query<{ is_moderator: boolean; is_banned: boolean }>(`SELECT is_moderator, is_banned FROM users WHERE id = $1`, [
    userId,
  ]);
  const row = r.rows[0];
  return row !== undefined && row.is_moderator && !row.is_banned;
}

export type ModerationActionResult =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'INVALID_INPUT' | 'SELF_LOCKOUT' | 'ALREADY_BANNED' };

const MAX_REASON_LENGTH = 500;

/**
 * 🔒 자기밴 잠금 — eng-review outside voice가 찾은 TOCTOU 레이스 방지.
 * "활성 모더레이터 수를 세고 나서 UPDATE"가 아니라, 후보 행들을 먼저
 * `FOR UPDATE`로 잠근 뒤(카운트 자체엔 FOR UPDATE를 못 건다 — Postgres가
 * 집계함수와 FOR UPDATE 조합을 거부한다) 애플리케이션에서 행 수를 센다.
 * 지금은 모더레이터가 1명이라 실제로 발생 못 하지만, 모더레이터 2명이 동시에
 * 서로를 밴/권한회수하는 순간(팀이 생기면) 조용히 뚫릴 수 있어 지금 막아둔다.
 * banUser()와 setModeratorStatus(false)(권한 회수) 둘 다 이 잠금을 쓴다.
 */
async function wouldLockOutLastModerator(client: pg.PoolClient): Promise<boolean> {
  const activeModerators = await client.query(`SELECT id FROM users WHERE is_moderator AND NOT is_banned FOR UPDATE`);
  return activeModerators.rowCount !== null && activeModerators.rowCount <= 1;
}

export async function banUser(moderatorId: string, targetUserId: string, reason: string): Promise<ModerationActionResult> {
  const trimmedReason = reason?.trim();
  if (!trimmedReason || trimmedReason.length > MAX_REASON_LENGTH) return { ok: false, error: 'INVALID_INPUT' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query<{ id: string; is_banned: boolean; is_moderator: boolean }>(
      `SELECT id, is_banned, is_moderator FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId],
    );
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (target.rows[0].is_banned) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'ALREADY_BANNED' };
    }

    if (target.rows[0].is_moderator && (await wouldLockOutLastModerator(client))) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'SELF_LOCKOUT' };
    }

    await client.query(`UPDATE users SET is_banned = true, banned_at = now(), banned_by = $1, banned_reason = $2 WHERE id = $3`, [
      moderatorId,
      trimmedReason,
      targetUserId,
    ]);
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, 'user_ban', $2)`, [
      moderatorId,
      targetUserId,
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await killSessionsWithRetry(targetUserId);
  return { ok: true };
}

/** 밴/해제와 같은 이유로 권한 회수도 유일한 활성 모더레이터는 막는다 — 스스로 권한을 내려놓는 경우도 포함(target===moderator라도 동일 규칙). */
export async function setModeratorStatus(moderatorId: string, targetId: string, isModerator: boolean): Promise<ModerationActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query<{ id: string; is_moderator: boolean; is_banned: boolean }>(
      `SELECT id, is_moderator, is_banned FROM users WHERE id = $1 FOR UPDATE`,
      [targetId],
    );
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (target.rows[0].is_moderator === isModerator) {
      await client.query('ROLLBACK');
      return { ok: true }; // 이미 원하는 상태 — 멱등
    }

    if (!isModerator && !target.rows[0].is_banned && (await wouldLockOutLastModerator(client))) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'SELF_LOCKOUT' };
    }

    await client.query(`UPDATE users SET is_moderator = $1 WHERE id = $2`, [isModerator, targetId]);
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, $2, $3)`, [
      moderatorId,
      isModerator ? 'moderator_grant' : 'moderator_revoke',
      targetId,
    ]);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 에이전트(AI 봇) 지정/해제 — setModeratorStatus()와 같은 패턴이지만 자기잠금 규칙은 없다(에이전트 권한은 모더레이터 자격에 영향 없음). */
export async function setAgentStatus(moderatorId: string, targetId: string, isAgent: boolean): Promise<ModerationActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query<{ id: string; is_agent: boolean }>(`SELECT id, is_agent FROM users WHERE id = $1 FOR UPDATE`, [
      targetId,
    ]);
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (target.rows[0].is_agent === isAgent) {
      await client.query('ROLLBACK');
      return { ok: true }; // 이미 원하는 상태 — 멱등
    }

    await client.query(`UPDATE users SET is_agent = $1 WHERE id = $2`, [isAgent, targetId]);
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, $2, $3)`, [
      moderatorId,
      isAgent ? 'agent_grant' : 'agent_revoke',
      targetId,
    ]);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateNickname(moderatorId: string, targetId: string, nickname: string): Promise<ModerationActionResult> {
  const trimmed = nickname?.trim();
  if (!trimmed || trimmed.length > MAX_NICKNAME_LENGTH) return { ok: false, error: 'INVALID_INPUT' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [targetId]);
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }

    await client.query(`UPDATE users SET nickname = $1 WHERE id = $2`, [trimmed, targetId]);
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, 'nickname_edit', $2)`, [
      moderatorId,
      targetId,
    ]);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 이미 밴 상태가 아니면 아무 것도 안 하고 성공 처리한다(멱등). */
export async function unbanUser(moderatorId: string, targetUserId: string): Promise<ModerationActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query<{ id: string; is_banned: boolean }>(`SELECT id, is_banned FROM users WHERE id = $1 FOR UPDATE`, [
      targetUserId,
    ]);
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (!target.rows[0].is_banned) {
      await client.query('ROLLBACK');
      return { ok: true }; // 이미 밴 상태 아님 — 멱등
    }

    await client.query(`UPDATE users SET is_banned = false, unbanned_at = now(), unbanned_by = $1 WHERE id = $2`, [
      moderatorId,
      targetUserId,
    ]);
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, 'user_unban', $2)`, [
      moderatorId,
      targetUserId,
    ]);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function killSessionsWithRetry(userId: string): Promise<void> {
  try {
    await destroyAllSessionsForUser(userId);
  } catch (err) {
    console.error('destroyAllSessionsForUser failed after ban, retrying once:', err);
    try {
      await destroyAllSessionsForUser(userId);
    } catch (err2) {
      console.error('destroyAllSessionsForUser retry also failed — ban stands, session may persist until WS 60s recheck:', err2);
    }
  }
}

export type UserSearchRow = {
  id: string;
  username: string;
  nickname: string;
  isModerator: boolean;
  isAgent: boolean;
  isBanned: boolean;
};

function mapUserRow(row: {
  id: string;
  username: string;
  nickname: string;
  is_moderator: boolean;
  is_agent: boolean;
  is_banned: boolean;
}): UserSearchRow {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    isModerator: row.is_moderator,
    isAgent: row.is_agent,
    isBanned: row.is_banned,
  };
}

/**
 * 🔒 사용자 지시(2026-09-06, "유저에서 유저 리스트를 모더레이터, 에이전트,
 * 일반으로 나눠서... 탭 메뉴") — 값 자체는 고정 3개뿐이라 바인드 파라미터가
 * 아니라 SQL 텍스트로 직접 넣는다(인젝션 여지 없음, 화이트리스트 타입).
 */
export type UserRole = 'moderator' | 'agent' | 'general';

function roleFilterSql(role: UserRole | undefined): string {
  if (role === 'moderator') return 'is_moderator = true';
  if (role === 'agent') return 'is_agent = true';
  if (role === 'general') return 'is_moderator = false AND is_agent = false';
  return 'true';
}

export type UserRoleCounts = { all: number; moderator: number; agent: number; general: number };

/** 🔒 사용자 지시(2026-09-06, "각 탭 메뉴 오른쪽에 유저수로 같이 보여줘") — roleFilterSql과 같은 4분류, 검색어(q)와 무관한 전체 인원수. */
export async function countUsersByRole(): Promise<UserRoleCounts> {
  const r = await pool.query<{ total: string; moderator: string; agent: string; general: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_moderator) AS moderator,
       COUNT(*) FILTER (WHERE is_agent) AS agent,
       COUNT(*) FILTER (WHERE NOT is_moderator AND NOT is_agent) AS general
     FROM users`,
  );
  const row = r.rows[0];
  return { all: Number(row.total), moderator: Number(row.moderator), agent: Number(row.agent), general: Number(row.general) };
}

/** 검색어 없이 전체 유저 목록(가입 최신순) — /admin 유저 페이지의 기본 화면. */
export async function listUsers(limit: number, offset: number, role?: UserRole): Promise<UserSearchRow[]> {
  const r = await pool.query<{ id: string; username: string; nickname: string; is_moderator: boolean; is_agent: boolean; is_banned: boolean }>(
    `SELECT id, username, nickname, is_moderator, is_agent, is_banned FROM users WHERE ${roleFilterSql(role)} ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return r.rows.map(mapUserRow);
}

/** username prefix 매칭만 한다 — email은 auth_credentials 소관이라 community_app_auth 없이는 조인 불가(admin-http.ts 주석 참고). 빈 검색어는 listUsers()와 동일(전체 목록). */
export async function searchUsers(query: string, limit: number, offset: number, role?: UserRole): Promise<UserSearchRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return listUsers(limit, offset, role);
  const r = await pool.query<{ id: string; username: string; nickname: string; is_moderator: boolean; is_agent: boolean; is_banned: boolean }>(
    `SELECT id, username, nickname, is_moderator, is_agent, is_banned FROM users WHERE lower(username) LIKE lower($1) || '%' AND ${roleFilterSql(role)} ORDER BY username LIMIT $2 OFFSET $3`,
    [trimmed, limit, offset],
  );
  return r.rows.map(mapUserRow);
}

export type UserDetail = UserSearchRow & {
  createdAt: string;
  bannedAt: string | null;
  bannedReason: string | null;
  bannedByUsername: string | null;
  unbannedAt: string | null;
  /** 아래 넷은 users 테이블 소관(auth.ts와 달리 이 파일의 pool엔 이미 SELECT 권한이 있다). email/emailVerified는 auth_credentials 소관이라 여기 없다 — admin-http.ts가 auth.ts 호출로 채운다. */
  avatarUrl: string;
  birthdate: string | null;
  country: string | null;
  postalCode: string | null;
};

/** 사용자 지시(2026-08-25, "유저의 모든정보는 읽을수 있어야해") — /admin/users/[id] 상세 페이지용. 목록엔 없는 밴 이력·가입일·계정 핵심 정보(아바타·생년월일·국가/우편번호)를 포함한다. */
export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const r = await pool.query<{
    id: string;
    username: string;
    nickname: string;
    is_moderator: boolean;
    is_agent: boolean;
    is_banned: boolean;
    created_at: string;
    banned_at: string | null;
    banned_reason: string | null;
    banned_by_username: string | null;
    unbanned_at: string | null;
    avatar_url: string;
    birthdate: string | null;
    country: string | null;
    postal_code: string | null;
  }>(
    `SELECT u.id, u.username, u.nickname, u.is_moderator, u.is_agent, u.is_banned, u.created_at,
            u.banned_at, u.banned_reason, b.username AS banned_by_username, u.unbanned_at,
            u.avatar_url, u.birthdate, u.country, u.postal_code
     FROM users u
     LEFT JOIN users b ON b.id = u.banned_by
     WHERE u.id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...mapUserRow(row),
    createdAt: row.created_at,
    bannedAt: row.banned_at,
    bannedReason: row.banned_reason,
    bannedByUsername: row.banned_by_username,
    unbannedAt: row.unbanned_at,
    avatarUrl: row.avatar_url,
    birthdate: row.birthdate,
    country: row.country,
    postalCode: row.postal_code,
  };
}

export type UserDetailWithAuth = UserDetail & { email: string | null; emailVerified: boolean };

/**
 * getUserDetail() + email/인증여부. 이 파일의 pool(community_app_exists)엔
 * auth_credentials GRANT가 없다(§6.1 자격증명 격리) — auth.ts(community_app_auth)
 * 함수를 별도로 불러 합친다. /admin/users/[id] 페이지(SSR)와
 * GET /api/admin/users/:id(admin-http.ts) 둘 다 이 함수를 쓴다.
 */
export async function getAdminUserDetail(id: string): Promise<UserDetailWithAuth | null> {
  const detail = await getUserDetail(id);
  if (!detail) return null;
  const [email, emailVerified] = await Promise.all([getUserEmail(id), isEmailVerified(id)]);
  return { ...detail, email, emailVerified };
}

export type AuditLogRow = {
  id: string;
  moderatorUsername: string | null;
  targetType: string;
  targetId: string;
  targetUsername: string | null;
  accessedAt: string;
  /** post_delete: 글 제목. comment_delete: 삭제 당시 스냅샷(댓글 본문 일부, deleteCommentAsModerator가 남김). report_resolve: 신고 대상 글/댓글 제목·본문 일부. */
  contentTitle: string | null;
  contentExcerpt: string | null;
  /** 원문 링크에 쓸 글 id — post_delete는 자기 자신, comment_delete는 부모 글(target_post_id 스냅샷), report_resolve는 신고 대상이 속한 글. null이면 더 이상 못 찾음(글도 같이 지워졌거나 접근 불가). 내부 PK — API 호출에만 쓴다. */
  linkPostId: string | null;
  /** 공개 URL에 쓰는 짧은 불투명 ID(0038) — linkPostId와 같은 대상, URL 빌드용. */
  linkPostPublicId: string | null;
  linkCategorySlug: string | null;
  /** true면 댓글(부모 글 링크에 #comments를 붙여야 함), false/null이면 글 자체. */
  linkIsComment: boolean;
};

/**
 * 🔒 eng-review outside voice 발견 — target_id는 target_type에 따라 다른
 * 테이블을 가리킨다(reports: post|comment, 0008: thread|message, 이 파일:
 * USER_TARGET_TYPES). 유저를 직접 가리키는 target_type 행만 users로
 * 조인해 이름을 붙이고, 나머지는 target_type을 그대로 보여준다 — 무조건
 * 조인하면 유저가 아닌 target_id에서 이름이 조용히 빈다.
 *
 * 🔒 사용자 지시(2026-08-19, "감사로그는 어떤 게시물을 어떻게 처리 했는지
 * 정보가 나와줘야 할것 같고") — target_type만으로는 "무엇을" 처리했는지
 * 알 수 없었다. 세 가지 액션마다 다른 방식으로 채운다:
 *  - post_delete: 소프트삭제라 posts 행이 그대로 남아있다 — 라이브 조인으로
 *    충분(글은 삭제 후 수정 불가능해서 스냅샷과 라이브 조회가 항상 같다).
 *  - comment_delete: 하드삭제라 행 자체가 없다 — deleteCommentAsModerator()가
 *    지우기 직전에 남긴 스냅샷(`l.detail`)과 부모 글 id(`l.target_post_id`)를
 *    쓴다. 부모 글 자체가 그 뒤 또 지워졌으면 linkPostId도 null이 된다.
 *  - report_resolve: reports/posts/comments 전부 삭제되지 않는 테이블이라
 *    listReports()와 같은 조인으로 라이브 조회한다.
 * posts 조인은 RLS 대상(0002)이라 moderatorId로 app.user_id를 SET LOCAL
 * 해야 0036의 `app_is_moderator() AND visibility='public'` 카브아웃이 통한다
 * — listReports()가 이미 쓰는 것과 같은 이유로 withRelationCtx로 감쌌다.
 */
export async function listAuditLog(moderatorId: string, limit: number, offset: number): Promise<AuditLogRow[]> {
  const r = await withRelationCtx(pool, { userId: moderatorId }, (client) =>
    client.query<{
      id: string;
      moderator_username: string | null;
      target_type: string;
      target_id: string;
      target_username: string | null;
      accessed_at: string;
      content_title: string | null;
      content_excerpt: string | null;
      link_post_id: string | null;
      link_post_public_id: string | null;
      link_category_slug: string | null;
      link_is_comment: boolean;
    }>(
      `SELECT l.id, m.username AS moderator_username, l.target_type, l.target_id,
              CASE WHEN l.target_type = ANY($3::text[]) THEN t.username ELSE NULL END AS target_username,
              l.accessed_at,
              CASE
                WHEN l.target_type = 'post_delete' THEN p.title
                WHEN l.target_type = 'report_resolve' THEN rp.title
              END AS content_title,
              CASE
                WHEN l.target_type = 'post_delete' THEN LEFT(p.body, 200)
                WHEN l.target_type = 'comment_delete' THEN l.detail
                WHEN l.target_type = 'report_resolve' THEN COALESCE(LEFT(rp.body, 200), LEFT(rc.body, 200))
              END AS content_excerpt,
              CASE
                WHEN l.target_type = 'post_delete' THEN p.id
                WHEN l.target_type = 'comment_delete' THEN cd.id
                WHEN l.target_type = 'report_resolve' THEN COALESCE(rp.id, rcp.id)
              END AS link_post_id,
              CASE
                WHEN l.target_type = 'post_delete' THEN p.public_id
                WHEN l.target_type = 'comment_delete' THEN cd.public_id
                WHEN l.target_type = 'report_resolve' THEN COALESCE(rp.public_id, rcp.public_id)
              END AS link_post_public_id,
              CASE
                WHEN l.target_type = 'post_delete' THEN catp.slug
                WHEN l.target_type = 'comment_delete' THEN catcd.slug
                WHEN l.target_type = 'report_resolve' THEN COALESCE(catrp.slug, catrcp.slug)
              END AS link_category_slug,
              (l.target_type = 'comment_delete' OR (l.target_type = 'report_resolve' AND r.target_type = 'comment')) AS link_is_comment
       FROM moderation_access_log l
       LEFT JOIN users m ON m.id = l.moderator_id
       LEFT JOIN users t ON t.id = l.target_id AND l.target_type = ANY($3::text[])
       LEFT JOIN posts p ON l.target_type = 'post_delete' AND p.id = l.target_id
       LEFT JOIN categories catp ON catp.id = p.category_id
       LEFT JOIN posts cd ON l.target_type = 'comment_delete' AND cd.id = l.target_post_id
       LEFT JOIN categories catcd ON catcd.id = cd.category_id
       LEFT JOIN reports r ON l.target_type = 'report_resolve' AND r.id = l.target_id
       LEFT JOIN posts rp ON r.target_type = 'post' AND rp.id = r.target_id
       LEFT JOIN categories catrp ON catrp.id = rp.category_id
       LEFT JOIN comments rc ON r.target_type = 'comment' AND rc.id = r.target_id
       LEFT JOIN posts rcp ON rc.target_type = 'post' AND rcp.id = rc.target_id
       LEFT JOIN categories catrcp ON catrcp.id = rcp.category_id
       ORDER BY l.accessed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, USER_TARGET_TYPES],
    ),
  );
  return r.rows.map((row) => ({
    id: row.id,
    moderatorUsername: row.moderator_username,
    targetType: row.target_type,
    targetId: row.target_id,
    targetUsername: row.target_username,
    accessedAt: row.accessed_at,
    contentTitle: row.content_title,
    contentExcerpt: row.content_excerpt,
    linkPostId: row.link_post_id,
    linkPostPublicId: row.link_post_public_id,
    linkCategorySlug: row.link_category_slug,
    linkIsComment: row.link_is_comment,
  }));
}

/**
 * 신고 처리(resolve) — 사용자 발견(2026-08-18, "글/댓글 관리는 어디서 해?")
 * 이후 /admin/reports가 읽기 전용에서 벗어나는 첫 액션. `reports`는 RLS
 * 대상이 아니다(0007) — banUser()처럼 raw 트랜잭션으로 충분하다. 이미
 * 처리된 신고를 다시 resolve해도 멱등하게 성공 처리한다(unbanUser()와 같은 원칙).
 */
export async function resolveReport(moderatorId: string, reportId: string): Promise<ModerationActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query<{ id: string; status: string }>(`SELECT id, status FROM reports WHERE id = $1 FOR UPDATE`, [reportId]);
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (target.rows[0].status === 'resolved') {
      await client.query('ROLLBACK');
      return { ok: true }; // 이미 처리됨 — 멱등
    }

    await client.query(`UPDATE reports SET status = 'resolved', handled_by = $1 WHERE id = $2`, [moderatorId, reportId]);
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id, report_id) VALUES ($1, 'report_resolve', $2, $2)`, [
      moderatorId,
      reportId,
    ]);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 🔒 모더레이터의 글 삭제 — 소프트삭제(posts.deleted_at). 사용자 본인의
 * deletePost()(posts.ts)와 달리 하드 삭제하지 않는다 — 신고 대응은 이의제기·
 * 감사 대비로 내용을 남겨야 한다. RLS를 뚫으려면 app.user_id가 모더레이터로
 * SET LOCAL 돼 있어야 하므로(불변식 2) withRelationCtx를 쓴다.
 *
 * 🔒 실측으로 발견 — 이 글에 **열린 신고가 있어야만** 지울 수 있다. 0035의
 * UPDATE 정책은 `app_moderator_can_view('post', id)`를 쓴다(처음엔
 * ban/unban처럼 신고 무관 `app_is_moderator()`로 만들었다가 "new row
 * violates row-level security policy"로 막혔다 — Postgres의 UPDATE
 * WITH CHECK는 결과 행이 SELECT 정책도 통과해야 확정되는데, deleted_at을
 * 채운 새 행은 SELECT 정책의 기본 절이 깨져 있어 열린 신고 카브아웃만
 * 남는다). 신고를 먼저 resolve하면 그 후엔 이 함수로 같은 글을 못 지운다
 * — admin-http.ts/AdminReportsList.tsx가 신고가 open인 동안만 삭제를
 * 노출해 이 순서를 유도한다. ban/unban과 달리 "유일한 활성 모더레이터"
 * 잠금은 필요 없다 — 글 삭제가 모더레이터 자격을 뺏지는 않는다.
 */
export async function deletePostAsModerator(moderatorId: string, postId: string): Promise<ModerationActionResult> {
  const deleted = await withRelationCtx(pool, { userId: moderatorId }, async (client) => {
    const del = await client.query(`UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [postId]);
    if ((del.rowCount ?? 0) === 0) return false;
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, 'post_delete', $2)`, [
      moderatorId,
      postId,
    ]);
    return true;
  });
  return deleted ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}

/**
 * 🔒 모더레이터의 글 카테고리 이동(사용자 지시, 2026-09-06 — "카테고리가
 * 잘못된 글들이 몇개 보여, 관리자 페이지에서 직접 옮길수 있어야"). 대상은
 * 이미 카테고리가 있는 커뮤니티 글만(category_id IS NOT NULL 조건) — 로그
 * 글을 커뮤니티로 옮기는 건 별도 기능(§13 UserLogView의 "커뮤니티로 옮기기")
 * 몫이라 여기선 다루지 않는다. 새 카테고리도 공개·리프·커뮤니티 타입인지
 * 검증한다(fetchAllCategories()와 동일 화이트리스트) — 대분류(parent_id
 * NULL)나 마켓 카테고리로는 못 옮기게 막는다.
 *
 * RLS: 0036의 posts_moderator_delete_arrays/exists는 이름과 달리 UPDATE
 * 전반을 허용한다(`app_is_moderator() AND visibility = 'public'`) — 커뮤니티
 * 글은 항상 visibility='public'(posts.ts createCommunityPost)이라 새 정책
 * 없이 그대로 통과한다.
 */
export async function changePostCategoryAsModerator(
  moderatorId: string,
  postId: string,
  categoryId: string,
): Promise<ModerationActionResult> {
  const moved = await withRelationCtx(pool, { userId: moderatorId }, async (client) => {
    const category = await client.query(
      `SELECT id FROM categories WHERE id = $1 AND parent_id IS NOT NULL AND is_public = true AND type = 'community'`,
      [categoryId],
    );
    if (category.rowCount === 0) return null;
    const move = await client.query(
      `UPDATE posts SET category_id = $1, updated_at = now() WHERE id = $2 AND category_id IS NOT NULL AND deleted_at IS NULL`,
      [categoryId, postId],
    );
    if ((move.rowCount ?? 0) === 0) return false;
    await client.query(`INSERT INTO moderation_access_log (moderator_id, target_type, target_id) VALUES ($1, 'post_move_category', $2)`, [
      moderatorId,
      postId,
    ]);
    return true;
  });
  if (moved === null) return { ok: false, error: 'INVALID_INPUT' };
  return moved ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}

/**
 * 🔒 모더레이터의 댓글 삭제 — comments엔 RLS도 deleted_at도 없다(§13
 * 다형성이라 정책 불가, 0011). deleteComment()(comments.ts)와 같은 패턴으로
 * 하드 삭제한다 — 다만 `author_id = $2` 제약이 없다(모더레이터는 작성자가
 * 아니어도 지운다). 1-depth 답글(parent_comment_id ON DELETE CASCADE,
 * 0021)은 자동으로 같이 지워지지만 reactions는 다형성이라 FK가 없어
 * 직접 지운다.
 *
 * 🔒 사용자 지시(2026-08-19, "감사로그는 어떤 게시물을 어떻게 처리 했는지
 * 정보가 나와줘야") — 하드삭제라 지운 뒤엔 내용을 복원할 방법이 없다.
 * 지우기 직전에 본문 일부(`detail`)와 부모 글 id(`target_post_id`)를
 * `moderation_access_log`에 스냅샷으로 남긴다(0037) — listAuditLog()가
 * 이걸로 "어떤 글에 달린 어떤 댓글을 지웠는지" 보여준다.
 */
export async function deleteCommentAsModerator(moderatorId: string, commentId: string): Promise<ModerationActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query<{ body: string; target_id: string }>(`SELECT body, target_id FROM comments WHERE id = $1`, [commentId]);
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }
    const { body, target_id: parentPostId } = target.rows[0];

    const affected = await client.query<{ id: string }>(`SELECT id FROM comments WHERE id = $1 OR parent_comment_id = $1`, [commentId]);
    await client.query(`DELETE FROM comments WHERE id = $1`, [commentId]);
    const affectedIds = affected.rows.map((r) => r.id);
    await client.query(`DELETE FROM reactions WHERE target_type = 'comment' AND target_id = ANY($1::uuid[])`, [affectedIds]);
    await client.query(
      `INSERT INTO moderation_access_log (moderator_id, target_type, target_id, detail, target_post_id) VALUES ($1, 'comment_delete', $2, $3, $4)`,
      [moderatorId, commentId, body.slice(0, 200), parentPostId],
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
