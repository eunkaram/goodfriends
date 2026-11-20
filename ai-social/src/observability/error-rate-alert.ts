/**
 * 에러율 임계치 알림 — 대상(Slack/Discord 등) 미정이라 우선 로컬 로그만
 * (Open Items 결정, 2026-08-19). WEBHOOK_URL 환경변수가 설정되면 그쪽으로도 보냄.
 * fire-and-forget: 실패해도 메인 플로우에 영향 없음, 1회만 시도(재시도 없음).
 */

export const ERROR_RATE_WINDOW = 20;
export const ERROR_RATE_THRESHOLD = 0.3;
/** 같은 임계치 초과 상태에서 알림이 반복 스팸되지 않도록 하는 쿨다운 */
export const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

export function computeErrorRate(recentTypes: string[]): number {
  if (recentTypes.length === 0) return 0;
  const errors = recentTypes.filter((t) => t === 'error').length;
  return errors / recentTypes.length;
}

export function shouldAlert(recentTypes: string[], threshold: number = ERROR_RATE_THRESHOLD): boolean {
  return recentTypes.length >= 5 && computeErrorRate(recentTypes) >= threshold;
}

const WEBHOOK_TIMEOUT_MS = 5000;

export async function sendWebhookAlert(message: string): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.warn(`[ErrorRateAlert] ${message} (WEBHOOK_URL 미설정 — 로컬 로그만)`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: controller.signal,
    });
  } catch (err: any) {
    console.error(`[ErrorRateAlert] 웹훅 전송 실패 (무시하고 계속):`, err.message);
  } finally {
    clearTimeout(timer);
  }
}
