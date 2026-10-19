/**
 * Q&A 채택 — PLAN M2 "답변 채택 → FAQ 후보".
 *
 * 채택된 답변은 posts.adopted_comment_id(0050)에 하나만 둘 수 있다(단순
 * 오버라이드 컬럼). Q&A 카테고리(slug='qna', 0049) 글의 작성자만 자기 글의
 * 답변을 채택/해제한다. 댓글이 삭제되면 FK ON DELETE SET NULL로 채택이
 * 자동 해제된다(0050).
 *
 * comments엔 RLS가 없다(0011) — posts를 withRelationCtx로 반드시 재조회해
 * RLS 재검증 + author 검증을 한 쿼리에서 끝낸다(§13 원칙).
 */
import { appPool, withRelationCtx } from './db.ts';

export const QNA_CATEGORY_SLUG = 'qna';

export type AdoptResult =
  | { ok: true; commentId: string | null }
  | { ok: false; error: 'NOT_FOUND' | 'INVALID_INPUT' | 'FORBIDDEN' };

const pool = appPool('exists');

/**
 * @param commentId 채택할 comment id — null이면 채택 해제.
 * 글 작성자만 호출할 수 있다(권한은 대상 글의 author_id로 검증 — 사유 구분 없이
 * 포인트 하나로 알리는 §10.2 원칙을 유지한다).
 */
export async function setAdoptedComment(
  userId: string,
  postId: string,
  commentId: string | null,
): Promise<AdoptResult> {
  const result = await withRelationCtx(pool, { userId }, async (client) => {
    // 🔒 RLS 재검증 + author·qna 카테고리 동시 검증 — 대상 글이:
    //   (1) 호출자에게 아직도 보이고(삭제·차단·공개범위), (2) 호출자의 글이고,
    //   (3) Q&A 카테고리글이어야 채택 자체가 성립한다.
    const post = await client.query<{ slug: string | null; author_id: string }>(
      `SELECT c.slug, p.author_id
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [postId],
    );
    if (post.rowCount === 0) return { ok: false as const, error: 'NOT_FOUND' as const };
    if (post.rows[0].author_id !== userId) return { ok: false as const, error: 'FORBIDDEN' as const };
    if (post.rows[0].slug !== QNA_CATEGORY_SLUG) return { ok: false as const, error: 'INVALID_INPUT' as const };

    if (commentId !== null) {
      // 채택 대상이 실제로 이 글의 댓글인지 재검증(INTENT 검증과 같은 패턴) —
      // 클라이언트를 믿지 않는다. 답글(부모 있는 댓글)도 답변으로 쳐서 허용한다.
      const answer = await client.query(`SELECT 1 FROM comments WHERE id = $1 AND target_type = 'post' AND target_id = $2`, [
        commentId,
        postId,
      ]);
      if (answer.rowCount === 0) return { ok: false as const, error: 'INVALID_INPUT' as const };
    }

    const updated = await client.query<{ comment_id: string | null }>(
      `UPDATE posts SET adopted_comment_id = $2 WHERE id = $1 RETURNING adopted_comment_id AS comment_id`,
      [postId, commentId],
    );
    if (updated.rowCount === 0) return { ok: false as const, error: 'NOT_FOUND' as const };
    return { ok: true as const, commentId: updated.rows[0].comment_id };
  });
  return result;
}

/** 상세 payload가 Q&A 여부를 판단할 때 쓴다(post-detail.ts). */
export function isQnaPost(categorySlug: string | null | undefined): boolean {
  return categorySlug === QNA_CATEGORY_SLUG;
}
