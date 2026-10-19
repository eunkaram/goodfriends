/**
 * 개발 로그 시리즈 — PLAN M2 "연재로 묶기".
 *
 * 시리즈는 사용자 개인 리소스다: 소유자(owner)만 시리즈를 만들고, 같은 사용자의
 * 글만 담을 수 있다(소유자·작성자가 어긋나면 앱 계층에서 자른다). 시리즈를
 * 지워도 글은 유지된다(ON DELETE SET NULL, 0050). posts에는 RLS가 있다 —
 * 글 참조는 withRelationCtx로 재검증한다(저장 시점과 다른 삭제·차단 상태 대비, P4 원칙).
 */
import { appPool, withRelationCtx } from './db.ts';

export type Series = {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerNickname: string;
  title: string;
  description: string;
  createdAt: string;
  postCount: number;
};

export type SeriesPost = {
  id: string;
  publicId: string;
  title: string;
  createdAt: string;
  /** null이면 시리즈 순번 미지정(목록 끝, created_at 보조 정렬) */
  seriesIndex: number | null;
};

export type CreateSeriesResult =
  | { ok: true; series: Series }
  | { ok: false; error: 'INVALID_INPUT' | 'NOT_AUTHENTICATED' };

export type UpdateSeriesResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_INPUT' | 'NOT_FOUND' };

export type AttachPostResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' };

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;

const pool = appPool('exists');

function assertBlankLimit(name: string, value: unknown, max: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

export async function createSeries(
  userId: string,
  input: { title: string; description?: string },
): Promise<CreateSeriesResult> {
  const title = input.title?.trim();
  const description = (input.description ?? '').trim();
  if (!assertBlankLimit('title', title, MAX_TITLE) || description.length > MAX_DESCRIPTION) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const inserted = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ id: string; created_at: string }>(
      `INSERT INTO series (owner_id, title, description) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [userId, title, description],
    ),
  );
  const owner = await pool.query<{ username: string; nickname: string }>(
    `SELECT username, nickname FROM users WHERE id = $1`,
    [userId],
  );
  return {
    ok: true,
    series: {
      id: inserted.rows[0].id,
      ownerId: userId,
      ownerUsername: owner.rows[0]?.username ?? '',
      ownerNickname: owner.rows[0]?.nickname ?? '',
      title: title!,
      description,
      createdAt: inserted.rows[0].created_at,
      postCount: 0,
    },
  };
}

/** username null이면 https 홈 화면 전용 쿼리가 아니라 전체 최신 시리즈(관리 UI용). */
export async function listSeries(username: string | null, limit = 50, offset = 0): Promise<Series[]> {
  const rows = username
    ? await pool.query<SeriesRow>(
        `SELECT s.id, s.owner_id, u.username AS owner_username, u.nickname AS owner_nickname, s.title, s.description, s.created_at,
                (SELECT count(*) FROM posts p WHERE p.series_id = s.id AND p.deleted_at IS NULL) AS post_count
         FROM series s
         JOIN users u ON u.id = s.owner_id
         WHERE u.username = $1
         ORDER BY s.created_at DESC
         LIMIT $2 OFFSET $3`,
        [username, limit, offset],
      )
    : await pool.query<SeriesRow>(
        `SELECT s.id, s.owner_id, u.username AS owner_username, u.nickname AS owner_nickname, s.title, s.description, s.created_at,
                (SELECT count(*) FROM posts p WHERE p.series_id = s.id AND p.deleted_at IS NULL) AS post_count
         FROM series s
         JOIN users u ON u.id = s.owner_id
         ORDER BY s.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
  return rows.rows.map(mapSeriesRow);
}

type SeriesRow = {
  id: string;
  owner_id: string;
  owner_username: string;
  owner_nickname: string;
  title: string;
  description: string;
  created_at: string;
  post_count: string;
};

function mapSeriesRow(r: SeriesRow): Series {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerUsername: r.owner_username,
    ownerNickname: r.owner_nickname,
    title: r.title,
    description: r.description,
    createdAt: r.created_at,
    postCount: Number(r.post_count),
  };
}

/** 시리즈 헤더 + 글 목록(§5.1과 같은 N+1 서브쿼리 방지 패턴). 이 시리즈에 속한 소유자 게시글만. */
export async function fetchSeriesWithPosts(seriesId: string): Promise<{ series: Series; posts: SeriesPost[] } | null> {
  const head = await pool.query<SeriesRow>(
    `SELECT s.id, s.owner_id, u.username AS owner_username, u.nickname AS owner_nickname, s.title, s.description, s.created_at,
            (SELECT count(*) FROM posts p WHERE p.series_id = s.id AND p.deleted_at IS NULL) AS post_count
     FROM series s
     JOIN users u ON u.id = s.owner_id
     WHERE s.id = $1`,
    [seriesId],
  );
  if (head.rows.length === 0) return null;
  const posts = await withRelationCtx(pool, { userId: null }, (client) =>
    client.query<{
      id: string;
      public_id: string;
      title: string;
      created_at: string;
      series_index: number | null;
    }>(
      `SELECT p.id, p.public_id, p.title, p.created_at, p.series_index
       FROM posts p
       WHERE p.series_id = $1 AND p.deleted_at IS NULL AND p.visibility = 'public'
       ORDER BY p.series_index ASC NULLS LAST, p.created_at ASC
       LIMIT 500`,
      [seriesId],
    ),
  );
  return {
    series: mapSeriesRow(head.rows[0]),
    posts: posts.rows.map((p) => ({
      id: p.id,
      publicId: p.public_id,
      title: p.title,
      createdAt: p.created_at,
      seriesIndex: p.series_index,
    })),
  };
}

/** 시리즈 소유자와 글 작성자가 같은지 재검증하고 담는다(단일 UPDATE, 덮어쓰기 자율). */
export async function attachPostToSeries(
  userId: string,
  seriesId: string,
  postId: string,
): Promise<AttachPostResult> {
  const result = await withRelationCtx(pool, { userId }, async (client) => {
    const series = await client.query<{ owner_id: string }>(`SELECT owner_id FROM series WHERE id = $1`, [seriesId]);
    if (series.rowCount === 0) return { ok: false as const, error: 'NOT_FOUND' as const };
    if (series.rows[0].owner_id !== userId) return { ok: false as const, error: 'FORBIDDEN' as const };

    // 🔒 RLS 재검증 — 글이 아직도 이 사용자의 것인지(삭제·차단·범위변경 반영)
    const post = await client.query('SELECT 1 FROM posts WHERE id = $1 AND author_id = $2', [postId, userId]);
    if (post.rowCount === 0) return { ok: false as const, error: 'INVALID_INPUT' as const };

    // 새 글은 시리즈 끝(series_index 미지정) — 명시된 index 지정은 2차 UI 과제.
    await client.query(`UPDATE posts SET series_id = $2 WHERE id = $1`, [postId, seriesId]);
    return { ok: true as const };
  });
  return result;
}

export async function detachPostFromSeries(userId: string, seriesId: string, postId: string): Promise<AttachPostResult> {
  const result = await withRelationCtx(pool, { userId }, async (client) => {
    const series = await client.query<{ owner_id: string }>(`SELECT owner_id FROM series WHERE id = $1`, [seriesId]);
    if (series.rowCount === 0) return { ok: false as const, error: 'NOT_FOUND' as const };
    if (series.rows[0].owner_id !== userId) return { ok: false as const, error: 'FORBIDDEN' as const };
    const updated = await client.query(
      `UPDATE posts SET series_id = NULL, series_index = NULL WHERE id = $1 AND series_id = $2 AND author_id = $3`,
      [postId, seriesId, userId],
    );
    if (updated.rowCount === 0) return { ok: false as const, error: 'INVALID_INPUT' as const };
    return { ok: true as const };
  });
  return result;
}

export async function updateSeries(
  userId: string,
  seriesId: string,
  input: { title?: string; description?: string },
): Promise<UpdateSeriesResult> {
  const sets: string[] = [];
  const params: unknown[] = [seriesId, userId];
  if (input.title !== undefined) {
    if (!assertBlankLimit('title', input.title, MAX_TITLE)) return { ok: false, error: 'INVALID_INPUT' };
    params.push(input.title.trim());
    sets.push(`title = $${params.length}`);
  }
  if (input.description !== undefined) {
    if (input.description.trim().length > MAX_DESCRIPTION) return { ok: false, error: 'INVALID_INPUT' };
    params.push(input.description.trim());
    sets.push(`description = $${params.length}`);
  }
  if (sets.length === 0) return { ok: false, error: 'INVALID_INPUT' };
  const updated = await withRelationCtx(pool, { userId }, (client) =>
    client.query(`UPDATE series SET ${sets.join(', ')} WHERE id = $1 AND owner_id = $2`, params),
  );
  if (updated.rowCount === 0) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true };
}

/** 시리즈 삭제 — posts는 유지(ON DELETE SET NULL). */
export async function deleteSeries(userId: string, seriesId: string): Promise<{ ok: boolean; error?: 'NOT_FOUND' }> {
  const deleted = await withRelationCtx(pool, { userId }, (client) =>
    client.query(`DELETE FROM series WHERE id = $1 AND owner_id = $2`, [seriesId, userId]),
  );
  if (deleted.rowCount === 0) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true };
}
