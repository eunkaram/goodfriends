/**
 * 댓글 — comments 테이블 자체엔 RLS가 없다(§13, 0011_comments.sql). posts를
 * 반드시 조인/재조회해서 보호한다는 게 이 테스트의 핵심 검증 대상이다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import { fetchComments, createComment, deleteComment, toggleCommentReaction } from '../../src/comments.ts';

let owner: pg.Pool;
let author: string;
let blockedAuthor: string;
let viewer: string;
/** 알림 테스트용 — post 작성자(author)와 무관한, 답글 알림 대상이 될 제3의 댓글 작성자. */
let commenter2: string;
/** 알림 테스트용 — viewer와 서로 차단된 댓글 작성자(post 작성자와는 차단 관계 아님). */
let blockedCommenter: string;
let publicPostId: string;
let blockedAuthorPostId: string;
let deletedPostId: string;

let category: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'CMT::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'CMT::%'`);
  // 🔒 comment/reaction 알림 생성(createNotification) 추가 이후 — notifications.actor_id에
  // ON DELETE CASCADE가 없어(0010_notification.sql) 유저를 지우기 전에 먼저 치운다(P4 테스트와 같은 패턴).
  await owner.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'cmt_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'cmt_%')`,
  );
  await owner.query(`DELETE FROM users WHERE username LIKE 'cmt_%'`);

  // 🔒 /review에서 posts.category_id에 FK가 추가됨(0018) — 임의 uuid 대신 실제 카테고리를 쓴다.
  category = (await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`)).rows[0].id;

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('cmt_author'), ('cmt_blocked_author'), ('cmt_viewer'), ('cmt_commenter2'), ('cmt_blocked_commenter')
     RETURNING id, username`,
  );
  author = u.rows.find((r) => r.username === 'cmt_author')!.id;
  blockedAuthor = u.rows.find((r) => r.username === 'cmt_blocked_author')!.id;
  viewer = u.rows.find((r) => r.username === 'cmt_viewer')!.id;
  commenter2 = u.rows.find((r) => r.username === 'cmt_commenter2')!.id;
  blockedCommenter = u.rows.find((r) => r.username === 'cmt_blocked_commenter')!.id;

  const p1 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'CMT::public', 'public') RETURNING id`,
    [author, category],
  );
  publicPostId = p1.rows[0].id;

  const p2 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'CMT::blocked author', 'public') RETURNING id`,
    [blockedAuthor, category],
  );
  blockedAuthorPostId = p2.rows[0].id;

  const p3 = await owner.query<{ id: string }>(
    `INSERT INTO posts (author_id, category_id, title, visibility, deleted_at) VALUES ($1, $2, 'CMT::deleted', 'public', now()) RETURNING id`,
    [author, category],
  );
  deletedPostId = p3.rows[0].id;

  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [viewer, blockedAuthor]);
  // viewer와 blockedCommenter는 서로 차단됐지만, blockedCommenter와 post 작성자(author) 사이엔
  // 차단이 없다 — "post 재검증만으로는 못 잡는" 답글 알림 차단 케이스를 재현한다.
  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [viewer, blockedCommenter]);
});

afterAll(async () => {
  await owner?.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'CMT::%')`);
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1`, [viewer]);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'CMT::%'`);
  await owner?.query(
    `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'cmt_%') OR user_id IN (SELECT id FROM users WHERE username LIKE 'cmt_%')`,
  );
  await owner?.query(`DELETE FROM users WHERE username LIKE 'cmt_%'`);
  await owner?.end();
});

describe('createComment', () => {
  it('보이는 글에는 정상적으로 댓글을 단다', async () => {
    const result = await createComment(viewer, publicPostId, '반갑습니다');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = await owner.query(`SELECT body FROM comments WHERE id = $1`, [result.id]);
      expect(row.rows[0].body).toBe('반갑습니다');
    }
  });

  it('빈 본문은 INVALID_INPUT', async () => {
    const result = await createComment(viewer, publicPostId, '   ');
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('🔒 차단된 작성자의 글에는 댓글을 달 수 없다 — comments엔 RLS가 없지만 posts 재검증이 막는다', async () => {
    const result = await createComment(viewer, blockedAuthorPostId, '보여야 안 되는 댓글');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    const row = await owner.query(`SELECT 1 FROM comments WHERE target_id = $1`, [blockedAuthorPostId]);
    expect(row.rowCount).toBe(0);
  });

  it('삭제된 글에는 댓글을 달 수 없다', async () => {
    const result = await createComment(viewer, deletedPostId, '삭제된 글 댓글');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

// 🔒 사용자 지시(2026-08, 1-depth 답글) — "댓글에서 1depth 댓글은 쓸수
// 있어야해... 댓글의 댓글은 댓글을 달수 없도록"
describe('createComment — 1-depth 답글', () => {
  it('최상위 댓글에는 답글을 달 수 있다', async () => {
    const parent = await createComment(author, publicPostId, 'CMT::부모 댓글');
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const reply = await createComment(viewer, publicPostId, 'CMT::답글', parent.id);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const row = await owner.query(`SELECT parent_comment_id FROM comments WHERE id = $1`, [reply.id]);
    expect(row.rows[0].parent_comment_id).toBe(parent.id);
  });

  it('🔒 답글에는 답글을 달 수 없다(2-depth 거부) — 부모의 parent_comment_id가 NULL인지 저장 시점에 재검증한다', async () => {
    const parent = await createComment(author, publicPostId, 'CMT::부모 댓글2');
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const reply = await createComment(viewer, publicPostId, 'CMT::답글2', parent.id);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const nested = await createComment(viewer, publicPostId, 'CMT::답글의 답글', reply.id);
    expect(nested).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('다른 글에 속한 댓글을 부모로 지정하면 거부한다', async () => {
    const otherPost = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'CMT::다른글', 'public') RETURNING id`,
      [author, category],
    );
    const parentOnOtherPost = await createComment(author, otherPost.rows[0].id, 'CMT::다른 글의 댓글');
    expect(parentOnOtherPost.ok).toBe(true);
    if (!parentOnOtherPost.ok) return;
    const result = await createComment(viewer, publicPostId, 'CMT::교차 글 답글 시도', parentOnOtherPost.id);
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('존재하지 않는 부모 댓글 id는 거부한다', async () => {
    const result = await createComment(viewer, publicPostId, 'CMT::없는 부모', '00000000-0000-0000-0000-0000000000ff');
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });
});

describe('fetchComments', () => {
  it('작성 순서대로 반환한다', async () => {
    await createComment(author, publicPostId, '첫 댓글');
    await createComment(viewer, publicPostId, '두 번째 댓글');
    const comments = await fetchComments(viewer, publicPostId);
    const bodies = comments.map((c) => c.body);
    expect(bodies.indexOf('첫 댓글')).toBeLessThan(bodies.indexOf('두 번째 댓글'));
  });

  it('🔒 조회자가 차단한 작성자의 글이면 댓글 자체가 안 보인다(posts 조인 경유 보호)', async () => {
    // owner로 직접 꽂아서 comments에 RLS가 없다는 전제 자체를 확인 — 그래도 조회 시점엔 posts 조인이 걸러야 한다
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'CMT::숨어야 하는 댓글')`, [
      blockedAuthorPostId,
      blockedAuthor,
    ]);
    const comments = await fetchComments(viewer, blockedAuthorPostId);
    expect(comments).toEqual([]);
  });
});

// 🔒 사용자 지시(2026-08, /design-review) — "점 세개부분에는 메뉴형태로
// 수정하기, 삭제하기등이 있으면 좋을것 같아" (삭제만 구현, §10.2 사유 비공개)
describe('deleteComment', () => {
  it('본인 댓글은 삭제된다', async () => {
    const created = await createComment(viewer, publicPostId, 'CMT::지울 댓글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await deleteComment(viewer, created.id);
    expect(result).toEqual({ ok: true });
    const row = await owner.query(`SELECT 1 FROM comments WHERE id = $1`, [created.id]);
    expect(row.rowCount).toBe(0);
  });

  it('🔒 본인 댓글이 아니면 404 — comments엔 RLS가 없어 author_id = $2가 유일한 경계다', async () => {
    const created = await createComment(author, publicPostId, 'CMT::남의 댓글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await deleteComment(viewer, created.id);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    const row = await owner.query(`SELECT 1 FROM comments WHERE id = $1`, [created.id]);
    expect(row.rowCount).toBe(1); // 안 지워졌다
  });

  it('존재하지 않는 댓글은 404', async () => {
    const result = await deleteComment(viewer, '00000000-0000-0000-0000-0000000000ff');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('삭제하면 딸린 반응도 같이 지워진다', async () => {
    const created = await createComment(viewer, publicPostId, 'CMT::반응 달린 댓글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await toggleCommentReaction(author, created.id);
    await deleteComment(viewer, created.id);
    const row = await owner.query(`SELECT 1 FROM reactions WHERE target_type = 'comment' AND target_id = $1`, [created.id]);
    expect(row.rowCount).toBe(0);
  });

  it('🔒 최상위 댓글을 지우면 딸린 답글도 함께 지워지고(ON DELETE CASCADE), 답글의 반응도 같이 정리된다', async () => {
    const parent = await createComment(viewer, publicPostId, 'CMT::지울 부모 댓글');
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const reply = await createComment(author, publicPostId, 'CMT::같이 지워질 답글', parent.id);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    await toggleCommentReaction(viewer, reply.id);

    const result = await deleteComment(viewer, parent.id);
    expect(result).toEqual({ ok: true });

    const parentRow = await owner.query(`SELECT 1 FROM comments WHERE id = $1`, [parent.id]);
    expect(parentRow.rowCount).toBe(0);
    const replyRow = await owner.query(`SELECT 1 FROM comments WHERE id = $1`, [reply.id]);
    expect(replyRow.rowCount).toBe(0);
    const reactionRow = await owner.query(`SELECT 1 FROM reactions WHERE target_type = 'comment' AND target_id = $1`, [reply.id]);
    expect(reactionRow.rowCount).toBe(0);
  });
});

// 🔒 사용자 지시(2026-08, /design-review) — "하트와 댓글만 사용해"
describe('toggleCommentReaction', () => {
  it('처음 누르면 반응이 생기고, 다시 누르면 없어진다(토글)', async () => {
    const created = await createComment(author, publicPostId, 'CMT::반응 토글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await toggleCommentReaction(viewer, created.id);
    expect(first).toEqual({ ok: true, reacted: true });
    const afterFirst = await owner.query(`SELECT emoticon_type FROM reactions WHERE target_type = 'comment' AND target_id = $1 AND user_id = $2`, [
      created.id,
      viewer,
    ]);
    expect(afterFirst.rows[0].emoticon_type).toBe('empathy');

    const second = await toggleCommentReaction(viewer, created.id);
    expect(second).toEqual({ ok: true, reacted: false });
    const afterSecond = await owner.query(`SELECT 1 FROM reactions WHERE target_type = 'comment' AND target_id = $1 AND user_id = $2`, [
      created.id,
      viewer,
    ]);
    expect(afterSecond.rowCount).toBe(0);
  });

  it('🔒 차단된 작성자 글의 댓글에는 반응할 수 없다 — 댓글이 속한 글을 재검증한다(P4와 같은 원칙)', async () => {
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'CMT::반응 못 다는 댓글')`, [
      blockedAuthorPostId,
      blockedAuthor,
    ]);
    const row = await owner.query<{ id: string }>(`SELECT id FROM comments WHERE target_id = $1 AND body = 'CMT::반응 못 다는 댓글'`, [
      blockedAuthorPostId,
    ]);
    const result = await toggleCommentReaction(viewer, row.rows[0].id);
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('존재하지 않는 댓글은 404', async () => {
    const result = await toggleCommentReaction(viewer, '00000000-0000-0000-0000-0000000000ff');
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('토글-ON에서만 알림이 가고, 토글-OFF(해제)는 알림을 만들지 않는다', async () => {
    const created = await createComment(author, publicPostId, 'CMT::반응 알림 대상 댓글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const on = await toggleCommentReaction(viewer, created.id);
    expect(on).toEqual({ ok: true, reacted: true });
    const afterOn = await owner.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'reaction' AND target_type = 'comment' AND target_id = $3`,
      [author, viewer, created.id],
    );
    expect(afterOn.rowCount).toBe(1);

    const off = await toggleCommentReaction(viewer, created.id);
    expect(off).toEqual({ ok: true, reacted: false });
    const afterOff = await owner.query(
      `SELECT count(*) FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'reaction' AND target_type = 'comment' AND target_id = $3`,
      [author, viewer, created.id],
    );
    expect(Number(afterOff.rows[0].count)).toBe(1); // OFF에서 새로 추가되지 않았다 — 여전히 1건
  });
});

// 🔒 사용자 지시(2026-08-28) — comment/reaction 알림 신설(notifications는 0010에서
// 스키마만 있었고 follow만 실제로 insert했다). createNotification(notifications.ts)
// 공통 헬퍼가 자기알림 스킵 + app_is_blocked_with() 양방향 차단 재확인을 담당한다.
describe('알림 — 댓글 작성 시 글 작성자에게', () => {
  it('타인이 댓글을 달면 글 작성자에게 comment 알림이 간다', async () => {
    const created = await createComment(viewer, publicPostId, 'CMT::알림 트리거 댓글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = await owner.query(
      `SELECT actor_id, target_type, target_id FROM notifications WHERE user_id = $1 AND type = 'comment' AND target_id = $2`,
      [author, created.id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].actor_id).toBe(viewer);
    expect(row.rows[0].target_type).toBe('comment');
  });

  it('🔒 본인 글에 본인이 댓글을 달면 알림이 생기지 않는다(자기 알림 스킵)', async () => {
    const created = await createComment(author, publicPostId, 'CMT::본인 댓글');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND actor_id = $1 AND target_id = $2`, [author, created.id]);
    expect(row.rowCount).toBe(0);
  });
});

describe('알림 — 답글은 부모 댓글 작성자에게만(글 작성자에겐 안 감)', () => {
  it('답글을 달면 부모 댓글 작성자에게 알림이 가고, 글 작성자(제3자)에게는 이 답글로 인한 알림이 안 간다', async () => {
    const parent = await createComment(commenter2, publicPostId, 'CMT::제3자 부모 댓글');
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    const reply = await createComment(viewer, publicPostId, 'CMT::제3자에게 가는 답글', parent.id);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;

    const toParentAuthor = await owner.query(
      `SELECT actor_id FROM notifications WHERE user_id = $1 AND type = 'comment' AND target_id = $2`,
      [commenter2, reply.id],
    );
    expect(toParentAuthor.rowCount).toBe(1);
    expect(toParentAuthor.rows[0].actor_id).toBe(viewer);

    // 이 답글이 만든 알림 중 글 작성자(author) 대상은 없어야 한다 — "부모 댓글 작성자에게만" 정책.
    const toPostAuthor = await owner.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'comment' AND target_id = $2`,
      [author, reply.id],
    );
    expect(toPostAuthor.rowCount).toBe(0);
  });

  it('🔒 답글 작성자와 부모 댓글 작성자가 서로 차단 관계면 알림이 안 간다 — post 재검증만으론 못 잡는 경로', async () => {
    // blockedCommenter는 post 작성자(author)와는 차단 관계가 아니므로 댓글 자체는 정상 작성된다.
    const parent = await createComment(blockedCommenter, publicPostId, 'CMT::차단된 부모 댓글 작성자');
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    // viewer는 blockedCommenter를 차단했다 — post(author) 기준 재검증은 통과하지만
    // 답글 알림 수신자(blockedCommenter)와는 차단 관계다. createNotification의
    // app_is_blocked_with() 재확인이 이 경로를 막아야 한다.
    const reply = await createComment(viewer, publicPostId, 'CMT::차단된 부모에게 가면 안 되는 답글', parent.id);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;

    const row = await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND target_id = $2`, [blockedCommenter, reply.id]);
    expect(row.rowCount).toBe(0);
  });
});

describe('🔒 실전 발견 — comments.author_id ON DELETE CASCADE(0024)', () => {
  it('댓글을 쓴 계정도 탈퇴(hard delete)할 수 있다 — FK가 삭제를 막지 않는다', async () => {
    const u = await owner.query<{ id: string }>(`INSERT INTO users (username) VALUES ('cmt_ephemeral') RETURNING id`);
    const ephemeralId = u.rows[0].id;
    const result = await createComment(ephemeralId, publicPostId, 'CMT::탈퇴 테스트용 댓글');
    if (!result.ok) throw new Error('setup failed');

    // §6.1 deleteAccount()와 같은 원칙 — 하드 삭제. 0011이 처음 만들 때 author_id에
    // ON DELETE CASCADE가 빠져 있어서, 댓글을 하나라도 쓴 계정은 탈퇴가 FK 위반으로
    // 조용히 실패했었다(실브라우저 검증 중 실제로 겪음 — messages.sender_id(0023)와
    // 정확히 같은 패턴의 재발).
    await expect(owner.query(`DELETE FROM users WHERE id = $1`, [ephemeralId])).resolves.not.toThrow();

    const remaining = await owner.query(`SELECT 1 FROM comments WHERE author_id = $1`, [ephemeralId]);
    expect(remaining.rowCount).toBe(0);
  });
});
