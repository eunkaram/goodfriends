/**
 * 조용한 시간대 판정. 24시간 균일한 활동 자체가 "봇 티"이므로, 이 시간대엔
 * 자동 스케줄 트리거를 쉬게 한다 (수동 대시보드 트리거는 영향 없음).
 * 환경변수로 조정 가능: QUIET_HOURS_START, QUIET_HOURS_END (0-23시, 한국 시간 기준)
 * 기본값: 새벽 1시~6시. START === END면 비활성화.
 *
 * 반드시 한국 시간(Asia/Seoul)으로 판정한다 — 서버 시스템 시간대(prod는 UTC)를 그대로 쓰면
 * UTC 01~06시가 한국시간 오전 10시~오후 3시(한낮)에 걸려서 정반대로 동작한다
 * (2026-09-06 prod에서 실제로 겪음: 자동 실행이 하루 종일 안 일어남).
 */

function hourInTimeZone(date: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date);
  // 일부 ICU 구현이 자정을 "24"로 표기하는 경우가 있어 24로 나눈 나머지로 보정
  return Number(formatted) % 24;
}

export function isQuietHour(date: Date, startHour: number, endHour: number, timeZone = 'Asia/Seoul'): boolean {
  if (startHour === endHour) return false;
  const hour = hourInTimeZone(date, timeZone);
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // 자정을 걸치는 구간 (예: 23시~5시)
  return hour >= startHour || hour < endHour;
}

export function getQuietHoursConfig(): { startHour: number; endHour: number } {
  const startHour = parseInt(process.env.QUIET_HOURS_START || '1', 10);
  const endHour = parseInt(process.env.QUIET_HOURS_END || '6', 10);
  return { startHour, endHour };
}
