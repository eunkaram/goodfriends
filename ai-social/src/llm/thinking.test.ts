import { describe, it, expect } from 'vitest';
import { extractChatContent, stripThinkTags, ReasoningTruncatedError } from './thinking.js';

describe('stripThinkTags', () => {
  it('<think>…</think> 블록 제거', () => {
    expect(stripThinkTags('<think>생각 중\n여러 줄</think>\n최종 답')).toBe('최종 답');
  });
  it('여는 태그 없이 </think>만 있으면 뒤만 취함', () => {
    expect(stripThinkTags('추론…</think>답')).toBe('답');
  });
  it('닫는 태그 없는 <think>는 잘림으로 보고 throw', () => {
    expect(() => stripThinkTags('<think>생각하다가 끊김')).toThrow(ReasoningTruncatedError);
  });
  it('태그 없으면 그대로(trim)', () => {
    expect(stripThinkTags('  hello ')).toBe('hello');
  });
});

describe('extractChatContent', () => {
  it('reasoning_content는 무시하고 content만 반환', () => {
    expect(extractChatContent({ message: { content: '391', reasoning_content: 'think' }, finish_reason: 'stop' }, true)).toBe('391');
  });
  it('reasoning 모드에서 content가 비면(thinking 잘림) throw', () => {
    expect(() => extractChatContent({ message: { content: '', reasoning_content: 'The user…' }, finish_reason: 'length' }, true)).toThrow(ReasoningTruncatedError);
  });
  it('reasoning 모드에서 finish_reason=length면 throw', () => {
    expect(() => extractChatContent({ message: { content: '{"a":' }, finish_reason: 'length' }, true)).toThrow(ReasoningTruncatedError);
  });
  it('reasoning off에서는 빈 content도 기존처럼 빈 문자열', () => {
    expect(extractChatContent({ message: { content: '' }, finish_reason: 'length' }, false)).toBe('');
    expect(extractChatContent(undefined, false)).toBe('');
  });
});

describe('reasoning off 회귀(기존 동작 불변)', () => {
  it('비-reasoning 응답에 <think>가 섞여도 content 그대로(trim만)', () => {
    expect(extractChatContent({ message: { content: ' 답 <think> x </think> 최종 ' } }, false)).toBe('답 <think> x </think> 최종');
  });
  it('짝 없는 <think>도 throw하지 않는다', () => {
    expect(extractChatContent({ message: { content: '생각 <think> 계속' } }, false)).toBe('생각 <think> 계속');
  });
});
