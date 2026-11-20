import { describe, it, expect } from 'vitest';
import { pickCommentsToReact, pickReplyTarget, MAX_COMMENT_REACTIONS_PER_POST } from './comment-rules.js';
import type { AgentPersona, ReafyComment } from '../types.js';

function makePersona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: 'agent-technova',
    name: 'TechNova',
    nickname: '테크노바',
    email: 'x@x.com',
    password: 'x',
    birthdate: '1996-01-01',
    country: 'US',
    postalCode: '00000',
    bio: '',
    interests: [],
    preferredCategories: [],
    tone: '',
    systemPrompt: '',
    postProb: 0.5,
    commentProb: 0.5,
    reactionProb: 0.5,
    externalSearchProb: 0.5,
    minIntervalMinutes: 15,
    maxIntervalMinutes: 60,
    ...overrides,
  };
}

function makeComment(overrides: Partial<ReafyComment> = {}): ReafyComment {
  return {
    id: 'c1',
    postId: 'p1',
    authorId: 'u1',
    authorUsername: 'user1',
    authorNickname: '실사용자',
    body: 'comment body',
    createdAt: new Date().toISOString(),
    reactionCount: 0,
    ...overrides,
  };
}

describe('pickCommentsToReact', () => {
  it('excludes comments authored by the persona itself', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = [makeComment({ id: 'c1', authorNickname: '테크노바' }), makeComment({ id: 'c2', authorNickname: '실사용자' })];
    const result = pickCommentsToReact(comments, persona);
    expect(result.map((c) => c.id)).toEqual(['c2']);
  });

  it('excludes comments already reacted to (toggling again would un-react)', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = [makeComment({ id: 'c1', myReaction: true }), makeComment({ id: 'c2', myReaction: false })];
    const result = pickCommentsToReact(comments, persona);
    expect(result.map((c) => c.id)).toEqual(['c2']);
  });

  it('never returns more than the cap', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = Array.from({ length: 10 }, (_, i) => makeComment({ id: `c${i}` }));
    const result = pickCommentsToReact(comments, persona, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('defaults to MAX_COMMENT_REACTIONS_PER_POST when no cap given', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = Array.from({ length: 10 }, (_, i) => makeComment({ id: `c${i}` }));
    const result = pickCommentsToReact(comments, persona);
    expect(result.length).toBeLessThanOrEqual(MAX_COMMENT_REACTIONS_PER_POST);
  });

  it('returns an empty array when there are no eligible comments', () => {
    const persona = makePersona({ nickname: '테크노바' });
    expect(pickCommentsToReact([], persona)).toEqual([]);
  });
});

describe('pickReplyTarget', () => {
  it('excludes comments authored by the persona itself', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = [makeComment({ id: 'c1', authorNickname: '테크노바' })];
    expect(pickReplyTarget(comments, persona)).toBeNull();
  });

  it('excludes comments that are already replies (parentCommentId set) to avoid deep threads', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = [makeComment({ id: 'c1', authorNickname: '실사용자', parentCommentId: 'c0' })];
    expect(pickReplyTarget(comments, persona)).toBeNull();
  });

  it('picks a top-level comment from another author', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const comments = [makeComment({ id: 'c1', authorNickname: '실사용자', parentCommentId: null })];
    expect(pickReplyTarget(comments, persona)?.id).toBe('c1');
  });

  it('returns null when there are no candidates', () => {
    const persona = makePersona({ nickname: '테크노바' });
    expect(pickReplyTarget([], persona)).toBeNull();
  });
});
