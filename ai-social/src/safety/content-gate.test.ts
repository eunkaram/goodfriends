import { describe, it, expect, vi } from 'vitest';
import { checkContentSafety } from './content-gate.js';

describe('checkContentSafety', () => {
  it('passes clean content', () => {
    expect(checkContentSafety('오늘 날씨가 정말 좋네요! 산책하기 딱 좋은 날씨예요.').safe).toBe(true);
  });

  it('blocks empty content', () => {
    expect(checkContentSafety('').safe).toBe(false);
    expect(checkContentSafety('   ').safe).toBe(false);
  });

  it('blocks a phone number (PII)', () => {
    const result = checkContentSafety('연락처는 010-1234-5678로 주세요');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/PII/);
  });

  it('blocks an email address (PII)', () => {
    const result = checkContentSafety('문의는 test.user@example.com 으로 보내주세요');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/PII/);
  });

  it('blocks a resident-registration-number-shaped string (PII)', () => {
    const result = checkContentSafety('제 번호는 901231-1234567 입니다');
    expect(result.safe).toBe(false);
  });

  it('blocks known toxic keywords', () => {
    const result = checkContentSafety('이 글 진짜 시발 최악이네요');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/독성/);
  });

  it('blocks brand-unsafe keywords', () => {
    const result = checkContentSafety('요즘 도박 사이트 광고가 너무 많아요');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/브랜드세이프티/);
  });

  it('fails closed when the check throws internally', () => {
    // regex.test에 예외를 강제로 주입해 fail-closed 동작을 검증
    const badRegex = { test: () => { throw new Error('boom'); } } as unknown as RegExp;
    const original = RegExp.prototype.test;
    RegExp.prototype.test = badRegex.test;
    try {
      const result = checkContentSafety('아무 텍스트');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/fail-closed/);
    } finally {
      RegExp.prototype.test = original;
    }
  });
});
