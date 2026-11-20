import type { AgentPersona, ReafyComment } from '../types.js';

/** 한 글에서 세션당 댓글에 공감을 남길 최대 개수 (API 호출량 억제) */
export const MAX_COMMENT_REACTIONS_PER_POST = 2;

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * 댓글 좋아요 대상 선정: 본인 댓글 제외, 이미 공감한 댓글 제외(다시 누르면 토글이 꺼짐),
 * 최대 cap개까지만.
 */
export function pickCommentsToReact(
  comments: ReafyComment[],
  persona: AgentPersona,
  cap: number = MAX_COMMENT_REACTIONS_PER_POST
): ReafyComment[] {
  const candidates = comments.filter((c) => c.authorNickname !== persona.nickname && !c.myReaction);
  return shuffle(candidates).slice(0, cap);
}

/**
 * 대댓글(답글) 대상 댓글 하나 선정. 본인 댓글 제외, 이미 대댓글인 댓글(parentCommentId 있음)도
 * 제외해서 스레드가 한 단계 이상 깊어지지 않게 한다. 후보 없으면 null.
 */
export function pickReplyTarget(comments: ReafyComment[], persona: AgentPersona): ReafyComment | null {
  const candidates = comments.filter((c) => c.authorNickname !== persona.nickname && !c.parentCommentId);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
