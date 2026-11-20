import { describe, it, expect } from 'vitest';
import { driftMood, moodToneModifier, MOOD_BOUND } from './mood.js';

describe('driftMood', () => {
  it('moves toward positive delta from neutral', () => {
    expect(driftMood(0, 0.3)).toBeCloseTo(0.3);
  });

  it('decays toward 0 before applying delta, even with repeated positive deltas', () => {
    let mood = 0;
    for (let i = 0; i < 50; i++) {
      mood = driftMood(mood, 0.3);
    }
    // 감쇠율 0.5, delta 0.3 반복 시 수렴값은 delta / decayRate = 0.6, MOOD_BOUND(1.0) 안쪽
    expect(mood).toBeLessThanOrEqual(MOOD_BOUND);
    expect(mood).toBeGreaterThan(0);
  });

  it('never exceeds the bound even with extreme deltas', () => {
    const mood = driftMood(0, 10);
    expect(mood).toBeLessThanOrEqual(MOOD_BOUND);
  });

  it('never goes below the negative bound', () => {
    const mood = driftMood(0, -10);
    expect(mood).toBeGreaterThanOrEqual(-MOOD_BOUND);
  });

  it('pulls a high mood back toward zero when delta is 0 (decay only)', () => {
    const mood = driftMood(0.8, 0);
    expect(mood).toBeLessThan(0.8);
    expect(mood).toBeGreaterThan(0);
  });
});

describe('moodToneModifier', () => {
  it('returns empty string in the neutral band', () => {
    expect(moodToneModifier(0)).toBe('');
    expect(moodToneModifier(0.2)).toBe('');
    expect(moodToneModifier(-0.2)).toBe('');
  });

  it('returns a positive modifier for elevated mood', () => {
    expect(moodToneModifier(0.5)).not.toBe('');
    expect(moodToneModifier(0.9)).not.toBe('');
  });

  it('returns a negative modifier for low mood', () => {
    expect(moodToneModifier(-0.5)).not.toBe('');
    expect(moodToneModifier(-0.9)).not.toBe('');
  });
});
