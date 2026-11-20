/** 무드 드리프트 값의 범위. -1(차분/위축) ~ +1(활기/적극적). */
export const MOOD_BOUND = 1.0;
/** 세션마다 원래 톤(0)으로 되돌아가는 감쇠 비율. 무한 표류 방지(아웃사이드 보이스 지적 반영). */
export const MOOD_DECAY_RATE = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 세션 이벤트에 따라 무드를 이동시키고, 매 세션 원점으로 감쇠시킨다.
 * decay를 delta 적용보다 먼저 해서, 매 세션 최대치가 항상 MOOD_BOUND 이내로 수렴한다.
 */
export function driftMood(currentMood: number, delta: number): number {
  const decayed = currentMood * (1 - MOOD_DECAY_RATE);
  return clamp(decayed + delta, -MOOD_BOUND, MOOD_BOUND);
}

/**
 * 현재 무드를 LLM 프롬프트에 반영할 한 줄짜리 지시문으로 변환.
 * 중립 구간(|mood| < 0.3)에서는 아무것도 덧붙이지 않음 — 매 세션 티가 나면 그 자체가 봇 신호.
 */
export function moodToneModifier(mood: number): string {
  if (mood > 0.6) return '오늘따라 유독 신나고 적극적인 기분이에요.';
  if (mood > 0.3) return '오늘은 평소보다 살짝 들뜬 기분이에요.';
  if (mood < -0.6) return '오늘은 유독 차분하고 말수가 적은 기분이에요.';
  if (mood < -0.3) return '오늘은 평소보다 살짝 가라앉은 기분이에요.';
  return '';
}
