/**
 * 포스트 상세 데이터 계층 — §11.7.4.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { fetchPostDetail } from '../../src/post-detail.ts';

let owner: pg.Pool;
let author: string;
let viewer: string;
let categoryId: string;
let postId: string;
let publicId: string;
let deletedPublicId: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM posts WHERE title LIKE 'PDETAIL::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'pdetail_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('pdetail_author'), ('pdetail_viewer') RETURNING id, username`,
  );
  author = u.rows.find((r) => r.username === 'pdetail_author')!.id;
  viewer = u.rows.find((r) => r.username === 'pdetail_viewer')!.id;

  const cat = await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`);
  categoryId = cat.rows[0].id;

  const p = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'PDETAIL::main', '본문 전문입니다', 'public') RETURNING id, public_id`,
    [author, categoryId],
  );
  postId = p.rows[0].id;
  publicId = p.rows[0].public_id;

  await owner.query(`INSERT INTO reactions (target_type, target_id, user_id, emoticon_type) VALUES ('post', $1, $2, 'cheer')`, [postId, viewer]);

  const dp = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility, deleted_at) VALUES ($1, $2, 'PDETAIL::deleted', 'public', now()) RETURNING id, public_id`,
    [author, categoryId],
  );
  deletedPublicId = dp.rows[0].public_id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM reactions WHERE target_id = $1`, [postId]);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'PDETAIL::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'pdetail_%'`);
  await owner?.end();
});

describe('fetchPostDetail', () => {
  it('전문·작성자·카테고리·카운트·내 반응까지 전부 채운다', async () => {
    const detail = await fetchPostDetail(viewer, publicId);
    expect(detail?.title).toBe('PDETAIL::main');
    expect(detail?.body).toBe('본문 전문입니다');
    expect(detail?.authorUsername).toBe('pdetail_author');
    expect(detail?.categoryName).toBe('자유게시판'); // 0049 — 자유게시판
    expect(detail?.reactionCount).toBe(1);
    expect(detail?.myReaction).toBe('cheer');
  });

  it('비로그인은 myReaction이 null이다', async () => {
    const detail = await fetchPostDetail(null, publicId);
    expect(detail?.myReaction).toBeNull();
  });

  it('🔒 삭제된 글은 null — 라우트가 404로 옮긴다', async () => {
    expect(await fetchPostDetail(viewer, deletedPublicId)).toBeNull();
  });

  it('존재하지 않는 ID도 null', async () => {
    expect(await fetchPostDetail(viewer, 'does-not-exist')).toBeNull();
  });
});
