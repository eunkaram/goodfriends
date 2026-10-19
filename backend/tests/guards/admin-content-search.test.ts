/**
 * 관리자 글/댓글 검색(사용자 지시, 2026-08-18 — "유저 관리처럼 신고 여부와
 * 무관하게 검색해서 삭제할 수 있게"). 범위는 사용자가 명시적으로 좁혔다 —
 * 전체공개 글(+그 댓글)만, 비공개/친구공개/팔로워공개 로그는 여기 안 뜬다
 * (그건 여전히 /admin/reports를 통해서만, 0035의 app_moderator_can_view()).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { searchPublicPosts } from '../../src/posts.ts';
import { searchPublicComments } from '../../src/comments.ts';

let owner: pg.Pool;
let moderator: string;
let author: string;
let category: string;
let publicPostId: string;
let privatePostId: string;
let commentId: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM comments WHERE body LIKE 'ACS::%'`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'ACS::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'acstest_%'`);

  category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username, is_moderator) VALUES ('acstest_moderator', true), ('acstest_author', false) RETURNING id, username`,
  );
  moderator = u.rows.find((r) => r.username === 'acstest_moderator')!.id;
  author = u.rows.find((r) => r.username === 'acstest_author')!.id;

  const p1 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, body, visibility) VALUES ($1, $2, 'ACS::공개글 딸기케이크', 'ACS::본문 초콜릿', 'public') RETURNING id`,
    [author, category],
  );
  publicPostId = p1.rows[0].id;

  const p2 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, log_id, title, body, visibility) VALUES ($1, $1, 'ACS::비공개글', 'ACS::비공개 본문', 'private') RETURNING id`,
    [author],
  );
  privatePostId = p2.rows[0].id;

  const c1 = await owner.query<{ id: string }>(
    `INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'ACS::댓글 바나나') RETURNING id`,
    [publicPostId, author],
  );
  commentId = c1.rows[0].id;

  await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'ACS::비공개글댓글')`, [
    privatePostId,
    author,
  ]);
});

afterAll(async () => {
  await owner?.query(`DELETE FROM comments WHERE body LIKE 'ACS::%'`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'ACS::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'acstest_%'`);
  await owner?.end();
});

describe('searchPublicPosts', () => {
  it('빈 검색어는 전체공개 글 전체를 최신순으로 보여준다', async () => {
    const rows = await searchPublicPosts(moderator, '', 50, 0);
    expect(rows.map((r) => r.id)).toContain(publicPostId);
    expect(rows.map((r) => r.id)).not.toContain(privatePostId);
  });

  it('제목으로 검색된다(§6.8 pg_bigm — lower()+LIKE)', async () => {
    const rows = await searchPublicPosts(moderator, '딸기케이크', 50, 0);
    expect(rows.map((r) => r.id)).toEqual([publicPostId]);
  });

  it('본문으로도 검색된다', async () => {
    const rows = await searchPublicPosts(moderator, '초콜릿', 50, 0);
    expect(rows.map((r) => r.id)).toEqual([publicPostId]);
  });

  it('🔒 비공개 글은 검색어가 정확히 일치해도 안 나온다', async () => {
    const rows = await searchPublicPosts(moderator, '비공개글', 50, 0);
    expect(rows.map((r) => r.id)).not.toContain(privatePostId);
  });

  it('작성자·카테고리 정보를 포함한다', async () => {
    const rows = await searchPublicPosts(moderator, '딸기케이크', 50, 0);
    expect(rows[0]).toMatchObject({ authorUsername: 'acstest_author', isCommunity: true });
  });

  it('🔒 원문 링크에 쓰는 categorySlug를 반환한다(커뮤니티 글, PostCard.tsx와 같은 href 규칙)', async () => {
    const rows = await searchPublicPosts(moderator, '딸기케이크', 50, 0);
    expect(rows[0].categorySlug).toBe('free');
  });
});

describe('searchPublicComments', () => {
  it('빈 검색어는 전체공개 글의 댓글만 보여준다(posts 조인 경유)', async () => {
    const rows = await searchPublicComments(moderator, '', 50, 0);
    expect(rows.map((r) => r.id)).toContain(commentId);
  });

  it('내용으로 검색된다', async () => {
    // 🔒 실전 CI 실패(2026-09-02, self-hosted 러너가 실 dev DB로 테스트를 돈다) —
    // '바나나'는 흔한 단어라 실제 서비스에 쌓인 댓글 중에도 일치하는 게
    // 여럿 나온다(정확히 1건이라는 가정이 위 '딸기케이크'/'초콜릿'처럼 안전한
    // 픽스처 전용 단어가 아니었다). toEqual(exact) 대신 toContain으로
    // 이 테스트가 만든 댓글이 결과에 포함되는지만 확인한다.
    const rows = await searchPublicComments(moderator, '바나나', 50, 0);
    expect(rows.map((r) => r.id)).toContain(commentId);
    const own = rows.find((r) => r.id === commentId);
    expect(own).toMatchObject({ authorUsername: 'acstest_author', postId: publicPostId, postCategorySlug: 'free' });
  });

  it('🔒 비공개 글에 달린 댓글은 안 나온다', async () => {
    const rows = await searchPublicComments(moderator, '비공개글댓글', 50, 0);
    expect(rows).toHaveLength(0);
  });
});
