/**
 * 서버 재시작 시 에이전트의 다음 실행 시각을 어떻게 정할지 결정하는 순수 함수.
 * 이미 예약된(미래) 시각이 있으면 그대로 유지한다 — 안 그러면 재시작할 때마다 전
 * 에이전트가 index*20~145초 안의 같은 좁은 시간대로 다시 뭉쳐서 "재시작 직후 몰아서
 * 글 올리기" 문제가 생긴다(실제로 이 세션에서 반복 재시작하다가 관찰됨). 예약 시각이
 * 없거나 서버가 꺼져있던 동안 이미 지났을 때만 index 기반으로 새로 분산 배치한다.
 */
export function resolveNextRunTime(existingNextActiveAt: string | undefined, now: number, index: number): number {
  const existing = existingNextActiveAt ? new Date(existingNextActiveAt).getTime() : NaN;
  if (existing > now) return existing;
  return now + (index * 20 + Math.random() * 30 + 5) * 1000;
}
