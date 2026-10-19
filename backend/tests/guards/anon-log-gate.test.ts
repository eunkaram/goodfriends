/**
 * 비로그인의 로그 전용 글 접근 (PRD §4.3, P9 — 0003 마이그레이션에서 수정)
 *
 * 검증: 비로그인은 커뮤니티 글(category_id 있음)은 읽지만, `전체공개`여도
 * 로그 전용 글(category_id 없음)은 읽지 못한다.
 *
 * 이 결함은 0002 커밋 당시 존재했다 — CHECK 제약(§5.2)이 category_id 유무로
 * 커뮤니티/로그를 갈랐지만, RLS 정책에는 그 구분이 반영되지 않아 비로그인이
 * 개인 로그의 전체공개 글을 그대로 읽을 수 있었다. G1/G2는 항상 로그인
 * 사용자로만 검증했기 때문에 이 결함을 잡지 못했다 — 문서 재검토로 발견.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;
let communityPostId: string;
let logPublicPostId: string;
let author: string;

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('exists');

  await owner.query(`DELETE FROM posts WHERE title LIKE 'ANON::%'`);
  await owner.query(`DELETE FROM users WHERE username = 'anon_gate_author'`);

  const u = await owner.query<{ id: string }>(
    `INSERT INTO users (username) VALUES ('anon_gate_author') RETURNING id`,
  );
  author = u.rows[0].id;

  // 🔒 /review에서 posts.category_id에 FK가 추가됨(0018) — 임의 uuid 대신 실제 카테고리를 쓴다.
  const category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;
  const community = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility)
     VALUES ($1, $2, 'ANON::community public', 'public') RETURNING id`,
    [author, category],
  );
  communityPostId = community.rows[0].id;

  const log = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, log_id, title, visibility)
     VALUES ($1, gen_random_uuid(), 'ANON::log public', 'public') RETURNING id`,
    [author],
  );
  logPublicPostId = log.rows[0].id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'ANON::%'`);
  await owner?.query(`DELETE FROM users WHERE username = 'anon_gate_author'`);
  await app?.end();
  await owner?.end();
});

describe('P9 — 비로그인의 로그 전용 글 접근', () => {
  it('🔒 비로그인은 커뮤니티 글을 읽는다', async () => {
    const seen = await withRelationCtx(app, { userId: null }, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'ANON::%'`);
      return r.rows.map((x) => x.id);
    });
    expect(seen).toContain(communityPostId);
  });

  it('🔒 비로그인은 전체공개 로그 글을 읽지 못한다', async () => {
    const seen = await withRelationCtx(app, { userId: null }, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'ANON::%'`);
      return r.rows.map((x) => x.id);
    });
    expect(seen).not.toContain(logPublicPostId);
  });

  it('로그인한 작성자 본인은 자기 로그 글을 읽는다', async () => {
    const seen = await withRelationCtx(app, { userId: author }, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM posts WHERE title LIKE 'ANON::%'`);
      return r.rows.map((x) => x.id);
    });
    expect(seen).toContain(logPublicPostId);
    expect(seen).toContain(communityPostId);
  });
});
