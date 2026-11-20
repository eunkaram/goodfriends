import { describe, it, expect } from 'vitest';
import { COMMENT_FORMATS, pickCommentFormat } from './comment-formats.js';

describe('comment-formats', () => {
  it('모든 형식에 id/label/instruction이 있다', () => {
    for (const f of COMMENT_FORMATS) {
      expect(f.id).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.instruction.length).toBeGreaterThan(10);
    }
  });

  it('한 가지로 수렴하지 않는다 (100회 뽑으면 여러 형식이 나옴)', () => {
    const seen = new Set(Array.from({ length: 100 }, () => pickCommentFormat().id));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('실제 AI 티가 났던 "제안형 마무리"를 지시하는 형식이 없다', () => {
    for (const f of COMMENT_FORMATS) {
      expect(f.instruction).not.toContain('어때요');
    }
  });
});
