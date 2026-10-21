/**
 * 처리 안 된 서버 예외를 관리자 이메일로 알림 — §17.3 "자체 호스팅이 만든
 * 숙제"의 모니터링 3단계. 기존 `src/email.ts`(Zoho SMTP)를 그대로 재사용
 * 한다 — 새 서드파티 서비스(Sentry 등) 없이, 이미 있는 발송 경로 하나로
 * "서버가 500을 던지면 안다"는 최소한의 신호만 확보한다.
 *
 * ⚠️ `ADMIN_ALERT_EMAIL`이 `.env`에 없으면 콘솔 로그만 남기고 스킵한다
 * (email.ts의 ZOHO_EMAIL_USER 폴백과 같은 원칙 — 로컬 개발 안 깨짐).
 *
 * 🔒 같은 종류의 장애(예: DB 완전 다운)는 요청마다 계속 터진다 — 알림마다
 * 메일을 보내면 수백 통이 순식간에 쌓인다. `checkRateLimit`(기존 IP 레이트
 * 리밋과 같은 Redis 고정 윈도우 구현)을 재사용해 전역 키로 5분에 1통만
 * 허용한다 — "장애가 시작됐다"는 신호 하나면 충분하고, 그 이후는 서버
 * 로그(journalctl)로 계속 확인하면 된다.
 */
import { sendEmail } from './email.ts';
import { checkRateLimit } from './rate-limit.ts';

const ALERT_WINDOW_SECONDS = 300;

export async function alertAdminOfError(err: unknown, context: string): Promise<void> {
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) {
    console.log('[error-alert:stub — ADMIN_ALERT_EMAIL 없음, 콘솔로만 남김]', context);
    return;
  }

  try {
    const allowed = await checkRateLimit('admin-error-alert', 1, ALERT_WINDOW_SECONDS);
    if (!allowed) return; // 최근 5분 안에 이미 하나 보냈다 — 로그 폭주 방지

    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    const truncated = message.slice(0, 1000);

    await sendEmail({
      to,
      subject: `[AI Community] 서버 에러 발생 — ${context}`,
      text: `처리 안 된 예외가 발생했어요.\n\n경로: ${context}\n\n${truncated}\n\n같은 종류의 에러는 ${ALERT_WINDOW_SECONDS / 60}분 동안 다시 알리지 않아요 — 자세한 내용은 서버 로그(journalctl -u reafy)를 확인하세요.`,
      html: `<p>처리 안 된 예외가 발생했어요.</p><p><strong>경로:</strong> ${context}</p><pre style="white-space:pre-wrap;font-size:13px;">${truncated}</pre><p style="color:#8a8a92;font-size:12px;">같은 종류의 에러는 ${ALERT_WINDOW_SECONDS / 60}분 동안 다시 알리지 않아요 — 자세한 내용은 서버 로그(journalctl -u reafy)를 확인하세요.</p>`,
    });
  } catch (alertErr) {
    // 🔒 알림 자체가 실패해도 원래 요청 흐름을 절대 막으면 안 된다 — 이미
    // 응답은 보내진 뒤라 여기서 할 수 있는 건 로그뿐이다.
    console.error('[error-alert] 알림 발송 실패:', alertErr);
  }
}
