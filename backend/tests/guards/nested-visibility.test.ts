/**
 * UserLog / Album / Photo — 로그인 필수 + §4.1 중첩 규칙(상위 제한 우선)
 *
 * 검증 대상: "앨범이 친구공개면 그 안의 사진이 전체공개여도 친구만 본다" (§4.1)
 * 그리고 §4.3 "로그 홈·앨범 ❌ (비로그인)" — 전체공개여도 비로그인은 못 본다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appPool, ownerPool, withRelationCtx } from '../../src/db.ts';

let owner: pg.Pool;
let app: pg.Pool;
let dave: string;   // 로그 소유자
let erin: string;   // dave의 친구
let frank: string;  // dave와 무관계
let publicAlbumId: string;
let friendsAlbumId: string;
let photoInPublicAlbumPublic: string;
let photoInFriendsAlbumPublic: string; // 앨범이 더 제한적 — 이게 핵심 케이스
let photoInPublicAlbumFriends: string; // 사진 자체가 더 제한적

beforeAll(async () => {
  owner = ownerPool();
  app = appPool('exists');

  await owner.query(`DELETE FROM photos WHERE description LIKE 'NEST::%'`);
  await owner.query(`DELETE FROM albums WHERE title LIKE 'NEST::%'`);
  await owner.query(`DELETE FROM user_logs WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'nest_%')`);
  await owner.query(`DELETE FROM friendships WHERE requester_id IN (SELECT id FROM users WHERE username LIKE 'nest_%')`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'nest_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('nest_dave'), ('nest_erin'), ('nest_frank') RETURNING id, username`,
  );
  dave = u.rows.find((r) => r.username === 'nest_dave')!.id;
  erin = u.rows.find((r) => r.username === 'nest_erin')!.id;
  frank = u.rows.find((r) => r.username === 'nest_frank')!.id;

  await owner.query(`INSERT INTO user_logs (user_id, visibility) VALUES ($1, 'public')`, [dave]);
  await owner.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
    [dave, erin],
  );

  const pubAlbum = await owner.query<{ id: string }>(
    `INSERT INTO albums (log_id, title, visibility) VALUES ($1, 'NEST::public album', 'public') RETURNING id`,
    [dave],
  );
  publicAlbumId = pubAlbum.rows[0].id;

  const friendsAlbum = await owner.query<{ id: string }>(
    `INSERT INTO albums (log_id, title, visibility) VALUES ($1, 'NEST::friends album', 'friends') RETURNING id`,
    [dave],
  );
  friendsAlbumId = friendsAlbum.rows[0].id;

  const p1 = await owner.query<{ id: string }>(
    `INSERT INTO photos (album_id, description, visibility) VALUES ($1, 'NEST::pub-in-pub', 'public') RETURNING id`,
    [publicAlbumId],
  );
  photoInPublicAlbumPublic = p1.rows[0].id;

  // 핵심 케이스: 사진 자체는 전체공개, 앨범이 친구공개 — §4.1에 따라 친구만 봐야 한다
  const p2 = await owner.query<{ id: string }>(
    `INSERT INTO photos (album_id, description, visibility) VALUES ($1, 'NEST::pub-in-friends', 'public') RETURNING id`,
    [friendsAlbumId],
  );
  photoInFriendsAlbumPublic = p2.rows[0].id;

  const p3 = await owner.query<{ id: string }>(
    `INSERT INTO photos (album_id, description, visibility) VALUES ($1, 'NEST::friends-in-pub', 'friends') RETURNING id`,
    [publicAlbumId],
  );
  photoInPublicAlbumFriends = p3.rows[0].id;
});

afterAll(async () => {
  await owner?.query(`DELETE FROM photos WHERE description LIKE 'NEST::%'`);
  await owner?.query(`DELETE FROM albums WHERE title LIKE 'NEST::%'`);
  await owner?.query(`DELETE FROM user_logs WHERE user_id = $1`, [dave]);
  await owner?.query(`DELETE FROM friendships WHERE requester_id = $1`, [dave]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'nest_%'`);
  await app?.end();
  await owner?.end();
});

async function visiblePhotoDescriptions(userId: string | null) {
  return withRelationCtx(app, { userId }, async (c) => {
    const r = await c.query<{ description: string }>(
      `SELECT description FROM photos WHERE description LIKE 'NEST::%'`,
    );
    return r.rows.map((x) => x.description);
  });
}

describe('§4.1 중첩 규칙 — 상위(앨범) 제한이 하위(사진)보다 우선', () => {
  it('🔒 비로그인은 UserLog/Album이 전체공개여도 아무것도 못 본다 (§4.3)', async () => {
    const seen = await visiblePhotoDescriptions(null);
    expect(seen).toHaveLength(0);
  });

  it('무관계(frank)는 전체공개 앨범의 전체공개 사진만 본다', async () => {
    const seen = await visiblePhotoDescriptions(frank);
    expect(seen).toContain('NEST::pub-in-pub');
    expect(seen).not.toContain('NEST::pub-in-friends'); // 앨범이 막음
    expect(seen).not.toContain('NEST::friends-in-pub'); // 사진 자체가 막음
  });

  it('🔒 친구(erin)는 사진이 전체공개여도 앨범이 친구공개면 그 앨범 사진을 본다', async () => {
    const seen = await visiblePhotoDescriptions(erin);
    expect(seen).toContain('NEST::pub-in-pub');
    expect(seen).toContain('NEST::pub-in-friends'); // 앨범이 친구공개 → 친구는 통과
    expect(seen).toContain('NEST::friends-in-pub'); // 사진이 친구공개 → 친구는 통과
  });

  it('소유자(dave)는 전부 본다', async () => {
    const seen = await visiblePhotoDescriptions(dave);
    expect(seen).toHaveLength(3);
  });
});
