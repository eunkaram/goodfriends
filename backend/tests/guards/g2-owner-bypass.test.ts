/**
 * G2 — 소유자 우회 (PRD §10.1-bis)
 *
 * 검증: 앱이 쓰는 역할로 접속했을 때 RLS가 실제로 걸리는가.
 *
 * 실패 시 증상이 없다. 정책이 전혀 안 걸리는데 막힌 줄 알고 안심하는 상태가 된다.
 * 그래서 데이터가 아니라 **설정 자체**를 검증한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, queryRaw, schemaPool } from '../../src/db.ts';

let owner: pg.Pool;    // 슈퍼유저 — 픽스처용
let schema: pg.Pool;   // 테이블 소유자 (비슈퍼유저) — FORCE 검증 대상
let app: pg.Pool;
let secretPostId: string;

beforeAll(async () => {
  owner = ownerPool();
  schema = schemaPool();
  app = appPool('arrays');

  await owner.query(`DELETE FROM posts WHERE title LIKE 'G2::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'g2_%'`);

  const u = await owner.query<{ id: string }>(
    `INSERT INTO users (username) VALUES ('g2_dave') RETURNING id`,
  );
  const dave = u.rows[0].id;

  const p = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, log_id, title, visibility)
     VALUES ($1, gen_random_uuid(), 'G2::private', 'private') RETURNING id`,
    [dave],
  );
  secretPostId = p.rows[0].id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'G2::%'`);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'g2_%'`);
  await app?.end();
  await schema?.end();
  await owner?.end();
});

describe('G2 — 소유자 우회', () => {
  it('posts 에 RLS 가 켜져 있고 FORCE 도 켜져 있다', async () => {
    const r = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'posts'`,
    );
    expect(r.rows[0].relrowsecurity, 'ENABLE ROW LEVEL SECURITY 누락').toBe(true);
    // 🔒 FORCE 가 없으면 테이블 소유자에게 정책이 적용되지 않는다
    expect(r.rows[0].relforcerowsecurity, 'FORCE ROW LEVEL SECURITY 누락').toBe(true);
  });

  it('🔒 앱 역할과 스키마 소유자 모두 슈퍼유저도 BYPASSRLS 도 아니다', async () => {
    const r = await owner.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
       WHERE rolname IN ('community_app_arrays', 'community_app_exists', 'community_schema')`,
    );
    expect(r.rows.length).toBe(3);
    for (const role of r.rows) {
      // FORCE ROW LEVEL SECURITY 는 슈퍼유저를 막지 못한다.
      // 소유자가 슈퍼유저면 RLS가 통째로 무력해지고 증상은 없다.
      expect(role.rolsuper, `${role.rolname} 가 슈퍼유저다`).toBe(false);
      expect(role.rolbypassrls, `${role.rolname} 에 BYPASSRLS 가 있다`).toBe(false);
    }
  });

  it('🔒 테이블 소유자가 슈퍼유저가 아니다 (실측으로 드러난 함정)', async () => {
    const r = await owner.query<{ tableowner: string; rolsuper: boolean }>(
      `SELECT t.tableowner, r.rolsuper
       FROM pg_tables t JOIN pg_roles r ON r.rolname = t.tableowner
       WHERE t.tablename = 'posts'`,
    );
    expect(r.rows[0].tableowner).toBe('community_schema');
    expect(r.rows[0].rolsuper, '소유자가 슈퍼유저면 FORCE 가 무의미하다').toBe(false);
  });

  it('🔒 앱 역할은 컨텍스트 없이 비공개 글을 보지 못한다', async () => {
    const r = await queryRaw<{ id: string }>(
      app,
      `SELECT id FROM posts WHERE title LIKE 'G2::%'`,
    );
    expect(r.rows.map((x) => x.id)).not.toContain(secretPostId);
  });

  it('🔒 테이블 소유자도 FORCE 때문에 정책을 통과해야 한다', async () => {
    // community_schema 는 테이블 소유자이지만 적용될 정책이 없다
    // (정책이 TO community_app_* 로 한정됨). FORCE 가 켜져 있으므로 0행을 본다.
    // 여기서 행이 보이면 FORCE 가 무력한 것이다.
    const r = await schema.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM posts WHERE title LIKE 'G2::%'`,
    );
    expect(Number(r.rows[0].n), 'FORCE ROW LEVEL SECURITY 가 소유자에게 적용되지 않았다').toBe(0);
  });

  it('슈퍼유저는 FORCE 로도 막지 못한다 — 런타임에서 절대 쓰지 않는 이유', async () => {
    // 이건 결함이 아니라 Postgres 의 정의된 동작이다. 문서화를 위해 남긴다.
    // community_owner 로 앱이 붙는 순간 §4.5 의 2계층이 통째로 사라진다.
    const r = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM posts WHERE title LIKE 'G2::%'`,
    );
    expect(Number(r.rows[0].n)).toBeGreaterThan(0);
  });

  it('앱 역할 접속이 실제로 그 역할로 이뤄진다', async () => {
    const r = await queryRaw<{ current_user: string }>(app, `SELECT current_user`);
    expect(r.rows[0].current_user).toBe('community_app_arrays');
  });
});
