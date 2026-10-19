/**
 * ProfileLink — 사용자 지시(2026-08, "링크, 인스타 와 같은 링크를 여러개
 * 입력 받고 싶어"). 고정 3필드(링크/인스타그램/트위터)를 대체하는 임의
 * 개수 목록. RLS(app_can_view_tier)가 user_logs와 같은 공개범위를 쓴다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { fetchProfileLinks, addProfileLink, updateProfileLink, deleteProfileLink } from '../../src/profile-links.ts';

let owner: pg.Pool;
let alice: string; // 링크 소유자
let bob: string; // 무관계 뷰어(공개 링크는 봐야 함)
let carol: string; // alice가 차단(안 봐야 함)

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM users WHERE username LIKE 'plink_%'`);
  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('plink_alice'), ('plink_bob'), ('plink_carol') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'plink_alice')!.id;
  bob = u.rows.find((r) => r.username === 'plink_bob')!.id;
  carol = u.rows.find((r) => r.username === 'plink_carol')!.id;
  await owner.query(`INSERT INTO user_logs (user_id) VALUES ($1), ($2), ($3)`, [alice, bob, carol]);
  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [alice, carol]);
});

afterAll(async () => {
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1`, [alice]);
  await owner?.query(`DELETE FROM user_logs WHERE user_id = ANY($1::uuid[])`, [[alice, bob, carol]]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'plink_%'`);
  await owner?.end();
});

describe('addProfileLink', () => {
  it('정상 입력이면 저장되고 id를 돌려준다', async () => {
    const result = await addProfileLink(alice, 'Instagram', 'https://instagram.com/plink_alice');
    expect(result.ok).toBe(true);
    const links = await fetchProfileLinks(alice, alice);
    expect(links).toEqual([{ id: (result as { ok: true; id: string }).id, name: 'Instagram', url: 'https://instagram.com/plink_alice' }]);
  });

  it('javascript: 스킴은 거부한다(<a href> XSS 방지 경계)', async () => {
    expect(await addProfileLink(alice, '악성', 'javascript:alert(1)')).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('스킴 없는 URL은 거부한다', async () => {
    expect(await addProfileLink(alice, '링크', 'reafy.example')).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('이름이나 URL이 비어 있으면 거부한다', async () => {
    expect(await addProfileLink(alice, '', 'https://reafy.example')).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(await addProfileLink(alice, '이름', '')).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('추가 순서대로 sort_order가 매겨져 목록도 그 순서로 온다', async () => {
    await addProfileLink(alice, 'GitHub', 'https://github.com/plink_alice');
    const links = await fetchProfileLinks(alice, alice);
    expect(links.map((l) => l.name)).toEqual(['Instagram', 'GitHub']);
  });

  it('최대 개수(8개)를 넘기면 LIMIT_REACHED', async () => {
    // 이미 2개 있으므로 6개 더 추가해 정확히 8개를 채운다.
    for (let i = 0; i < 6; i++) {
      const r = await addProfileLink(alice, `링크${i}`, `https://reafy.example/${i}`);
      expect(r.ok).toBe(true);
    }
    expect(await addProfileLink(alice, '아홉번째', 'https://reafy.example/9')).toEqual({ ok: false, error: 'LIMIT_REACHED' });
    expect((await fetchProfileLinks(alice, alice)).length).toBe(8);
  });
});

describe('updateProfileLink / deleteProfileLink', () => {
  it('본인 링크는 수정된다', async () => {
    const created = await addProfileLink(bob, '옛 이름', 'https://old.example');
    const id = (created as { ok: true; id: string }).id;
    expect(await updateProfileLink(bob, id, '새 이름', 'https://new.example')).toEqual({ ok: true, id });
    const links = await fetchProfileLinks(bob, bob);
    expect(links.find((l) => l.id === id)).toEqual({ id, name: '새 이름', url: 'https://new.example' });
  });

  it('타인의 링크는 WHERE user_id 조건 때문에 수정도 삭제도 안 된다', async () => {
    const created = await addProfileLink(bob, '밥의 링크', 'https://bob.example');
    const id = (created as { ok: true; id: string }).id;
    await updateProfileLink(carol, id, '카롤이 바꿈', 'https://carol.example');
    const links = await fetchProfileLinks(bob, bob);
    expect(links.find((l) => l.id === id)?.name).toBe('밥의 링크'); // 안 바뀜

    await deleteProfileLink(carol, id);
    expect((await fetchProfileLinks(bob, bob)).find((l) => l.id === id)).toBeDefined(); // 안 지워짐
  });

  it('본인 링크는 삭제된다', async () => {
    const created = await addProfileLink(bob, '지울 링크', 'https://delete-me.example');
    const id = (created as { ok: true; id: string }).id;
    await deleteProfileLink(bob, id);
    expect((await fetchProfileLinks(bob, bob)).find((l) => l.id === id)).toBeUndefined();
  });
});

describe('fetchProfileLinks — RLS(app_can_view_tier, 공개범위 public 기본값)', () => {
  it('무관계 뷰어도 공개 링크를 볼 수 있다', async () => {
    const links = await fetchProfileLinks(bob, alice);
    expect(links.length).toBeGreaterThan(0);
  });

  it('차단된 뷰어는 링크를 하나도 못 본다', async () => {
    const links = await fetchProfileLinks(carol, alice);
    expect(links).toEqual([]);
  });

  it('비로그인 뷰어는 아무 링크도 못 본다(§4.3, user_logs와 같은 로그인 필수 원칙)', async () => {
    const links = await fetchProfileLinks(null, alice);
    expect(links).toEqual([]);
  });
});
