/**
 * 친구 신청 수락 — §6.5 R1 "친구 수락 시 상호 자동 팔로우".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { acceptFriendRequest, unfriend } from '../../src/relationships.ts';

let owner: pg.Pool;
let requester: string;
let addressee: string;
let stranger: string;
let blockedRequester: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM users WHERE username LIKE 'rel_%'`);
  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('rel_requester'), ('rel_addressee'), ('rel_stranger'), ('rel_blocked_requester') RETURNING id, username`,
  );
  requester = u.rows.find((r) => r.username === 'rel_requester')!.id;
  addressee = u.rows.find((r) => r.username === 'rel_addressee')!.id;
  stranger = u.rows.find((r) => r.username === 'rel_stranger')!.id;
  blockedRequester = u.rows.find((r) => r.username === 'rel_blocked_requester')!.id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM follows WHERE follower_id = ANY($1::uuid[])`, [[requester, addressee, blockedRequester]]);
  await owner?.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[])`, [[requester, addressee, blockedRequester]]);
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1`, [addressee]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'rel_%'`);
  await owner?.end();
});

describe('acceptFriendRequest', () => {
  it('신청 없이 수락하면 NOT_FOUND', async () => {
    expect(await acceptFriendRequest(stranger, requester)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('신청을 수락하면 status가 accepted로 바뀌고 상호 팔로우가 생긴다(§6.5 R1)', async () => {
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`, [requester, addressee]);
    const result = await acceptFriendRequest(addressee, requester);
    expect(result).toEqual({ ok: true });

    const friendship = await owner.query(`SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [requester, addressee]);
    expect(friendship.rows[0].status).toBe('accepted');

    const followBoth = await owner.query(
      `SELECT count(*) FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
      [requester, addressee],
    );
    expect(Number(followBoth.rows[0].count)).toBe(2);
  });

  it('이미 수락된 걸 다시 수락하면(중복 클릭) NOT_FOUND — pending이 아니라서', async () => {
    expect(await acceptFriendRequest(addressee, requester)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('🔒 신청 이후 수신자가 발신자를 차단했으면 수락해도 친구가 되지 않는다(/review에서 발견한 실전 버그)', async () => {
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`, [blockedRequester, addressee]);
    await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [addressee, blockedRequester]);

    const result = await acceptFriendRequest(addressee, blockedRequester);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' }); // 사유 비공개(§10.2) — 진짜 NOT_FOUND와 구분 안 됨

    const friendship = await owner.query(`SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [
      blockedRequester,
      addressee,
    ]);
    expect(friendship.rows[0].status).toBe('pending'); // 'accepted'로 넘어가지 않았다

    const anyFollow = await owner.query(
      `SELECT 1 FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
      [blockedRequester, addressee],
    );
    expect(anyFollow.rowCount).toBe(0); // 팔로우도 안 생겼다
  });
});

/**
 * 🔒 사용자 지시(2026-08, "profile페이지를... 목업UI와 완벽하게 싱크되어야해") —
 * Friends 탭 카드 "···" 메뉴의 "삭제" 액션으로 처음 노출됐다. §6.5 R3 "친구를
 * 끊어도 팔로우는 유지"를 그대로 지키는지가 핵심 — requester/addressee는
 * 위 테스트에서 이미 서로 친구+맞팔 상태다.
 */
describe('unfriend', () => {
  it('친구 관계만 지우고 팔로우는 그대로 둔다(§6.5 R3)', async () => {
    const before = await owner.query(`SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [requester, addressee]);
    expect(before.rows[0]?.status).toBe('accepted');

    await unfriend(requester, addressee);

    const friendship = await owner.query(
      `SELECT 1 FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [requester, addressee],
    );
    expect(friendship.rowCount).toBe(0);

    const followBoth = await owner.query(
      `SELECT count(*) FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
      [requester, addressee],
    );
    expect(Number(followBoth.rows[0].count)).toBe(2); // 팔로우 두 건 다 그대로
  });

  it('친구가 아닌 사이에 unfriend를 불러도 에러 없이 그냥 아무 일도 안 일어난다', async () => {
    await expect(unfriend(requester, stranger)).resolves.not.toThrow();
  });

  it('타인 사이의 친구 관계는 지울 수 없다 — WHERE 절 자체가 본인 관련 행만 대상으로 삼는다', async () => {
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`, [addressee, stranger]);
    await unfriend(requester, stranger); // requester는 이 관계와 무관 — 아무것도 지워지면 안 된다
    const still = await owner.query(`SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [addressee, stranger]);
    expect(still.rowCount).toBe(1);
  });
});
