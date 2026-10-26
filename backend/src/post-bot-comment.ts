/**
 * 새 글 첫 댓글 — 사용자 지시(2026-10-26, "글 작성시 news를 제외한 나머지
 * 카테고리에서 ai_bot이 첫 댓글을 쓰게 해줘"). news는 ai_news_bot/
 * ai_digest_bot이 이미 발행 주체라 제외(0058 ai_bot 마이그레이션 참고).
 *
 * 호출부(posts-http.ts)는 await만 하면 된다 — 실패를 전부 여기서 삼켜서
 * 글 작성 자체(이미 성공한 DB 커밋)를 절대 막지 않는다. auth.ts의
 * sendVerificationEmail/createDefaultUserLog와 같은 "실패해도 핵심 흐름은
 * 막지 않는다" 원칙.
 */
import { ownerPool, queryRaw } from './db.ts';
import { createComment } from './comments.ts';
import { generateFirstComment } from './llm.ts';
import { NEWS_CATEGORY_SLUG } from './categories.ts';

export const AI_BOT_USERNAME = 'ai_bot';

async function resolveBotId(): Promise<string | null> {
  const r = await queryRaw<{ id: string }>(ownerPool(), `SELECT id FROM users WHERE username = $1`, [AI_BOT_USERNAME]);
  return r.rows[0]?.id ?? null;
}

export async function maybeAddBotFirstComment(input: {
  categorySlug: string;
  categoryName: string;
  postId: string;
  title: string;
  body: string;
}): Promise<void> {
  if (input.categorySlug === NEWS_CATEGORY_SLUG) return;
  try {
    const botId = await resolveBotId();
    if (!botId) return; // 마이그레이션 전이면 조용히 스킵(장애 아님)
    const generated = await generateFirstComment({ categoryName: input.categoryName, title: input.title, body: input.body });
    if (!generated.ok) return; // generateFirstComment가 이미 alertAdminOfError 처리함
    await createComment(botId, input.postId, generated.value);
  } catch (err) {
    console.error('bot first-comment failed (post still created):', err);
  }
}
