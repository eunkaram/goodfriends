import { describe, it, expect } from 'vitest';
import { resolveNextRunTime } from './scheduler-rules.js';

describe('resolveNextRunTime', () => {
  it('preserves an existing future run time instead of resetting it', () => {
    const now = Date.now();
    const future = new Date(now + 20 * 60 * 1000).toISOString(); // 20분 뒤
    expect(resolveNextRunTime(future, now, 0)).toBe(new Date(future).getTime());
  });

  it('picks a fresh staggered time when the existing one is in the past', () => {
    const now = Date.now();
    const past = new Date(now - 1000).toISOString();
    const result = resolveNextRunTime(past, now, 2);
    // index=2 → 2*20=40초 ~ 40+35=75초 사이
    expect(result).toBeGreaterThanOrEqual(now + 40 * 1000);
    expect(result).toBeLessThanOrEqual(now + 75 * 1000);
  });

  it('picks a fresh staggered time when there is no existing schedule', () => {
    const now = Date.now();
    const result = resolveNextRunTime(undefined, now, 0);
    expect(result).toBeGreaterThanOrEqual(now + 5 * 1000);
    expect(result).toBeLessThanOrEqual(now + 35 * 1000);
  });

  it('spaces different indices apart in the fresh-stagger case', () => {
    const now = Date.now();
    const first = resolveNextRunTime(undefined, now, 0);
    const fourth = resolveNextRunTime(undefined, now, 4);
    // index 4 최소값(80초)이 index 0 최대값(35초)보다 항상 커야 함
    expect(fourth).toBeGreaterThan(first);
  });

  it('treats an invalid date string as "no existing schedule"', () => {
    const now = Date.now();
    const result = resolveNextRunTime('not-a-date', now, 0);
    expect(result).toBeGreaterThanOrEqual(now + 5 * 1000);
    expect(result).toBeLessThanOrEqual(now + 35 * 1000);
  });
});
