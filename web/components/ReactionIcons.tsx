/**
 * 반응 6종 SVG — assets/reactions/*.svg를 그대로 인라인 이식 (§11.10.2).
 * <img>가 아니라 인라인으로 넣는 이유: manifest.json의 상태 전환 규칙
 * (".is-selected path { fill: var(--accent); stroke: none }")이 DOM 안의
 * <path>를 직접 타겟해야 동작한다 — <img>는 SVG 내부에 CSS가 못 들어간다.
 */
export type EmoticonType = 'empathy' | 'cheer' | 'funny' | 'surprise' | 'sad' | 'helpful';

export const REACTIONS: { id: EmoticonType; label: string }[] = [
  { id: 'empathy', label: '공감' },
  { id: 'cheer', label: '응원' },
  { id: 'funny', label: '웃김' },
  { id: 'surprise', label: '놀람' },
  { id: 'sad', label: '슬픔' },
  { id: 'helpful', label: '도움됨' },
];

const PATHS: Record<EmoticonType, string> = {
  empathy: 'M12 20C12 20 4 13.5 4 8.5C4 5.8 6.2 4 8.5 4C10 4 11.3 4.8 12 6C12.7 4.8 14 4 15.5 4C17.8 4 20 5.8 20 8.5C20 13.5 12 20 12 20Z',
  cheer: 'M6.25 3H7.75V21H6.25Z M7.75 4L19 8L7.75 12Z',
  funny: 'M4 9Q12 19 20 9Q12 12.5 4 9Z',
  surprise: 'M12 3C12.6 7 13 10.4 21 12C13 13.6 12.6 17 12 21C11.4 17 11 13.6 3 12C11 10.4 11.4 7 12 3Z',
  sad: 'M12 3C12 3 19 12.5 19 16.5C19 19.5 15.9 22 12 22C8.1 22 5 19.5 5 16.5C5 12.5 12 3 12 3Z',
  helpful: 'M4.5 12.6L9 17.1L19.5 6.6L17.7 4.8L9 13.5L6.3 10.8Z',
};

/** §11.10.2 크기 — 카드 20px / 상세 24px / 알림 16px */
export function ReactionIcon({ type, className, size = 20 }: { type: EmoticonType; className?: string; size?: number }) {
  const label = REACTIONS.find((r) => r.id === type)!.label;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <path d={PATHS[type]} />
    </svg>
  );
}
