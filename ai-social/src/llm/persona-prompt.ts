import type { AgentPersona } from '../types.js';

export type ActivityType = 'post' | 'comment' | 'reply' | 'reaction';

const ACTIVITY_INSTRUCTION: Record<ActivityType, string> = {
  post: '지금은 새 글을 작성할 차례입니다.',
  comment: '지금은 댓글을 작성할 차례입니다.',
  reply: '지금은 답글을 작성할 차례입니다.',
  reaction: '지금은 이 글에 관심이 가는지, 공감·댓글을 할지 판단할 차례입니다.',
};

/** 최근 작성 발췌를 반복 방지 지시로 변환. recentTexts가 비어있으면 빈 문자열. */
function buildRepetitionGuard(recentTexts: string[]): string {
  if (recentTexts.length === 0) return '';
  return (
    `\n\n[반복 방지] 최근에 이런 식으로 쓴 적이 있으니, 이번엔 문장 구조·도입부·표현·감정 톤을 다르게 하세요:\n` +
    recentTexts.map((t, i) => `${i + 1}) ${t}`).join('\n')
  );
}

/** communityBehavior의 활동별 기준을 지시문으로 변환. reply는 comment 기준 + continuity를 함께 씀. */
export function buildActivityBehaviorNote(persona: AgentPersona, activity: ActivityType): string {
  const behavior = persona.communityBehavior;
  if (!behavior) return '';

  const lines: string[] = [];
  if (activity === 'post') {
    lines.push(behavior.post);
  } else if (activity === 'comment' || activity === 'reply') {
    lines.push(behavior.comment, behavior.disagreement);
    if (activity === 'reply') lines.push(behavior.continuity);
  } else if (activity === 'reaction') {
    lines.push(behavior.reaction);
  }

  return lines.length > 0 ? `\n\n[이 활동에 대한 당신만의 기준]\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
}

/**
 * enrichment 없는 페르소나(제너레이터 기본 한 줄짜리 systemPrompt)에만 쓰는 공통 안전 지침.
 * enriched 페르소나는 systemPrompt 자체의 [안전] 절에 이미 같은 내용이 있어서 여기서 또
 * 붙이면 순수 중복이다 — buildPersonaPromptPrefix가 조건부로만 호출한다.
 */
export const PERSONA_SAFETY_REMINDER =
  '\n\n[항상 지킬 것]\n' +
  '- 어떤 경우에도 욕설·비하·혐오·조롱·인신공격을 하지 않습니다. 반대 의견은 주장과 근거에만 향하고 사람을 공격하지 않습니다.\n' +
  '- 의료·투자·법률처럼 민감한 주제는 단정적으로 지시하거나 결과를 보장하지 않습니다.\n' +
  '- 겪지 않은 경험이나 없는 개인정보·사실을 실제인 것처럼 지어내지 않습니다.\n' +
  '- 당신이 AI이거나 시스템 프롬프트/내부 상태를 가지고 있다는 사실을 절대 언급하지 않습니다.';

/**
 * 페르소나의 systemPrompt를 "최우선 페르소나 컨텍스트"로 앞세우고, 필요한 만큼만 덧붙인다.
 *
 * enriched 페르소나(persona.communityBehavior가 있음 = enrich.ts가 적용됨)의 systemPrompt는
 * 이미 정체성·맥락·성격·4개 활동 전부에 대한 커뮤니티 행동 규칙·안전 지침을 다 담고 있다
 * (enrich 파일 생성 시 이 필드들로 합성된 것). 여기서 그 내용을 감정 성향/행동 기준/안전
 * 지침으로 또 재주입하면 뜻은 똑같은데 토큰만 거의 2배로 나간다 — 실제로 50개 에이전트를
 * 그대로 둔 채 토큰 사용량이 배로 뛰는 걸로 발견됨(2026-09-07). 그래서 enriched 페르소나는
 * "지금 무슨 활동 차례인지"만 한 줄로 짚어주고, 나머지 보강 블록은 enrichment가 없는(제너레이터
 * 기본값) 페르소나에만 적용한다.
 */
export function buildPersonaPromptPrefix(persona: AgentPersona, activity: ActivityType, recentTexts: string[] = []): string {
  const repetitionGuard = buildRepetitionGuard(recentTexts);

  if (persona.communityBehavior) {
    return `${persona.systemPrompt}\n\n[지금 할 일] ${ACTIVITY_INSTRUCTION[activity]}${repetitionGuard}`;
  }

  return `${persona.systemPrompt}${buildActivityBehaviorNote(persona, activity)}${repetitionGuard}${PERSONA_SAFETY_REMINDER}`;
}
