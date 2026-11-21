import { describe, it, expect } from 'vitest';
import { generateOutline, validateOutline, OutlineError } from './outline.js';
import { makeBundle, mockLlm, persona } from './write-fixtures.js';

const ids = new Set(['F1', 'F2', 'F3']);

describe('validateOutline', () => {
  it('존재하지 않는 카드 id는 버리고, 유효 id 없는 섹션은 제거', () => {
    const o = validateOutline(
      { title: 'T', angle: 'a', lengthHint: 'medium', sections: [
        { heading: 'h', purpose: 'p', factIds: ['F1', 'F9', 2] },
        { purpose: '지어낸 섹션', factIds: ['F9'] },
        { purpose: '카드 없음', factIds: [] },
      ] },
      ids
    );
    expect(o.sections).toHaveLength(1);
    expect(o.sections[0].factIds).toEqual(['F1', 'F2']);
  });
  it('섹션이 전부 무효면 OutlineError', () => {
    expect(() => validateOutline({ title: 'T', sections: [{ purpose: 'x', factIds: ['F7'] }] }, ids)).toThrow(OutlineError);
  });
  it('title 없으면 에러, lengthHint 잘못되면 섹션 수로 추정', () => {
    expect(() => validateOutline({ sections: [] }, ids)).toThrow(OutlineError);
    const o = validateOutline({ title: 'T', lengthHint: 'huge', sections: [{ purpose: 'p', factIds: ['F1'] }] }, ids);
    expect(o.lengthHint).toBe('short');
  });
  it('섹션 수 상한이 없다(10개도 통과)', () => {
    const sections = Array.from({ length: 10 }, () => ({ purpose: 'p', factIds: ['F1'] }));
    expect(validateOutline({ title: 'T', sections }, ids).sections).toHaveLength(10);
  });
});

describe('generateOutline', () => {
  it('첫 응답이 무효면 피드백과 함께 1회 재시도', async () => {
    const good = JSON.stringify({ title: '제목', angle: '관점', lengthHint: 'short', sections: [{ purpose: 'p', factIds: ['F1'] }] });
    let n = 0;
    const llm = mockLlm(() => (n++ === 0 ? JSON.stringify({ title: 'x', sections: [{ purpose: 'p', factIds: ['F99'] }] }) : good));
    const o = await generateOutline(makeBundle(), persona, { llm });
    expect(o.title).toBe('제목');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].messages[1].content).toContain('이전 응답 문제');
  });
  it('두 번 다 실패하면 throw', async () => {
    const llm = mockLlm(() => 'not json');
    await expect(generateOutline(makeBundle(), persona, { llm })).rejects.toThrow(OutlineError);
  });
});
