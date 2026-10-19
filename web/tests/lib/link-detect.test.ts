import { describe, test, expect } from 'vitest';
import { splitTextLinks } from '../../lib/link-detect.ts';

describe('splitTextLinks', () => {
  test('splits a URL embedded in the middle of a sentence', () => {
    expect(splitTextLinks('이거 봤어? https://example.com/a 재밌더라')).toEqual([
      { type: 'text', value: '이거 봤어? ' },
      { type: 'url', value: 'https://example.com/a' },
      { type: 'text', value: ' 재밌더라' },
    ]);
  });

  test('handles multiple URLs', () => {
    expect(splitTextLinks('https://a.com and https://b.com')).toEqual([
      { type: 'url', value: 'https://a.com' },
      { type: 'text', value: ' and ' },
      { type: 'url', value: 'https://b.com' },
    ]);
  });

  test('returns the whole string as text when there is no URL', () => {
    expect(splitTextLinks('링크 없는 문장')).toEqual([{ type: 'text', value: '링크 없는 문장' }]);
  });
});
