/**
 * 화제 다이제스트 엔진의 도메인 — M3(§3)의 반수동 제작 흐름:
 *
 *   관리자가 소재 계정 리스트를 관리 → 초안 생성(LLM) → 확인/수정 → 발행
 *   (news 카테고리, ai_digest_bot 명의 — 0053 이전엔 ai-topics)
 *
 * HTTP는 admin-digest-http.ts가, UI는 web/components/AdminDigests.tsx가
 * 이 모듈을 부른다. 발행 시에만 커뮤니티 posts 쿼리를 만지는데, RLS는
 * 봇 컨텍스트로 통과시킨다(createCommunityPost 재사용).
 */
import { appPool, ownerPool, queryRaw } from './db.ts';
import { generateDigestDraft } from './llm.ts';
import { createCommunityPost } from './posts.ts';

const pool = appPool('exists');

// 🔒 0053(goodfriends 카테고리 교체) — 'ai-topics'(오늘의 AI 화제)는 goodfriends
// 11개 카테고리에 없어 비공개 처리됐다. 다이제스트는 가장 가까운 News로 합친다.
export const DIGEST_CATEGORY_SLUG = 'news';
export const DIGEST_BOT_USERNAME = 'ai_digest_bot';
/** 초안 생성이 훑으러 갈 활동 윈도우. "오늘의"라지만 새벽에 돌면 하루가
 * 빈다 — 48시간을 창으로 두고 중복은 digest_drafts 발행 이력이 걸러낸다. */
export const DIGEST_WINDOW_HOURS = 48;

// ── 소재 계정 리스트 ────────────────────────────────────────────────────

export type DigestSourceRow = { id: string; userId: string; username: string; nickname: string | null; createdAt: Date };

export async function listDigestSources(): Promise<DigestSourceRow[]> {
  const rows = await queryRaw<DigestSourceRow>(
    pool,
    `SELECT s.id, s.user_id AS "userId", u.username, u.nickname, s.created_at AS "createdAt"
     FROM digest_sources s JOIN users u ON u.id = s.user_id
     ORDER BY s.created_at ASC`,
  );
  return rows.rows;
}

export async function addDigestSource(username: string, addedBy: string): Promise<{ ok: true } | { ok: false; error: 'USER_NOT_FOUND' }> {
  const trimmed = username.trim().replace(/^@/, '');
  if (!trimmed) return { ok: false, error: 'USER_NOT_FOUND' };
  const user = await queryRaw<{ id: string }>(pool, `SELECT id FROM users WHERE username = $1`, [trimmed]);
  if (!user.rows[0]) return { ok: false, error: 'USER_NOT_FOUND' };
  // 🔒 UNIQUE(user_id) + ON CONFLICT DO NOTHING — 같은 계정을 두 번 담지 않는다.
  await ownerPool().query(
    `INSERT INTO digest_sources (user_id, added_by) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.rows[0].id, addedBy],
  );
  return { ok: true };
}

export async function removeDigestSource(id: string): Promise<boolean> {
  try {
    await ownerPool().query(`DELETE FROM digest_sources WHERE id = $1`, [id]);
  } catch {
    // 잘못된 id(uuid 아님) — 삭제 없음으로 간주
    return false;
  }
  return true;
}

// ── 초안 생성 ───────────────────────────────────────────────────────────

export type DigestActivity = { username: string; nickname: string | null; postTitle: string; postBodyExcerpt: string; commentCount: number };

/** 윈도우 안 소재 계정들의 공개 글 + 댓글 수. visibility='public'만 — 초안이
 * 친구 전용 글을 밖으로 퍼뜨리는 사고를 구조적으로 막는다(공개 성격의
 * 게시물만 다이제스트에 나온다). */
export async function collectDigestActivities(windowHours: number = DIGEST_WINDOW_HOURS): Promise<DigestActivity[]> {
  const rows = await queryRaw<DigestActivity>(
    pool,
    `WITH recent_posts AS (
       SELECT p.id, p.author_id, p.title, p.body, p.created_at
       FROM posts p
       JOIN digest_sources s ON s.user_id = p.author_id
       WHERE p.visibility = 'public'
         AND p.deleted_at IS NULL
         AND p.created_at > now() - ($1 || ' hours')::interval
     )
     SELECT u.username, u.nickname,
            rp.title AS "postTitle",
            LEFT(regexp_replace(rp.body, E'<[^>]+>|\\s+', ' ', 'g'), 500) AS "postBodyExcerpt",
            (SELECT COUNT(*)::int FROM comments c WHERE c.target_type = 'post' AND c.target_id = rp.id) AS "commentCount"
     FROM recent_posts rp
     JOIN users u ON u.id = rp.author_id
     ORDER BY rp.created_at DESC
     LIMIT 30`,
    [String(windowHours)],
  );
  return rows.rows;
}

export type DraftRow = {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  postId: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export async function listDigestDrafts(status: 'draft' | 'published' | 'all' = 'all'): Promise<DraftRow[]> {
  const whereSql = status === 'all' ? '' : `WHERE status = $1`;
  const params: unknown[] = status === 'all' ? [] : [status];
  const rows = await queryRaw<DraftRow>(
    pool,
    `SELECT id, title, content, status, post_id AS "postId", created_at AS "createdAt",
            updated_at AS "updatedAt", published_at AS "publishedAt"
     FROM digest_drafts ${whereSql}
     ORDER BY created_at DESC
     LIMIT 50`,
    params,
  );
  return rows.rows;
}

export async function getDigestDraft(id: string): Promise<DraftRow | null> {
  const rows = await queryRaw<DraftRow>(
    pool,
    `SELECT id, title, content, status, post_id AS "postId", created_at AS "createdAt",
            updated_at AS "updatedAt", published_at AS "publishedAt"
     FROM digest_drafts WHERE id = $1`,
    [id],
  );
  return rows.rows[0] ?? null;
}

/** 관리자가 "생성" 버튼을 눌렀을 때 — 활동 수집 → LLM 초안 → digest_drafts 저장. */
export async function createDigestDraft(createdBy: string): Promise<{ ok: true; draft: DraftRow } | { ok: false; error: string }> {
  const activities = await collectDigestActivities();
  if (activities.length === 0) return { ok: false, error: 'EMPTY_SOURCES_ACTIVITY' };

  const dateLabel = new Date().toISOString().slice(0, 10);
  const generated = await generateDigestDraft({ dateLabel, activities });
  if (!generated.ok) return { ok: false, error: `LLM_FAILED: ${generated.error}` };

  const inserted = await ownerPool().query<{ id: string }>(
    `INSERT INTO digest_drafts (title, content, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [generated.value.title, generated.value.content, createdBy],
  );
  const draft = await getDigestDraft(inserted.rows[0].id);
  return draft ? { ok: true, draft } : { ok: false, error: 'INTERNAL_ERROR' };
}

export async function updateDigestDraft(id: string, patch: { title?: string; content?: string }): Promise<{ ok: true; draft: DraftRow } | { ok: false; error: string }> {
  const trimmedTitle = patch.title?.trim();
  const trimmedContent = patch.content?.trim();
  if (trimmedTitle === '' || trimmedContent === '') return { ok: false, error: 'INVALID_INPUT' };
  try {
    await ownerPool().query(
      `UPDATE digest_drafts SET
         title = COALESCE($2, title),
         content = COALESCE($3, content),
         updated_at = now()
       WHERE id = $1`,
      [id, trimmedTitle ?? null, trimmedContent ?? null],
    );
  } catch {
    return { ok: false, error: 'INVALID_INPUT' }; // id가 uuid가 아닌 경우
  }
  const draft = await getDigestDraft(id);
  if (!draft) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true, draft };
}

/** 관리자 확인/수정 후 발행 — ai-topics 카테고리에 봇 명의로 커뮤니티 글.
 * 드래프트→발행은 1회만(재발행 방지). */
export async function publishDigestDraft(id: string): Promise<{ ok: true; postPublicId: string } | { ok: false; error: string }> {
  const draft = await getDigestDraft(id);
  if (!draft) return { ok: false, error: 'NOT_FOUND' };
  if (draft.status !== 'draft') return { ok: false, error: 'ALREADY_PUBLISHED' };

  const rows = await queryRaw<{ bot_id: string; category_id: string }>(
    ownerPool(),
    `SELECT
       (SELECT id FROM users WHERE username = $1) AS bot_id,
       (SELECT id FROM categories WHERE slug = $2 AND is_public) AS category_id`,
    [DIGEST_BOT_USERNAME, DIGEST_CATEGORY_SLUG],
  );
  const botId = rows.rows[0]?.bot_id;
  const categoryId = rows.rows[0]?.category_id;
  if (!botId || !categoryId) return { ok: false, error: 'BOT_OR_CATEGORY_MISSING' };

  // 🔒 초안 발행은 앱 body 계약(컴포저 저장 형식 — 플레인 텍스트 문단) 그대로
  // 저장한다. 구버전은 이중 빈줄을 HTML <p> 래핑으로 바꿨는데, 화면(body를
  // 플레인으로만 파싱하는 link-detect.ts)에서 태그가 그대로 노출되는 계약
  // 위반이었다. 목록의 - 접두는 살려둔다.
  const post = await createCommunityPost(botId, { categoryId, title: draft.title, body: draft.content.trim() });
  if (!post.ok) return { ok: false, error: `POST_REJECTED: ${post.error}` };

  await ownerPool().query(
    `UPDATE digest_drafts SET status = 'published', post_id = $2, published_at = now(), updated_at = now() WHERE id = $1`,
    [id, post.id],
  );
  return { ok: true, postPublicId: post.publicId };
}
