/**
 * 신고하기 — Claude Design 확정안(2026-08)의 4개 신규 기능 중 하나. `reports`
 * 테이블 자체는 0007_moderation_foundation.sql에서 이미 만들어져 있었다
 * (§4.6 메시지 모더레이션 기반) — 새로 만들지 않고 재사용한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { createReport, listReports } from '../../src/reports.ts';
import { createComment } from '../../src/comments.ts';

let owner: pg.Pool;
let reporter: string;
let author: string;
let blockedAuthor: string;
let moderator: string;
let publicPostId: string;
let blockedAuthorPostId: string;
let category: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM reports WHERE reporter_id IN (SELECT id FROM users WHERE username LIKE 'report_%')`);
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'RPT::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'RPT::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'report_%'`);

  category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username, is_moderator) VALUES ('report_reporter', false), ('report_author', false), ('report_blocked_author', false), ('report_moderator', true) RETURNING id, username`,
  );
  reporter = u.rows.find((r) => r.username === 'report_reporter')!.id;
  author = u.rows.find((r) => r.username === 'report_author')!.id;
  blockedAuthor = u.rows.find((r) => r.username === 'report_blocked_author')!.id;
  moderator = u.rows.find((r) => r.username === 'report_moderator')!.id;

  const p1 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'RPT::public', 'RPT::본문 미리보기', 'public') RETURNING id`,
    [author, category],
  );
  publicPostId = p1.rows[0].id;

  const p2 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility, deleted_at) VALUES ($1, $2, 'RPT::deleted', 'public', now()) RETURNING id`,
    [blockedAuthor, category],
  );
  blockedAuthorPostId = p2.rows[0].id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM reports WHERE reporter_id IN (SELECT id FROM users WHERE username LIKE 'report_%')`);
  await owner?.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'RPT::%')`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'RPT::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'report_%'`);
  await owner?.end();
});

describe('createReport', () => {
  it('보이는 글을 신고하면 reports에 기록된다', async () => {
    const result = await createReport(reporter, 'post', publicPostId, '스팸이에요');
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT reason, target_type, target_id, reporter_id FROM reports WHERE target_id = $1`, [publicPostId]);
    expect(row.rows[0]).toMatchObject({ reason: '스팸이에요', target_type: 'post', target_id: publicPostId, reporter_id: reporter });
  });

  it('사유를 안 주면 기본값이 채워진다(reason NOT NULL)', async () => {
    const result = await createReport(reporter, 'post', publicPostId);
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT reason FROM reports WHERE target_id = $1 ORDER BY created_at DESC LIMIT 1`, [publicPostId]);
    expect(row.rows[0].reason).toBe('사유 미입력');
  });

  it('댓글도 신고할 수 있다(posts 조인으로 재검증)', async () => {
    const comment = await createComment(author, publicPostId, 'RPT::댓글');
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;
    const result = await createReport(reporter, 'comment', comment.id, '욕설');
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT target_type FROM reports WHERE target_id = $1`, [comment.id]);
    expect(row.rows[0].target_type).toBe('comment');
  });

  it('존재하지 않는(삭제된) 글은 신고할 수 없다', async () => {
    const result = await createReport(reporter, 'post', blockedAuthorPostId, '이유');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('잘못된 targetType은 거부한다', async () => {
    // @ts-expect-error 잘못된 값 고의 전달 — 런타임 방어 확인용
    const result = await createReport(reporter, 'user', publicPostId, '이유');
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });
});

describe('listReports', () => {
  it('글 신고엔 제목·본문 일부·작성자가 붙는다', async () => {
    await createReport(reporter, 'post', publicPostId, 'RPT::글미리보기');
    const rows = await listReports(moderator, 50, 0);
    const row = rows.find((r) => r.targetId === publicPostId && r.reason === 'RPT::글미리보기');
    expect(row).toMatchObject({
      targetTitle: 'RPT::public',
      targetExcerpt: 'RPT::본문 미리보기',
      targetAuthorUsername: 'report_author',
      targetDeleted: false,
    });
  });

  it('🔒 글 신고는 원문 링크에 쓸 targetPostId·targetCategorySlug를 담는다(사용자 지시, 2026-08-19 — "report도 글/댓글의 링크가 필요해")', async () => {
    await createReport(reporter, 'post', publicPostId, 'RPT::링크확인');
    const rows = await listReports(moderator, 50, 0);
    const row = rows.find((r) => r.targetId === publicPostId && r.reason === 'RPT::링크확인');
    expect(row).toMatchObject({ targetPostId: publicPostId, targetCategorySlug: 'free' });
  });

  it('댓글 신고엔 본문 일부·작성자가 붙는다(posts 조인 경유)', async () => {
    const comment = await createComment(author, publicPostId, 'RPT::댓글미리보기');
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;
    await createReport(reporter, 'comment', comment.id, 'RPT::댓글신고');
    const rows = await listReports(moderator, 50, 0);
    const row = rows.find((r) => r.targetId === comment.id);
    expect(row).toMatchObject({ targetExcerpt: 'RPT::댓글미리보기', targetAuthorUsername: 'report_author', targetDeleted: false });
  });

  it('🔒 댓글 신고는 부모 글 기준 targetPostId·targetCategorySlug를 담는다(댓글 자체는 링크가 없어 부모 글+#comments로 연결)', async () => {
    const comment = await createComment(author, publicPostId, 'RPT::댓글링크확인');
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;
    await createReport(reporter, 'comment', comment.id, 'RPT::댓글링크신고');
    const rows = await listReports(moderator, 50, 0);
    const row = rows.find((r) => r.targetId === comment.id);
    expect(row).toMatchObject({ targetPostId: publicPostId, targetCategorySlug: 'free' });
  });

  it('🔒 신고 접수 후 소프트삭제된 대상도(0035 app_moderator_can_view) 내용은 여전히 보인다 — 감사 목적, targetDeleted만 true', async () => {
    // 신고는 "지금 보이는" 대상에만 걸 수 있다(createReport의 재검증) — 먼저
    // 살아있을 때 신고를 걸고, 그 다음에 소프트삭제한다(deletePostAsModerator가
    // 하는 것과 같은 효과를 여기선 직접 SQL로 낸다 — reports.ts 단위 테스트라
    // moderation.ts를 끌어오지 않는다).
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'RPT::소프트삭제대상', 'public') RETURNING id`,
      [author, category],
    );
    const softDeletedPostId = p.rows[0].id;
    await createReport(reporter, 'post', softDeletedPostId, 'RPT::소프트삭제신고');
    await owner.query(`UPDATE posts SET deleted_at = now() WHERE id = $1`, [softDeletedPostId]);

    const rows = await listReports(moderator, 50, 0);
    const row = rows.find((r) => r.targetId === softDeletedPostId);
    expect(row).toMatchObject({ targetDeleted: true, targetTitle: 'RPT::소프트삭제대상', targetExcerpt: '' });
  });

  it('행 자체가 없어졌으면(하드삭제) 미리보기 필드도 null이다', async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'RPT::hard-deleted', 'public') RETURNING id`,
      [author, category],
    );
    const hardDeletedPostId = p.rows[0].id;
    await createReport(reporter, 'post', hardDeletedPostId, 'RPT::하드삭제신고');
    await owner.query(`DELETE FROM posts WHERE id = $1`, [hardDeletedPostId]);

    const rows = await listReports(moderator, 50, 0);
    const row = rows.find((r) => r.targetId === hardDeletedPostId);
    expect(row).toMatchObject({ targetDeleted: true, targetTitle: null, targetExcerpt: null });
  });
});
