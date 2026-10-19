/**
 * ProfileLink — 사용자 지시(2026-08, "링크, 인스타 와 같은 링크를 여러개
 * 입력 받고 싶어"). `user_logs.link_url`/`instagram_url`/`twitter_url`
 * (고정 3개)를 대체하는 임의 개수의 {이름, URL} 목록. 각 링크는 자기
 * 이름을 직접 붙여 저장하고, 화면 공간을 아끼기 위해 각각 추가/수정/삭제가
 * 즉시 반영된다(프로필 편집 모달의 다른 필드들처럼 "저장" 버튼까지 기다리지
 * 않는다) — components/ProfileLinksEditor.tsx 참고.
 */
import { appPool, withRelationCtx } from './db.ts';

export type ProfileLink = { id: string; name: string; url: string };

const pool = appPool('exists');

const MAX_NAME_LENGTH = 30;
const MAX_URL_LENGTH = 300;
const MAX_LINKS_PER_USER = 8; // 화면 공간 절약이 목적이라 넉넉하되 무한하지 않게 제한
const URL_RE = /^https?:\/\//i;

export type ProfileLinkResult = { ok: true; id: string } | { ok: false; error: 'INVALID_INPUT' | 'LIMIT_REACHED' };

function validate(name: string, url: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && url.length > 0 && url.length <= MAX_URL_LENGTH && URL_RE.test(url);
}

/** RLS(app_can_view_tier)가 로그인·차단·공개범위를 전부 걸러준다 — sort_order 순. */
export async function fetchProfileLinks(viewerId: string | null, targetUserId: string): Promise<ProfileLink[]> {
  const r = await withRelationCtx(pool, { userId: viewerId }, (client) =>
    client.query<{ id: string; name: string; url: string }>(
      `SELECT id, name, url FROM profile_links WHERE user_id = $1 ORDER BY sort_order, created_at`,
      [targetUserId],
    ),
  );
  return r.rows;
}

export async function addProfileLink(userId: string, name: string, url: string): Promise<ProfileLinkResult> {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!validate(trimmedName, trimmedUrl)) return { ok: false, error: 'INVALID_INPUT' };

  // 🔒 실전 발견 — 카운트 쿼리를 withRelationCtx 밖에서(appPool('exists')로
  // 직접) 돌렸더니 RLS(profile_links_select)가 app_current_user_id()를
  // 못 봐서(세션 컨텍스트가 없음) 항상 0행으로 보였다 — 8개 제한이
  // 조용히 무제한으로 뚫려 있었다(실제 vitest 테스트가 9번째 추가를
  // 계속 성공시켜서 발견함). INSERT와 같은 RLS 세션 안에서, 같은
  // 트랜잭션으로 묶어야 본인 소유 행이 제대로 보인다.
  const result = await withRelationCtx(pool, { userId }, async (client) => {
    const count = await client.query<{ count: string }>(`SELECT count(*) FROM profile_links WHERE user_id = $1`, [userId]);
    if (Number(count.rows[0].count) >= MAX_LINKS_PER_USER) return null;
    const row = await client.query<{ id: string }>(
      `INSERT INTO profile_links (user_id, name, url, sort_order)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM profile_links WHERE user_id = $1))
       RETURNING id`,
      [userId, trimmedName, trimmedUrl],
    );
    return row.rows[0].id;
  });
  if (result === null) return { ok: false, error: 'LIMIT_REACHED' };
  return { ok: true, id: result };
}

export async function updateProfileLink(userId: string, linkId: string, name: string, url: string): Promise<ProfileLinkResult> {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!validate(trimmedName, trimmedUrl)) return { ok: false, error: 'INVALID_INPUT' };

  await withRelationCtx(pool, { userId }, (client) =>
    // 🔒 RLS(profile_links_update)가 이미 user_id=본인만 허용하지만, deletePost와
    // 같은 이유로 WHERE에 user_id도 명시해 이중 방어한다(§10.2 사유 비공개 원칙).
    client.query(`UPDATE profile_links SET name = $1, url = $2 WHERE id = $3 AND user_id = $4`, [trimmedName, trimmedUrl, linkId, userId]),
  );
  return { ok: true, id: linkId };
}

export async function deleteProfileLink(userId: string, linkId: string): Promise<void> {
  await withRelationCtx(pool, { userId }, (client) => client.query(`DELETE FROM profile_links WHERE id = $1 AND user_id = $2`, [linkId, userId]));
}
