import { describe, it, expect } from 'vitest';
import { isQuietHour } from './quiet-hours.js';

// UTC 기준으로 명확한 시각을 만들고, 테스트들은 timeZone='UTC'를 명시해서 판정 "로직" 자체를
// 검증한다(서버/실행 환경의 로컬 시간대에 좌우되지 않게). 실제 기본값(Asia/Seoul) 동작은
// 맨 아래 별도 테스트에서 확인한다.
function atUtcHour(hour: number): Date {
  return new Date(Date.UTC(2026, 0, 1, hour, 0, 0));
}

describe('isQuietHour', () => {
  it('is true inside a simple (non-wrapping) window', () => {
    expect(isQuietHour(atUtcHour(3), 1, 6, 'UTC')).toBe(true);
  });

  it('is false just before the window starts', () => {
    expect(isQuietHour(atUtcHour(0), 1, 6, 'UTC')).toBe(false);
  });

  it('is false exactly at the end boundary (end is exclusive)', () => {
    expect(isQuietHour(atUtcHour(6), 1, 6, 'UTC')).toBe(false);
  });

  it('is true exactly at the start boundary (start is inclusive)', () => {
    expect(isQuietHour(atUtcHour(1), 1, 6, 'UTC')).toBe(true);
  });

  it('is false during the day', () => {
    expect(isQuietHour(atUtcHour(14), 1, 6, 'UTC')).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    expect(isQuietHour(atUtcHour(23), 22, 5, 'UTC')).toBe(true);
    expect(isQuietHour(atUtcHour(3), 22, 5, 'UTC')).toBe(true);
    expect(isQuietHour(atUtcHour(12), 22, 5, 'UTC')).toBe(false);
  });

  it('is always false when start equals end (disabled)', () => {
    expect(isQuietHour(atUtcHour(3), 0, 0, 'UTC')).toBe(false);
  });

  it('defaults to Asia/Seoul (UTC+9), not the server/process local timezone', () => {
    // 03:00 UTC == 12:00 KST → 한국은 한낮이라 조용한 시간대 아님(prod가 UTC로 떠 있어서
    // 실제로 이 케이스에서 하루 종일 자동 실행이 멈췄던 버그, 2026-09-06).
    expect(isQuietHour(atUtcHour(3), 1, 6)).toBe(false);
    // 17:00 UTC == 02:00 KST(다음날) → 한국 새벽이라 조용한 시간대 맞음
    expect(isQuietHour(atUtcHour(17), 1, 6)).toBe(true);
  });
});
