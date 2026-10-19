/**
 * 브라우저 Canvas/Video API로 뽑은 직접 영상 URL(youtube 제외) 썸네일을
 * `localStorage`에 캐싱한다(사용자 발견, 2026-08 — "브라우저에서 유튜브외
 * 영상 섬네일 만들어서 보여주는거, 이미지가 계속 없어져"). 원인은 캔버스
 * 추출 자체가 매번 성공을 보장하지 못한다는 데 있다(CORS·seek 타이밍에
 * 따라 들쭉날쭉 — `LinkPreviewCard.tsx`의 기존 주석 참고) — 페이지를
 * 새로고침할 때마다 처음부터 다시 시도하니, 어쩌다 실패하는 순간 그
 * 전까지 보이던 썸네일이 사라져 보였다. 한 번 성공한 결과는 URL을 키로
 * localStorage에 저장해두고, 같은 링크를 다시 만나면 재추출 없이 그대로
 * 쓴다 — 추출이 실패하는 새로고침이 와도 이전에 성공했던 결과가 그대로
 * 남는다.
 */
const CACHE_PREFIX = 'reafy:video-thumb:';

export type CachedVideoThumbnail = { dataUrl: string; width: number; height: number };

function isCachedVideoThumbnail(value: unknown): value is CachedVideoThumbnail {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.dataUrl === 'string' && typeof v.width === 'number' && typeof v.height === 'number';
}

export function readCachedVideoThumbnail(url: string): CachedVideoThumbnail | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + url);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedVideoThumbnail(parsed) ? parsed : null;
  } catch {
    // localStorage 자체가 없거나(SSR 등) 프라이빗 브라우징으로 막혀 있거나,
    // 저장된 값이 깨진 JSON인 경우 — 캐시 없음과 동일하게 취급하고 그냥
    // 재추출로 폴백한다.
    return null;
  }
}

export function writeCachedVideoThumbnail(url: string, thumb: CachedVideoThumbnail): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(thumb));
  } catch {
    // 용량 초과(QuotaExceededError)·프라이빗 브라우징 등 — 조용히 무시한다.
    // 캐싱은 순수 향상이라 실패해도 이번 페이지뷰의 추출 결과는 이미
    // 화면에 반영돼 있고, 다음 새로고침에 다시 재추출을 시도할 뿐이다.
  }
}
