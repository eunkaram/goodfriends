/**
 * P4 — 의도 실행 직전 권한 재검증 (§11.9.2)
 *
 * 검증: 저장 시점엔 허용됐던 대상이 실행 시점엔 차단·삭제·비공개로 바뀌어
 * 있으면 실행이 막혀야 한다. "화면상 정상으로 보인다"가 아니라 DB에 실제로
 * 행이 안 생기는지까지 확인한다 — §4.5 함정과 같은 종류의 결함이다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type pg from 'pg';
import { createHttpServer } from '../../src/intent-http.ts';
import { ownerPool } from '../../src/db.ts';
import { closeRedis } from '../../src/redis.ts';
import { createSession, destroySession, SESSION_COOKIE } from '../../src/session.ts';

let server: Server;
let baseUrl: string;
let owner: pg.Pool;

let actor: string; // 반응·저장·친구신청·팔로우를 실행하는 사람
let author: string; // 공개 글 작성자
let blockedAuthor: string; // actor가 차단할 작성자
let friendTarget: string; // 친구신청/팔로우 대상(무관계)
let blockedTarget: string; // actor가 차단한 대상(친구신청/팔로우 재검증용)

let publicPostId: string;
let publicPostPublicId: string;
let blockedAuthorPostId: string;
let deletedPostId: string;
let privatePostId: string; // 공개범위 변경 재현용 — 원래 public이었다가 private로 바뀐 걸 가정
let actorOwnPostId: string; // 알림 테스트용 — actor 본인 글(자기 반응 알림 스킵 확인)

let actorToken: string;

let category: string;

function sessionCookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

async function execute(intent: Record<string, unknown>, confirmed = false, token = actorToken) {
  return fetch(`${baseUrl}/api/intent/execute`, {
    method: 'POST',
    headers: sessionCookieHeader(token),
    body: JSON.stringify({ intent, confirmed }),
  });
}

beforeAll(async () => {
  server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;

  owner = ownerPool();
  await owner.query(`DELETE FROM posts WHERE title LIKE 'P4::%'`);
  await owner.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'p4_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'p4_%')`,
  );
  await owner.query(`DELETE FROM users WHERE username LIKE 'p4_%'`);

  // 🔒 /review에서 posts.category_id에 FK가 추가됨(0018) — 임의 uuid 대신 실제 카테고리를 쓴다.
  category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('p4_actor'), ('p4_author'), ('p4_blocked_author'), ('p4_friend_target'), ('p4_blocked_target')
     RETURNING id, username`,
  );
  actor = u.rows.find((r) => r.username === 'p4_actor')!.id;
  author = u.rows.find((r) => r.username === 'p4_author')!.id;
  blockedAuthor = u.rows.find((r) => r.username === 'p4_blocked_author')!.id;
  friendTarget = u.rows.find((r) => r.username === 'p4_friend_target')!.id;
  blockedTarget = u.rows.find((r) => r.username === 'p4_blocked_target')!.id;

  const p1 = await owner.query<{ id: string; public_id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'P4::public', 'public') RETURNING id, public_id`,
    [author, category],
  );
  publicPostId = p1.rows[0].id;
  publicPostPublicId = p1.rows[0].public_id;

  const p2 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'P4::blocked author', 'public') RETURNING id`,
    [blockedAuthor, category],
  );
  blockedAuthorPostId = p2.rows[0].id;

  const p3 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility, deleted_at) VALUES ($1, $2, 'P4::deleted', 'public', now()) RETURNING id`,
    [author, category],
  );
  deletedPostId = p3.rows[0].id;

  const p4 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, gen_random_uuid(), 'P4::private', 'private') RETURNING id`,
    [author],
  );
  privatePostId = p4.rows[0].id;

  const p5 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'P4::actor own', 'public') RETURNING id`,
    [actor, category],
  );
  actorOwnPostId = p5.rows[0].id;

  // actor가 blockedAuthor / blockedTarget을 차단 — "저장 시점 이후 차단" 재현
  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2), ($1, $3)`, [actor, blockedAuthor, blockedTarget]);

  actorToken = (await createSession(actor)).token;
});

afterAll(async () => {
  await destroySession(actorToken);
  await owner?.query(`DELETE FROM reactions WHERE target_id IN ($1, $2, $3, $4, $5)`, [
    publicPostId,
    blockedAuthorPostId,
    deletedPostId,
    privatePostId,
    actorOwnPostId,
  ]);
  await owner?.query(`DELETE FROM saved_posts WHERE user_id = $1`, [actor]);
  await owner?.query(`DELETE FROM friendships WHERE requester_id = $1`, [actor]);
  await owner?.query(`DELETE FROM follows WHERE follower_id = $1`, [actor]);
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1`, [actor]);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'P4::%'`);
  // 🔒 사용자 지시(2026-08-26, notifications 백엔드 연동) — follow 케이스가
  // 이제 notifications도 insert한다(src/intent-execution.ts). actor_id에
  // ON DELETE CASCADE가 없어(0010_notification.sql) 유저를 지우기 전에 먼저 치운다.
  await owner?.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'p4_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'p4_%')`,
  );
  await owner?.query(`DELETE FROM users WHERE username LIKE 'p4_%'`);
  await owner?.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRedis();
});

describe('P4 — 세션 없이는 401', () => {
  it('세션 쿠키 없이 실행 요청하면 401', async () => {
    const res = await fetch(`${baseUrl}/api/intent/execute`, {
      method: 'POST',
      body: JSON.stringify({ intent: { action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'cheer' } }),
    });
    expect(res.status).toBe(401);
  });
});

describe('P4 — reaction (자동 실행)', () => {
  it('정상 대상이면 즉시 실행되고 reactions에 행이 생긴다', async () => {
    const res = await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'cheer' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'executed', reaction: 'cheer' });
    const row = await owner.query(`SELECT emoticon_type FROM reactions WHERE target_id = $1 AND user_id = $2`, [publicPostId, actor]);
    expect(row.rows[0]?.emoticon_type).toBe('cheer');
  });

  it('🔒 같은 반응을 다시 누르면 해제된다(§11.10.3 "취소")', async () => {
    const res = await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'cheer' });
    expect(await res.json()).toEqual({ status: 'executed', reaction: null });
    const row = await owner.query(`SELECT 1 FROM reactions WHERE target_id = $1 AND user_id = $2`, [publicPostId, actor]);
    expect(row.rowCount).toBe(0);
  });

  it('다른 반응을 누르면 교체된다(§11.10.3 "1인 1반응")', async () => {
    await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'cheer' });
    const res = await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'funny' });
    expect(await res.json()).toEqual({ status: 'executed', reaction: 'funny' });
    const row = await owner.query(`SELECT emoticon_type FROM reactions WHERE target_id = $1 AND user_id = $2`, [publicPostId, actor]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].emoticon_type).toBe('funny');
  });

  it('🔒 저장 시점 이후 작성자가 차단됐으면 blocked — reactions에 행이 생기지 않는다', async () => {
    const res = await execute({ action: 'reaction', targetId: blockedAuthorPostId, returnTo: '/', emoticonType: 'empathy' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'blocked' });
    const row = await owner.query(`SELECT 1 FROM reactions WHERE target_id = $1 AND user_id = $2`, [blockedAuthorPostId, actor]);
    expect(row.rowCount).toBe(0);
  });

  it('🔒 저장 시점 이후 글이 삭제됐으면 blocked', async () => {
    const res = await execute({ action: 'reaction', targetId: deletedPostId, returnTo: '/', emoticonType: 'sad' });
    expect(await res.json()).toEqual({ status: 'blocked' });
  });

  it('🔒 저장 시점 이후 공개범위가 좁아졌으면(private) 제3자에겐 blocked', async () => {
    const res = await execute({ action: 'reaction', targetId: privatePostId, returnTo: '/', emoticonType: 'surprise' });
    expect(await res.json()).toEqual({ status: 'blocked' });
  });

  it('emoticonType 없이 오면 blocked', async () => {
    const res = await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/' });
    expect(await res.json()).toEqual({ status: 'blocked' });
  });
});

// 🔒 사용자 지시(2026-08-28) — comment/reaction 알림 신설. createNotification
// (notifications.ts)이 자기알림 스킵 + 양방향 차단 재확인을 공통으로 담당한다.
describe('P4 — reaction 알림', () => {
  it('토글-ON에서 글 작성자에게 reaction 알림이 가고, 토글-OFF(해제)는 알림을 추가하지 않는다', async () => {
    await owner.query(`DELETE FROM reactions WHERE target_id = $1 AND user_id = $2`, [publicPostId, actor]);
    await owner.query(`DELETE FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'reaction' AND target_id = $3`, [
      author,
      actor,
      publicPostId,
    ]);

    const on = await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'cheer' });
    expect(await on.json()).toEqual({ status: 'executed', reaction: 'cheer' });
    const afterOn = await owner.query(
      `SELECT count(*) FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'reaction' AND target_type = 'post' AND target_id = $3`,
      [author, actor, publicPostId],
    );
    expect(Number(afterOn.rows[0].count)).toBe(1);

    const off = await execute({ action: 'reaction', targetId: publicPostId, returnTo: '/', emoticonType: 'cheer' });
    expect(await off.json()).toEqual({ status: 'executed', reaction: null });
    const afterOff = await owner.query(
      `SELECT count(*) FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'reaction' AND target_type = 'post' AND target_id = $3`,
      [author, actor, publicPostId],
    );
    expect(Number(afterOff.rows[0].count)).toBe(1); // OFF(해제)에서 새로 생기지 않았다 — 여전히 1건
  });

  it('🔒 차단된 작성자 글에는 반응 자체가 blocked라 알림도 생기지 않는다', async () => {
    await execute({ action: 'reaction', targetId: blockedAuthorPostId, returnTo: '/', emoticonType: 'empathy' });
    const row = await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'reaction'`, [
      blockedAuthor,
      actor,
    ]);
    expect(row.rowCount).toBe(0);
  });

  it('🔒 본인 글에 본인이 반응해도 알림이 생기지 않는다(자기 알림 스킵)', async () => {
    const res = await execute({ action: 'reaction', targetId: actorOwnPostId, returnTo: '/', emoticonType: 'cheer' });
    expect(await res.json()).toEqual({ status: 'executed', reaction: 'cheer' });
    const row = await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND actor_id = $1 AND target_id = $2`, [
      actor,
      actorOwnPostId,
    ]);
    expect(row.rowCount).toBe(0);
  });
});

describe('🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을 처리하는데 계속 에러가 뜬다") — targetId로 public_id를 보내도 동작해야 한다', () => {
  it('targetId가 public_id(uuid 아님)여도 내부 id로 해석돼 정상 실행된다', async () => {
    const res = await execute({ action: 'reaction', targetId: publicPostPublicId, returnTo: '/', emoticonType: 'helpful' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'executed', reaction: 'helpful' });
    const row = await owner.query(`SELECT emoticon_type FROM reactions WHERE target_id = $1 AND user_id = $2`, [publicPostId, actor]);
    expect(row.rows[0]?.emoticon_type).toBe('helpful');
    await owner.query(`DELETE FROM reactions WHERE target_id = $1 AND user_id = $2`, [publicPostId, actor]);
  });

  it('존재하지 않는 public_id는 조용히 통과되지 않고 그대로 400', async () => {
    const res = await execute({ action: 'reaction', targetId: 'doesNotExist', returnTo: '/', emoticonType: 'cheer' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });

  it('friend_request/follow는 유저 대상이라 public_id 해석 없이 그대로 uuid 검증만 받는다', async () => {
    const res = await execute({ action: 'friend_request', targetId: publicPostPublicId, returnTo: '/' }, true);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });
});

describe('P4 — save (자동 실행)', () => {
  it('정상 대상이면 saved_posts에 행이 생긴다', async () => {
    const res = await execute({ action: 'save', targetId: publicPostId, returnTo: '/' });
    expect(await res.json()).toEqual({ status: 'executed' });
    const row = await owner.query(`SELECT 1 FROM saved_posts WHERE user_id = $1 AND post_id = $2`, [actor, publicPostId]);
    expect(row.rowCount).toBe(1);
  });

  it('🔒 차단된 작성자 글이면 blocked, saved_posts에 행 없음', async () => {
    const res = await execute({ action: 'save', targetId: blockedAuthorPostId, returnTo: '/' });
    expect(await res.json()).toEqual({ status: 'blocked' });
    const row = await owner.query(`SELECT 1 FROM saved_posts WHERE user_id = $1 AND post_id = $2`, [actor, blockedAuthorPostId]);
    expect(row.rowCount).toBe(0);
  });

  // §26(모바일) — resolveSessionToken()이 쿠키 대신 Authorization: Bearer도 받는다.
  // 이 라우트(P4 전체)는 원래 헤더 인증 전환 라운드에서 빠졌던 파일(src/http-server.ts)이라
  // 별도로 확인한다(2026-08-29 회귀 발견·수정). save는 ON CONFLICT DO NOTHING이라
  // 이미 저장된 publicPostId에 다시 실행해도 상태를 어지럽히지 않는다.
  it('Authorization: Bearer 헤더만으로도(쿠키 없이) 실행된다', async () => {
    const res = await fetch(`${baseUrl}/api/intent/execute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${actorToken}` },
      body: JSON.stringify({ intent: { action: 'save', targetId: publicPostId, returnTo: '/' }, confirmed: false }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'executed' });
  });
});

describe('P4 — comment (초안 복원만, 자동 제출 금지)', () => {
  it('DB에 아무것도 쓰지 않고 draft만 돌려준다', async () => {
    const res = await execute({ action: 'comment', targetId: publicPostId, returnTo: '/', draft: '이거 저장해뒀던 초안' });
    expect(await res.json()).toEqual({ status: 'draft_only', draft: '이거 저장해뒀던 초안', targetId: publicPostId });
    // 전역 COUNT는 다른 테스트 파일이 동시에 진짜 댓글을 쓰면서 흔들릴 수 있다 —
    // 이 intent의 대상(publicPostId)에 한정해서만 "아무것도 안 썼다"를 확인한다.
    const forThisPost = await owner.query(`SELECT count(*) FROM comments WHERE target_id = $1`, [publicPostId]);
    expect(Number(forThisPost.rows[0].count)).toBe(0);
  });
});

describe('P4 — friend_request (확인 후 실행)', () => {
  it('confirmed 없이는 confirm_required — friendships에 행이 생기지 않는다', async () => {
    const res = await execute({ action: 'friend_request', targetId: friendTarget, returnTo: '/' }, false);
    expect(await res.json()).toEqual({ status: 'confirm_required' });
    const row = await owner.query(`SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [actor, friendTarget]);
    expect(row.rowCount).toBe(0);
  });

  it('confirmed=true면 실행되고 friendships에 pending 행이 생긴다', async () => {
    const res = await execute({ action: 'friend_request', targetId: friendTarget, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'executed' });
    const row = await owner.query(`SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [actor, friendTarget]);
    expect(row.rows[0]?.status).toBe('pending');
  });

  it('이미 신청된 관계에 다시 실행해도 에러 없이 멱등하게 성공한다', async () => {
    const res = await execute({ action: 'friend_request', targetId: friendTarget, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'executed' });
  });

  it('🔒 저장 시점 이후 차단됐으면 confirmed=true여도 blocked', async () => {
    const res = await execute({ action: 'friend_request', targetId: blockedTarget, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'blocked' });
    const row = await owner.query(`SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [actor, blockedTarget]);
    expect(row.rowCount).toBe(0);
  });

  it('본인을 대상으로 하면 blocked', async () => {
    const res = await execute({ action: 'friend_request', targetId: actor, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'blocked' });
  });
});

describe('P4 — follow (확인 후 실행)', () => {
  it('confirmed 없이는 confirm_required — follows에 행이 생기지 않는다', async () => {
    const res = await execute({ action: 'follow', targetId: friendTarget, returnTo: '/' }, false);
    expect(await res.json()).toEqual({ status: 'confirm_required' });
    const row = await owner.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [actor, friendTarget]);
    expect(row.rowCount).toBe(0);
  });

  it('confirmed=true면 실행되고 follows에 행이 생긴다', async () => {
    const res = await execute({ action: 'follow', targetId: friendTarget, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'executed' });
    const row = await owner.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [actor, friendTarget]);
    expect(row.rowCount).toBe(1);
  });

  it('이미 팔로우 중이면 에러 없이 멱등하게 성공한다', async () => {
    const res = await execute({ action: 'follow', targetId: friendTarget, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'executed' });
  });

  it('🔒 저장 시점 이후 차단됐으면 confirmed=true여도 blocked — follows RLS가 직접 걸러낸다', async () => {
    const res = await execute({ action: 'follow', targetId: blockedTarget, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'blocked' });
    const row = await owner.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [actor, blockedTarget]);
    expect(row.rowCount).toBe(0);
  });

  it('본인을 대상으로 하면 blocked', async () => {
    const res = await execute({ action: 'follow', targetId: actor, returnTo: '/' }, true);
    expect(await res.json()).toEqual({ status: 'blocked' });
  });
});
