/**
 * ProfileField — 항목별 공개설정 (§6.4). app_can_view_tier 재사용 스모크 테스트.
 * 중첩/차단/비로그인 로직은 nested-visibility.test.ts에서 이미 검증했으므로
 * 여기서는 "같은 헬퍼가 다른 테이블에도 정확히 적용되는지"만 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;
let grace: string;
let heidi: string; // 무관계

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('exists');
  await owner.query(`DELETE FROM users WHERE username LIKE 'pf_%'`);
  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('pf_grace'), ('pf_heidi') RETURNING id, username`,
  );
  grace = u.rows.find((r) => r.username === 'pf_grace')!.id;
  heidi = u.rows.find((r) => r.username === 'pf_heidi')!.id;

  await owner.query(
    `INSERT INTO profile_fields (user_id, key, value, visibility) VALUES
     ($1, 'intro', 'public intro', 'public'),
     ($1, 'mobile', '010-secret', 'private')`,
    [grace],
  );
});

afterAll(async () => {
  await owner?.query(`DELETE FROM profile_fields WHERE user_id = $1`, [grace]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'pf_%'`);
  await app?.end();
  await owner?.end();
});

describe('ProfileField', () => {
  it('무관계는 public 필드만 본다', async () => {
    const seen = await withRelationCtx(app, { userId: heidi }, async (c) => {
      const r = await c.query<{ key: string }>(`SELECT key FROM profile_fields WHERE user_id = $1`, [grace]);
      return r.rows.map((x) => x.key);
    });
    expect(seen).toEqual(['intro']);
  });

  it('본인은 private 필드까지 본다', async () => {
    const seen = await withRelationCtx(app, { userId: grace }, async (c) => {
      const r = await c.query<{ key: string }>(`SELECT key FROM profile_fields WHERE user_id = $1`, [grace]);
      return r.rows.map((x) => x.key).sort();
    });
    expect(seen).toEqual(['intro', 'mobile']);
  });

  it('🔒 비로그인은 아무 필드도 못 본다', async () => {
    const seen = await withRelationCtx(app, { userId: null }, async (c) => {
      const r = await c.query<{ key: string }>(`SELECT key FROM profile_fields WHERE user_id = $1`, [grace]);
      return r.rows;
    });
    expect(seen).toHaveLength(0);
  });
});
