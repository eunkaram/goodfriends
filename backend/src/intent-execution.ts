/**
 * 의도 실행 — §11.9.2 P4 — goodfriends 이관본(푸시 알림은 1차 스코프 밖).
 *
 * intent-session.ts(T22)가 저장·소비를 맡고, 이 파일이 그 뒤를 잇는다: 로그인
 * 직후 저장된 의도를 실제로 수행하되, **실행 직전 §4.5 권한을 다시 통과시킨다**
 * — 저장 시점과 실행 시점 사이에 차단·삭제·공개범위 변경이 있을 수 있어서다.
 *
 * 🔒 사유는 밝히지 않는다 (§10.2와 같은 원칙) — 'blocked' 응답은 "차단당함"과
 * "대상이 삭제됨"을 구분하지 않는다. 구분해서 알려주면 차단 여부가 새어나간다.
 */
import { appPool, withRelationCtx } from './db.ts';
import { createNotification } from './notifications.ts';
import type { Intent, EmoticonType } from './intent-session.ts';

export type ExecuteResult =
  | { status: 'executed'; reaction?: EmoticonType | null }
  | { status: 'confirm_required' }
  | { status: 'draft_only'; draft?: string; targetId: string }
  | { status: 'blocked' };

const pool = appPool('exists');

function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === code;
}

/**
 * friendships/follows/blocks가 아닌 다른 유저 대상 행동(친구신청·팔로우)의 재검증.
 * friendships는 posts 정책이 참조하므로 자기 자신엔 RLS를 걸지 않는다(불변식 12) —
 * 그래서 차단 여부를 app_is_blocked_with()로 직접 확인한다. follows는 RLS를 걸었으므로
 * INSERT 자체가 재검증을 겸하지만, 같은 실패를 조기에 걸러 에러 하나로 통일한다.
 */
async function isBlockedWith(userId: string, otherId: string): Promise<boolean> {
  const result = await withRelationCtx(pool, { userId }, (client) =>
    client.query<{ blocked: boolean }>('SELECT app_is_blocked_with($1) AS blocked', [otherId]),
  );
  return result.rows[0]?.blocked ?? false;
}

/**
 * @param confirmed friend_request·follow는 §11.9.2 "확인 후 실행" 대상이라
 *   기본은 confirm_required를 반환한다. 사용자가 확인 UI에서 동의한 뒤
 *   confirmed=true로 다시 호출해야 실제로 실행된다.
 */
export async function executeIntent(userId: string, intent: Intent, confirmed = false): Promise<ExecuteResult> {
  switch (intent.action) {
    case 'reaction': {
      if (!intent.emoticonType) return { status: 'blocked' };
      const reactionResult = await withRelationCtx(pool, { userId }, async (client) => {
        // posts는 RLS가 걸려 있다 — 재조회 자체가 곧 재검증이다(삭제·차단·공개범위 전부 반영됨).
        const target = await client.query<{ author_id: string }>('SELECT author_id FROM posts WHERE id = $1', [
          intent.targetId,
        ]);
        const postAuthorId = target.rows[0]?.author_id;
        if (!postAuthorId) return { status: 'blocked' as const };
        // §11.10.3 "같은 것을 다시 누르면 해제" — 토글이라 먼저 현재 상태를 봐야 한다.
        const current = await client.query<{ emoticon_type: string }>(
          `SELECT emoticon_type FROM reactions WHERE target_type = 'post' AND target_id = $1 AND user_id = $2`,
          [intent.targetId, userId],
        );
        if (current.rows[0]?.emoticon_type === intent.emoticonType) {
          await client.query(`DELETE FROM reactions WHERE target_type = 'post' AND target_id = $1 AND user_id = $2`, [
            intent.targetId,
            userId,
          ]);
          return { status: 'executed' as const, reaction: null, notified: false };
        }
        await client.query(
          `INSERT INTO reactions (target_type, target_id, user_id, emoticon_type)
           VALUES ('post', $1, $2, $3)
           ON CONFLICT (target_type, target_id, user_id) DO UPDATE SET emoticon_type = EXCLUDED.emoticon_type`,
          [intent.targetId, userId, intent.emoticonType],
        );
        // 토글-ON(신규 반응·다른 반응으로 교체)에서만 알린다 — 해제(위 DELETE)는 알리지 않는다.
        const notified = await createNotification(client, userId, postAuthorId, 'reaction', 'post', intent.targetId);
        return { status: 'executed' as const, reaction: intent.emoticonType, notified };
      });
      // 푸시 알림(dispatchPush)은 1차 스코프에서 제외됐다 — in-app 알림만.
      if (reactionResult.status === 'blocked') return { status: 'blocked' };
      return { status: 'executed', reaction: reactionResult.reaction };
    }

    case 'save': {
      const saved = await withRelationCtx(pool, { userId }, async (client) => {
        const target = await client.query('SELECT 1 FROM posts WHERE id = $1', [intent.targetId]);
        if (target.rows.length === 0) return false;
        await client.query(`INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
          userId,
          intent.targetId,
        ]);
        return true;
      });
      return saved ? { status: 'executed' } : { status: 'blocked' };
    }

    // §11.9.2 — "본문 복원 + 포커스. 자동 제출 금지." 여기선 DB에 아무것도 쓰지
    // 않는다. 실제 게시는 사용자가 직접 제출할 때 댓글 작성 API 자체가 검증한다.
    case 'comment':
      return { status: 'draft_only', draft: intent.draft, targetId: intent.targetId };

    case 'friend_request': {
      if (!confirmed) return { status: 'confirm_required' };
      if (userId === intent.targetId) return { status: 'blocked' };
      if (await isBlockedWith(userId, intent.targetId)) return { status: 'blocked' };
      try {
        await withRelationCtx(pool, { userId }, (client) =>
          client.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`, [userId, intent.targetId]),
        );
      } catch (err) {
        if (!isPgError(err, '23505')) throw err; // 이미 신청/수락된 관계 — 멱등하게 성공 취급
      }
      return { status: 'executed' };
    }

    case 'follow': {
      if (!confirmed) return { status: 'confirm_required' };
      if (userId === intent.targetId) return { status: 'blocked' };
      try {
        // 🔒 사용자 지시(2026-08-26, "notification의 내용을 디비와 연동해서
        // 실제 데이터를 보여줘") — RelationshipButton이 "상대에게 알림이
        // 가요"라고 안내하는 그 알림을 실제로 남긴다(0010_notification.sql
        // 스키마만 있고 지금까지 아무도 안 썼다). target_type='user'/
        // target_id=나(팔로우한 사람) — 알림 클릭 시 내 프로필로 이동.
        // withRelationCtx가 BEGIN/COMMIT으로 감싸 두 INSERT가 한 트랜잭션.
        await withRelationCtx(pool, { userId }, async (client) => {
          await client.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [userId, intent.targetId]);
          await createNotification(client, userId, intent.targetId, 'follow', 'user', userId);
        });
      } catch (err) {
        if (isPgError(err, '23505')) return { status: 'executed' }; // 이미 팔로우 중 — 멱등
        if (isPgError(err, '42501')) return { status: 'blocked' }; // follows RLS가 차단 관계를 스스로 걸러냄
        throw err;
      }
      return { status: 'executed' };
    }
  }
}
