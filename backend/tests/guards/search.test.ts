/**
 * 전체검색 — 제목/본문 통합 목록, 중복 제거, 공개 범위, 카테고리 필터, hasMore.
 * 픽스처 단어는 실서비스 데이터와 겹치지 않게 SRCH* 토큰으로 고정한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { searchAll } from '../../src/search.ts';

let owner: pg.Pool;
let author: string;
let freeCategory: string;
let qnaCategory: string;

let titlePostId: string;
let bodyPostId: string;
let bodyPostPublicId: string;
let qnaBodyPostId: string;
let privateLogPostId: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM comments WHERE body LIKE 'SRCH%'`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'SRCH%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'srchtest_%'`);

  const cats = await owner.query<{ id: string; slug: string }>(`SELECT id, slug FROM categories WHERE slug IN ('free', 'qna')`);
  freeCategory = cats.rows.find((r) => r.slug === 'free')!.id;
  qnaCategory = cats.rows.find((r) => r.slug === 'qna')!.id;

  const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('srchtest_author') RETURNING id`);
  author = u.rows[0].id;

  const titlePost = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, body, visibility)
     VALUES ($1, $2, 'SRCHALPHA 제목', 'SRCH 평범한 본문', 'public') RETURNING id, public_id`,
    [author, freeCategory],
  );
  titlePostId = titlePost.rows[0].id;

  const bodyPost = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, body, visibility)
     VALUES ($1, $2, 'SRCH 평범한 제목', 'SRCHBETA 본문', 'public') RETURNING id, public_id`,
    [author, freeCategory],
  );
  bodyPostId = bodyPost.rows[0].id;
  bodyPostPublicId = bodyPost.rows[0].public_id;

  const qnaPost = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, body, visibility)
     VALUES ($1, $2, 'SRCH 평범한 큐앤에이', 'SRCHBETA 큐앤에이 본문', 'public') RETURNING id`,
    [author, qnaCategory],
  );
  qnaBodyPostId = qnaPost.rows[0].id;

  const privateLog = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, log_id, title, body, visibility)
     VALUES ($1, $1, 'SRCHSECRET 로그 제목', 'SRCHSECRET 로그 본문', 'private') RETURNING id`,
    [author],
  );
  privateLogPostId = privateLog.rows[0].id;

  await owner.query(
    `INSERT INTO posts (author_id, category_id, title, body, visibility, deleted_at)
     VALUES ($1, $2, 'SRCHDELETED 제목', 'SRCHDELETED 본문', 'public', now())`,
    [author, freeCategory],
  );

  await owner.query(
    `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'SRCHDELTA 댓글')`,
    [titlePostId, author],
  );
});

afterAll(async () => {
  await owner?.query(`DELETE FROM comments WHERE body LIKE 'SRCH%'`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'SRCH%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'srchtest_%'`);
  await owner?.end();
});

describe('searchAll — 통합 목록', () => {
  it('제목 일치와 본문 일치를 한 목록에 담고 같은 글은 한 번만 넣는다', async () => {
    const title = await searchAll(null, 'SRCHALPHA', { limit: 10, offset: 0 });
    expect(title.posts.items.map((p) => p.id)).toContain(titlePostId);

    const body = await searchAll(null, 'SRCHBETA', { limit: 10, offset: 0 });
    expect(body.posts.items.map((p) => p.id).sort()).toEqual([bodyPostId, qnaBodyPostId].sort());

    const mixed = await searchAll(null, 'SRCH', { limit: 10, offset: 0 });
    const ids = mixed.posts.items.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([titlePostId, bodyPostId, qnaBodyPostId]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('댓글 본문은 검색하지 않는다', async () => {
    const result = await searchAll(null, 'SRCHDELTA', { limit: 10, offset: 0 });
    expect(result.posts.items).toHaveLength(0);
  });

  it('본문 스니펫은 검색어 주변을 잘라서 반환한다', async () => {
    const result = await searchAll(null, 'SRCHBETA', { limit: 10, offset: 0 });
    const hit = result.posts.items.find((p) => p.id === bodyPostId);
    expect(hit?.publicId).toBe(bodyPostPublicId);
    expect(hit?.snippet).toContain('SRCHBETA');
  });
});

describe('searchAll — 공개 범위와 필터', () => {
  it('비공개 로그 글은 검색하지 않는다', async () => {
    const posts = await searchAll(null, 'SRCHSECRET', { limit: 10, offset: 0 });
    expect(posts.posts.items.map((p) => p.id)).not.toContain(privateLogPostId);
  });

  it('삭제된 글은 검색하지 않는다', async () => {
    const result = await searchAll(null, 'SRCHDELETED', { limit: 10, offset: 0 });
    expect(result.posts.items).toHaveLength(0);
  });

  it('카테고리로 한정한다', async () => {
    const free = await searchAll(null, 'SRCHBETA', { limit: 10, offset: 0, categorySlug: 'free' });
    expect(free.posts.items.map((p) => p.id)).toEqual([bodyPostId]);

    const qna = await searchAll(null, 'SRCHBETA', { limit: 10, offset: 0, categorySlug: 'qna' });
    expect(qna.posts.items.map((p) => p.id)).toEqual([qnaBodyPostId]);
  });

  it('LIKE 와일드카드를 리터럴로 취급한다', async () => {
    const result = await searchAll(null, 'SRCHBETA%', { limit: 10, offset: 0 });
    expect(result.posts.items).toHaveLength(0);
  });
});

describe('searchAll — 성능 계약', () => {
  it('LIMIT+1로 hasMore/nextOffset만 계산한다', async () => {
    const result = await searchAll(null, 'SRCHBETA', { limit: 1, offset: 0 });
    expect(result.posts.items).toHaveLength(1);
    expect(result.posts.hasMore).toBe(true);
    expect(result.posts.nextOffset).toBe(1);
  });

  it('2자 미만은 빈 목록', async () => {
    const result = await searchAll(null, 'S', { limit: 10, offset: 0 });
    expect(result.posts.items).toHaveLength(0);
  });
});
