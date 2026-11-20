import { describe, it, expect } from 'vitest';
import { sanitizeLlmText, hasEncodingCorruption } from './sanitize.js';

describe('sanitizeLlmText', () => {
  it('returns clean text unchanged', () => {
    expect(sanitizeLlmText('할인만 쫓지 마세요, 원가 분석부터 시작하는 게 진짜 절약이에요.')).toBe(
      '할인만 쫓지 마세요, 원가 분석부터 시작하는 게 진짜 절약이에요.'
    );
  });

  it('truncates at the real-world leak pattern observed in production (repeated fake turns)', () => {
    const raw =
      `로컬 모델로 API 비용은 아깝지만, 데이터 보안 리스크는 예상치 못한 큰 비용이 될 수 있죠.` +
      `<|endoftext|><|im_start|>user\n<|im_start|>user\n<|im_start|>assistant\n<think>\n\n</think>\n\n` +
      `로컬 모델로 API 비용은 아깝지만, 데이터 보안 리스크는 예상치 못한 큰 비용이 될 수 있죠.`;
    expect(sanitizeLlmText(raw)).toBe('로컬 모델로 API 비용은 아깝지만, 데이터 보안 리스크는 예상치 못한 큰 비용이 될 수 있죠.');
  });

  it('truncates at a bare <think> block with nothing before it', () => {
    expect(sanitizeLlmText('<think>\n\n</think>\n\n진짜 댓글')).toBe('');
  });

  it('truncates at <|im_start|> even when it appears before any other marker', () => {
    expect(sanitizeLlmText('좋은 글이네요 감사합니다<|im_start|>user\n다음 질문은?')).toBe('좋은 글이네요 감사합니다');
  });

  it('picks the earliest marker when multiple marker types are present', () => {
    // </think>가 <|endoftext|>보다 먼저 나오면 </think> 위치에서 잘라야 함
    const raw = '실제 내용</think><|endoftext|>가짜 내용';
    expect(sanitizeLlmText(raw)).toBe('실제 내용');
  });

  it('trims surrounding whitespace after truncation', () => {
    expect(sanitizeLlmText('내용입니다   \n<|endoftext|>나머지')).toBe('내용입니다');
  });

  it('handles empty input', () => {
    expect(sanitizeLlmText('')).toBe('');
  });
});

describe('hasEncodingCorruption', () => {
  it('detects the real-world corruption pattern (mangled proper noun mid-sentence)', () => {
    expect(hasEncodingCorruption("사실 저는 원래 '���델 가족' 하면 그냥 유전자가 보고 확신했어요.")).toBe(true);
  });

  it('returns false for clean text', () => {
    expect(hasEncodingCorruption('물들인 애쉬브라운으로 포인트 주시고, 귀걸이도 작게')).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(hasEncodingCorruption('')).toBe(false);
  });
});
