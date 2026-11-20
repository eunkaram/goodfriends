import type { AgentPersona, CommunityPost } from '../types.js';

/** 세션당 다른 에이전트와의 상호작용(공감+댓글) 상한. 봇-링 탐지 신호 완화용 하드캡. */
export const CROSS_AGENT_INTERACTION_CAP = 1;

/**
 * 본인이 작성한 글은 상호작용 대상에서 제외.
 * (기존 동작을 순수 함수로 추출 — REGRESSION 테스트 대상)
 */
export function filterOwnPosts(posts: CommunityPost[], persona: AgentPersona): CommunityPost[] {
  return posts.filter((post) => post.authorNickname !== persona.nickname);
}

/** 글 작성자가 우리 쪽 에이전트 스쿼드 소속인지 여부 (실사용자 vs 동료 봇 구분) */
export function isFellowAgentPost(post: CommunityPost, agentNicknames: ReadonlySet<string>): boolean {
  return agentNicknames.has(post.authorNickname);
}

/**
 * 이 글과 상호작용(공감/댓글)해도 되는지 여부.
 * 동료 에이전트 글이고, 이미 이번 세션에서 크로스 에이전트 상호작용 상한에 도달했다면 false.
 */
export function canInteractWithPost(
  post: CommunityPost,
  agentNicknames: ReadonlySet<string>,
  crossAgentInteractionsSoFar: number
): boolean {
  if (!isFellowAgentPost(post, agentNicknames)) return true;
  return crossAgentInteractionsSoFar < CROSS_AGENT_INTERACTION_CAP;
}

/**
 * 방금 생성한 제목이 최근에 쓴 글 제목과 사실상 같은지 판정.
 *
 * 2026-09-14 prod 피드에서 같은 계정이 23분 간격으로 제목이 완전히 동일한 글 두 개를 올린 게
 * 발견됐다(본문 숫자만 650원/6500원으로 어긋남 — 재생성 아티팩트). 프롬프트의 [반복 방지]
 * 지시만으로는 모델이 안 지키므로 코드에서 결정적으로 거른다.
 *
 * recentTexts 항목은 `${title} - ${body}` 앞부분 발췌라 제목이 맨 앞에 온다.
 * ponytail: 공백 제거 후 앞 12자 비교라는 단순 휴리스틱. 유사 제목까지 잡아야 하면 그때 교체.
 */
export function isRepeatedTitle(title: string, recentTexts: string[], prefixLen = 12): boolean {
  const key = title.replace(/\s+/g, '').slice(0, prefixLen);
  if (key.length === 0) return false;
  return recentTexts.some((t) => t.replace(/\s+/g, '').startsWith(key));
}
