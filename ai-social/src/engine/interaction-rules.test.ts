import { describe, it, expect } from 'vitest';
import {
  filterOwnPosts,
  isFellowAgentPost,
  canInteractWithPost,
  isRepeatedTitle,
  CROSS_AGENT_INTERACTION_CAP,
} from './interaction-rules.js';
import type { AgentPersona, CommunityPost } from '../types.js';

function makePersona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: 'agent-technova',
    name: 'TechNova',
    nickname: '테크노바',
    email: 'technova.ai@goodfriends.local',
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

function makePost(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 'post-1',
    title: 'title',
    bodyPreview: 'preview',
    authorId: 'user-1',
    authorUsername: 'someuser',
    authorNickname: '실사용자닉',
    categoryName: '자유·일상',
    categorySlug: 'chat',
    createdAt: new Date().toISOString(),
    reactionCount: 0,
    commentCount: 0,
    ...overrides,
  };
}

describe('filterOwnPosts (REGRESSION — pre-existing own-post skip behavior)', () => {
  it('excludes posts authored by the persona itself', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const posts = [
      makePost({ id: 'p1', authorNickname: '테크노바' }),
      makePost({ id: 'p2', authorNickname: '머니프로' }),
    ];
    const result = filterOwnPosts(posts, persona);
    expect(result.map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps all posts when none are authored by the persona', () => {
    const persona = makePersona({ nickname: '테크노바' });
    const posts = [makePost({ id: 'p1', authorNickname: '머니프로' }), makePost({ id: 'p2', authorNickname: '실사용자' })];
    expect(filterOwnPosts(posts, persona)).toHaveLength(2);
  });

  it('returns an empty array when the feed is empty', () => {
    const persona = makePersona({ nickname: '테크노바' });
    expect(filterOwnPosts([], persona)).toEqual([]);
  });
});

describe('isFellowAgentPost', () => {
  it('identifies a post authored by a known agent nickname', () => {
    const agentNicknames = new Set(['테크노바', '머니프로']);
    expect(isFellowAgentPost(makePost({ authorNickname: '머니프로' }), agentNicknames)).toBe(true);
  });

  it('treats an unknown nickname as a real user', () => {
    const agentNicknames = new Set(['테크노바', '머니프로']);
    expect(isFellowAgentPost(makePost({ authorNickname: '실사용자123' }), agentNicknames)).toBe(false);
  });
});

describe('canInteractWithPost (bot-ring hard cap)', () => {
  const agentNicknames = new Set(['테크노바', '머니프로']);

  it('always allows interaction with real-user posts regardless of count', () => {
    const realUserPost = makePost({ authorNickname: '실사용자' });
    expect(canInteractWithPost(realUserPost, agentNicknames, 0)).toBe(true);
    expect(canInteractWithPost(realUserPost, agentNicknames, 999)).toBe(true);
  });

  it('allows the first cross-agent interaction in a session', () => {
    const fellowPost = makePost({ authorNickname: '머니프로' });
    expect(canInteractWithPost(fellowPost, agentNicknames, 0)).toBe(true);
  });

  it('blocks cross-agent interaction once the cap is reached', () => {
    const fellowPost = makePost({ authorNickname: '머니프로' });
    expect(canInteractWithPost(fellowPost, agentNicknames, CROSS_AGENT_INTERACTION_CAP)).toBe(false);
  });
});

describe('isRepeatedTitle', () => {
  const recent = ['편의점 도시락, 이제는 포장지가 더 비싼 거 아닐까 싶은 날 - 재료비보다 인건비가…'];

  it('최근 글과 제목이 같으면 true (prod에서 실제로 중복 게시된 케이스)', () => {
    expect(isRepeatedTitle('편의점 도시락, 이제는 포장지가 더 비싼 거 아닐까 싶은 날', recent)).toBe(true);
  });

  it('공백만 다른 제목도 잡는다', () => {
    expect(isRepeatedTitle('편의점  도시락, 이제는 포장지가', recent)).toBe(true);
  });

  it('다른 제목은 false', () => {
    expect(isRepeatedTitle('김치찌개에 고등어 통조림 투입한 날', recent)).toBe(false);
  });

  it('최근 글이 없으면 false', () => {
    expect(isRepeatedTitle('아무 제목', [])).toBe(false);
  });
});
