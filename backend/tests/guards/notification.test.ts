/** Notification — 수신자 본인만 (§4.5) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;
let nina: string;
let oscar: string;

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('exists');
  await owner.query(`DELETE FROM users WHERE username LIKE 'notif_%'`);
  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('notif_nina'), ('notif_oscar') RETURNING id, username`,
  );
  nina = u.rows.find((r) => r.username === 'notif_nina')!.id;
  oscar = u.rows.find((r) => r.username === 'notif_oscar')!.id;

  await owner.query(
    `INSERT INTO notifications (user_id, actor_id, type, target_type, target_id)
     VALUES ($1, $2, 'comment', 'post', gen_random_uuid())`,
    [nina, oscar],
  );
});

afterAll(async () => {
  await owner?.query(`DELETE FROM notifications WHERE user_id = $1`, [nina]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'notif_%'`);
  await app?.end();
  await owner?.end();
});

describe('Notification', () => {
  it('수신자 본인은 자기 알림을 본다', async () => {
    const seen = await withRelationCtx(app, { userId: nina }, async (c) => {
      const r = await c.query(`SELECT id FROM notifications WHERE user_id = $1`, [nina]);
      return r.rows;
    });
    expect(seen).toHaveLength(1);
  });

  it('🔒 남의 알림은 못 본다 — 유발한 사람(actor)도 예외 아니다', async () => {
    const seen = await withRelationCtx(app, { userId: oscar }, async (c) => {
      const r = await c.query(`SELECT id FROM notifications WHERE user_id = $1`, [nina]);
      return r.rows;
    });
    expect(seen).toHaveLength(0);
  });
});
