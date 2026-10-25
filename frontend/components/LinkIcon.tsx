/**
 * 사용자 지시(2026-08, "링크... 여러개 입력 받고 싶어... 아래에 관련
 * 아이콘을 추가") — 링크가 이제 고정 3개(링크/인스타그램/트위터)가 아니라
 * 사용자가 이름을 직접 붙이는 임의 개수 목록이라, 아이콘도 고정 매핑이
 * 아니라 URL의 도메인으로 판별한다. 알려진 서비스는 브랜드 아이콘, 그 외는
 * 범용 체인(링크) 아이콘으로 폴백 — `components/ProfileHeader.tsx`(읽기
 * 전용 칩 줄)와 `components/ProfileLinksEditor.tsx`(편집 모달의 편집
 * 가능한 칩) 둘 다 이 하나를 공유한다.
 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function InstagramGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />
    </svg>
  );
}

function YouTubeGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="19" height="12" rx="3" />
      <path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GitHubGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 0 0-3.16 19.5c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

function FacebookGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 8.5h-2a1 1 0 0 0-1 1V11h3l-.4 3h-2.6v7h-3v-7H7.5v-3h2v-1.9c0-2.1 1.2-3.6 3.4-3.6h2.6z" />
    </svg>
  );
}

function TikTokGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v10.8a3.2 3.2 0 1 1-2.6-3.14" />
      <path d="M14 3c.3 2.4 2 4.2 4.4 4.5" />
    </svg>
  );
}

function ChainGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 13.5l-2 2a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" />
      <path d="M13.5 10.5l2-2a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" />
    </svg>
  );
}

export function LinkIcon({ url, size = 14 }: { url: string; size?: number }) {
  const host = hostnameOf(url);
  if (host.includes('instagram.com')) return <InstagramGlyph size={size} />;
  if (host.includes('twitter.com') || host === 'x.com') return <XGlyph size={size} />;
  if (host.includes('youtube.com') || host === 'youtu.be') return <YouTubeGlyph size={size} />;
  if (host.includes('github.com')) return <GitHubGlyph size={size} />;
  if (host.includes('facebook.com')) return <FacebookGlyph size={size} />;
  if (host.includes('tiktok.com')) return <TikTokGlyph size={size} />;
  return <ChainGlyph size={size} />;
}
