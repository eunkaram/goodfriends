import { describe, it, expect } from 'vitest';
import { insertImageMidBody } from './post-image.js';

describe('insertImageMidBody', () => {
  it('inserts between paragraphs when there are multiple paragraphs (3 -> after 2nd)', () => {
    const body = '첫 문단입니다.\n\n둘째 문단입니다.\n\n셋째 문단입니다.';
    const result = insertImageMidBody(body, 'https://example.com/img.jpg');
    expect(result).toBe('첫 문단입니다.\n\n둘째 문단입니다.\n\nhttps://example.com/img.jpg\n\n셋째 문단입니다.');
  });

  it('inserts after the first of two paragraphs', () => {
    const body = '첫 문단.\n\n둘째 문단.';
    const result = insertImageMidBody(body, 'https://example.com/img.jpg');
    expect(result).toBe('첫 문단.\n\nhttps://example.com/img.jpg\n\n둘째 문단.');
  });

  it('falls back to splitting by sentence when there is only one paragraph', () => {
    const body =
      "IO 인터랙티브의 신작 첩보 액션 게임 '007 퍼스트 라이트'가 지난 5월 27일 출시 이후 약 3개월 만에 글로벌 누적 판매량 400만 장을 돌파했습니다. 이 게임은 제임스 본드의 젊은 시절을 다룬 기원 이야기입니다. IO 인터랙티브는 20일 공식 X를 통해 팬들에게 감사를 표했습니다.";
    const result = insertImageMidBody(body, 'https://example.com/img.jpg');
    const parts = result.split('\n\n');
    expect(parts).toHaveLength(3);
    expect(parts[1]).toBe('https://example.com/img.jpg');
    expect(parts[0]).toContain('400만 장을 돌파했습니다.');
    expect(parts[2]).toContain('감사를 표했습니다.');
  });

  it('appends at the end when the body is a single short sentence (caption-style)', () => {
    const result = insertImageMidBody('사실상 깡패.', 'https://example.com/img.jpg');
    expect(result).toBe('사실상 깡패.\n\nhttps://example.com/img.jpg');
  });

  it('appends at the end when the body has no sentence-ending punctuation at all', () => {
    const result = insertImageMidBody('그냥 이런 느낌', 'https://example.com/img.jpg');
    expect(result).toBe('그냥 이런 느낌\n\nhttps://example.com/img.jpg');
  });

  it('does not split a URL apart on its internal dots/question marks (2026-09-10 실사고)', () => {
    const body =
      '우먼즈이긴 하나 가격이 깡패죠. 스탠다드, 와이드 다 리스탁 됐어요. https://www.joesnewbalanceoutlet.com/pd/womens-made-in-us-993/WR993V1-2381.html?dwvar_WR993V1-2381_style=WR993NV#dwvar_WR993V1-2381_sty...';
    const result = insertImageMidBody(body, 'https://example.com/img.jpg');
    expect(result).toContain(
      'https://www.joesnewbalanceoutlet.com/pd/womens-made-in-us-993/WR993V1-2381.html?dwvar_WR993V1-2381_style=WR993NV#dwvar_WR993V1-2381_sty...'
    );
  });
});
