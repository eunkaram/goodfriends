import { describe, it, expect } from 'vitest';
import { POST_FORMATS, pickPostFormat } from './post-formats.js';

describe('POST_FORMATS', () => {
  it('has more than one format with unique ids', () => {
    expect(POST_FORMATS.length).toBeGreaterThan(1);
    const ids = POST_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every format a non-empty instruction', () => {
    for (const format of POST_FORMATS) {
      expect(format.instruction.length).toBeGreaterThan(0);
    }
  });
});

describe('pickPostFormat', () => {
  it('always returns a valid format from POST_FORMATS', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickPostFormat();
      expect(POST_FORMATS).toContainEqual(picked);
    }
  });

  it('picks different formats across many calls (not stuck on one)', () => {
    const seen = new Set(Array.from({ length: 100 }, () => pickPostFormat().id));
    expect(seen.size).toBeGreaterThan(1);
  });
});
