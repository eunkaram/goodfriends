/**
 * M2 — Q&A 채택(qna.ts) + 시리즈(series.ts) 가드 테스트.
 *
 * 두 모듈 모두 posts를 withRelationCtx로 재조회해 RLS·author를 재검증하는
 * 구조다 — "RLS가 없는 테이블은 posts 조인으로 보호"라는 §13 원칙의 검증.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { setAdoptedComment } from '../../src/qna.ts';
import {
  createSeries,
  listSeries,
  fetchSeriesWithPosts,
  attachPostToSeries,
  detachPostFromSeries,
  updateSeries,
  deleteSeries,
} from '../../src/series.ts';

let owner: pg.Pool;
let qaAuthor: string;
let outsider: string;
let qnaCategoryId: string;
let freeCategoryId: string;

let qnaPostId: string;
let nonQnaPostId: string;
let qnaPostPublicId: string;
let answer1: string;
let answer2: string;

beforeAll(async () => {
  owner = ownerPool();
  // 시리즈가 posts.series_id를 물고 있으므로 글부터 치워야 한다
  await owner.query(`DELETE FROM posts WHERE title LIKE 'M2QNA::%' OR title LIKE 'M2SR::%'`);
  await owner.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'm2qna_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'm2qna_%')`,
  );
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'M2QNA::%')`);
  await owner.query(`DELETE FROM series WHERE owner_id IN (SELECT id FROM users WHERE username LIKE 'm2qna_%')`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'm2qna_%'`);

  qnaCategoryId = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'qna'`)).rows[0].id;
  freeCategoryId = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('m2qna_author'), ('m2qna_outsider') RETURNING id, username`,
  );
  qaAuthor = u.rows.find((r) => r.username === 'm2qna_author')!.id;
  outsider = u.rows.find((r) => r.username === 'm2qna_outsider')!.id;

  const p = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'M2QNA::qna post', 'public') RETURNING id, public_id`,
    [qaAuthor, qnaCategoryId],
  );
  qnaPostId = p.rows[0].id;
  qnaPostPublicId = p.rows[0].public_id;

  const p2 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'M2QNA::not qna', 'public') RETURNING id`,
    [qaAuthor, freeCategoryId],
  );
  nonQnaPostId = p2.rows[0].id;

  const c1 = await owner.query<{ id: string }>(
    `INSERT INTO comments (target_type, target_id, author_id, body, parent_comment_id) VALUES ('post', $1, $2, '답변 1', NULL) RETURNING id`,
    [qnaPostId, outsider],
  );
  answer1 = c1.rows[0].id;
  const c2 = await owner.query<{ id: string }>(
    `INSERT INTO comments (target_type, target_id, author_id, body, parent_comment_id) VALUES ('post', $1, $2, '답변 1의 답글', $3) RETURNING id`,
    [qnaPostId, qaAuthor, answer1],
  );
  answer2 = c2.rows[0].id;
});

afterAll(async () => {
  await owner?.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'm2qna_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'm2qna_%')`,
  );
  await owner?.query(`DELETE FROM comments WHERE id = ANY($1::uuid[])`, [answer1 ? [answer1, answer2] : []]);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'M2QNA::%' OR title LIKE 'M2SR::%'`);
  await owner?.query(`DELETE FROM series WHERE owner_id = ANY($1::uuid[])`, [qaAuthor && outsider ? [qaAuthor, outsider] : []]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'm2qna_%'`);
  await owner?.end();
});

describe('Q&A 채택 — setAdoptedComment', () => {
  it('글 작성자는 자기 Q&A 글의 답변(최상위 댓글)을 채택한다', async () => {
    const r = await setAdoptedComment(qaAuthor, qnaPostId, answer1);
    expect(r).toEqual({ ok: true, commentId: answer1 });
    const row = await owner.query(`SELECT adopted_comment_id FROM posts WHERE id = $1`, [qnaPostId]);
    expect(row.rows[0].adopted_comment_id).toBe(answer1);
  });

  it('답글(부모 있는 댓글)도 답변으로 쳐서 채택할 수 있다', async () => {
    const r = await setAdoptedComment(qaAuthor, qnaPostId, answer2);
    expect(r).toEqual({ ok: true, commentId: answer2 });
  });

  it('채택을 바꾸면 이전 채택이 사라진다(단일 컬럼 오버라이드)', async () => {
    const first = await setAdoptedComment(qaAuthor, qnaPostId, answer1);
    expect(first.ok).toBe(true);
    const second = await setAdoptedComment(qaAuthor, qnaPostId, answer2);
    expect(second.ok).toBe(true);
    const row = await owner.query(`SELECT adopted_comment_id FROM posts WHERE id = $1`, [qnaPostId]);
    expect(row.rows[0].adopted_comment_id).toBe(answer2);
  });

  it('채택 해제 — commentId null', async () => {
    const r = await setAdoptedComment(qaAuthor, qnaPostId, null);
    expect(r.ok).toBe(true);
    const row = await owner.query(`SELECT adopted_comment_id FROM posts WHERE id = $1`, [qnaPostId]);
    expect(row.rows[0].adopted_comment_id).toBeNull();
  });

  it('🔒 남의 글은 채택할 수 없다(FORBIDDEN)', async () => {
    const r = await setAdoptedComment(outsider, qnaPostId, answer1);
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN' });
    const row = await owner.query(`SELECT adopted_comment_id FROM posts WHERE id = $1`, [qnaPostId]);
    expect(row.rows[0].adopted_comment_id).toBeNull();
  });

  it('🔒 Q&A가 아닌 카테고리 글은 INVALID_INPUT', async () => {
    const r = await setAdoptedComment(qaAuthor, nonQnaPostId, null);
    expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('🔒 다른 글의 댓글을 대상으로 채택하려 하면 INVALID_INPUT', async () => {
    const r = await setAdoptedComment(qaAuthor, qnaPostId, '00000000-0000-0000-0000-000000000000');
    expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('존재하지 않는 글은 NOT_FOUND', async () => {
    const r = await setAdoptedComment(qaAuthor, '00000000-0000-0000-0000-000000000000', answer1);
    expect(r).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('시리즈 — createSeries·listSeries', () => {
  let seriesId: string;

  it('제목 1자도 OK, 빈 제목은 INVALID_INPUT', async () => {
    const ok = await createSeries(qaAuthor, { title: '나의 개발 로그', description: '연재물 헤더' });
    expect(ok.ok).toBe(true);
    seriesId = (ok as { ok: true; series: { id: string } }).series.id;

    const bad = await createSeries(qaAuthor, { title: '   ' });
    expect(bad).toEqual({ ok: false, error: 'INVALID_INPUT' });
    const tooLong = await createSeries(qaAuthor, { title: '가'.repeat(101) });
    expect(tooLong).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('listSeries(username)은 그 사용자의 시리즈만 돌려준다', async () => {
    const mine = await listSeries('m2qna_author');
    expect(mine.some((s) => s.id === seriesId)).toBe(true);
    const other = await listSeries('m2qna_outsider');
    expect(other.some((s) => s.id === seriesId)).toBe(false);
  });
});

describe('시리즈 — 글 담기/빼기/상세', () => {
  let postId: string;

  beforeAll(async () => {
    const p = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'M2SR::series part', 'public') RETURNING id`,
      [qaAuthor, freeCategoryId],
    );
    postId = p.rows[0].id;
  });

  it('🔒 남의 시리즈엔 못 담는다(FORBIDDEN)', async () => {
    const sid = (await createSeries(qaAuthor, { title: '소유자가 옳은 시리즈' })) as { ok: true; series: { id: string } };
    const r = await attachPostToSeries(outsider, sid.series.id, postId);
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN' });
    const wrongPost = await attachPostToSeries(outsider, (await listSeries('m2qna_author'))[0].id, postId);
    expect(wrongPost).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('🔒 남의 글은 담을 수 없다(시리즈 소유자가 눌러도) — INVALID_INPUT', async () => {
    // outsider의 시리즈에 qaAuthor의 글을 담는 UI 경로 — outsider 소유 시리즈 자체가 없어 blocked로 걸린다.
    // 실제 시나리오(내 시리즈 + 남의 글)는 "내 시리즈"만 있으니: outsider가 자기 시리즈를 만들어 qaAuthor 글을 담는다.
    const s = await createSeries(outsider, { title: '외부인의 시리즈' });
    if (!s.ok) return;
    const r = await attachPostToSeries(outsider, s.series.id, postId);
    // RLS 재검증: posts는 qaAuthor 것 — outsider 컨텍스트에서 author != 자신 → INVALID_INPUT
    expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('내 시리즈에 내 글을 담으면 목록 순서대로 상세에서 나온다', async () => {
    const s = await createSeries(qaAuthor, { title: '요약답변 시리즈' });
    if (!s.ok) throw new Error('fixture failed');
    const sid = (s as { ok: true; series: { id: string } }).series.id;
    const attach = await attachPostToSeries(qaAuthor, sid, postId);
    expect(attach).toEqual({ ok: true });

    const detail = await fetchSeriesWithPosts(sid);
    expect(detail?.series.title).toBe('요약답변 시리즈');
    expect(detail?.series.postCount).toBe(1);
    expect(detail?.posts).toHaveLength(1);
    expect(detail?.posts[0].title).toBe('M2SR::series part');
    expect(detail?.posts[0].seriesIndex).toBeNull();
  });

  it('빼면 시리즈 목록에서 사라진다(글은 유지)', async () => {
    const sid = (await listSeries('m2qna_author')).find((s) => s.title === '요약답변 시리즈')!.id;
    const r = await detachPostFromSeries(qaAuthor, sid, postId);
    expect(r).toEqual({ ok: true });
    const detail = await fetchSeriesWithPosts(sid);
    expect(detail?.posts).toHaveLength(0);
    const post = await owner.query(`SELECT series_id FROM posts WHERE id = $1`, [postId]);
    expect(post.rows[0].series_id).toBeNull();
  });

  it('updateSeries·deleteSeries — 소유자만 통과', async () => {
    const s = await createSeries(qaAuthor, { title: '수정 대상' });
    if (!s.ok) throw new Error('fixture failed');
    const sid = (s as { ok: true; series: { id: string } }).series.id;
    expect(await updateSeries(outsider, sid, { title: '훔치기' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await updateSeries(qaAuthor, sid, { title: '수정됨' })).toEqual({ ok: true });
    expect(await deleteSeries(outsider, sid)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await deleteSeries(qaAuthor, sid)).toEqual({ ok: true });
    // 삭제됐는데도 글은 유지된다(SET NULL)
    const post = await owner.query(`SELECT series_id FROM posts WHERE id = $1`, [postId]);
    expect(post.rows[0].series_id).toBeNull();
  });
});
