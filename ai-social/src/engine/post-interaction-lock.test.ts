import { describe, it, expect } from 'vitest';
import { PostInteractionLock } from './post-interaction-lock.js';

describe('PostInteractionLock (동시반응 방지)', () => {
  it('is not locked for a post with no prior interaction', () => {
    const lock = new PostInteractionLock(1000);
    expect(lock.isLocked('post-1')).toBe(false);
  });

  it('locks a post immediately after recording an interaction', () => {
    const lock = new PostInteractionLock(1000);
    lock.recordInteraction('post-1', 0);
    expect(lock.isLocked('post-1', 500)).toBe(true);
  });

  it('unlocks a post once the TTL elapses', () => {
    const lock = new PostInteractionLock(1000);
    lock.recordInteraction('post-1', 0);
    expect(lock.isLocked('post-1', 1500)).toBe(false);
  });

  it('tracks each postId independently', () => {
    const lock = new PostInteractionLock(1000);
    lock.recordInteraction('post-1', 0);
    expect(lock.isLocked('post-2', 100)).toBe(false);
  });
});
