import { describe, it, expect } from 'vitest';
import { buildPersonaPromptPrefix, buildActivityBehaviorNote, PERSONA_SAFETY_REMINDER } from './persona-prompt.js';
import { loadEnrichedPersonaContent } from '../personas/enrich.js';
import type { AgentPersona } from '../types.js';

const enrichedSample = loadEnrichedPersonaContent()[0];

function personaWith(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: 'agent-test',
    name: '김민수',
    nickname: enrichedSample.nickname,
    email: 'x@reafy.local',
    password: 'pw',
    birthdate: '1995-01-01',
    country: 'US',
    postalCode: '10001',
    bio: enrichedSample.bio,
    interests: ['travel'],
    preferredCategories: ['travel'],
    tone: enrichedSample.tone,
    systemPrompt: enrichedSample.systemPrompt,
    postProb: 0.2,
    commentProb: 0.7,
    reactionProb: 0.8,
    externalSearchProb: 0.5,
    minIntervalMinutes: 15,
    maxIntervalMinutes: 60,
    persona: enrichedSample.persona,
    emotionalProfile: enrichedSample.emotionalProfile,
    communityBehavior: enrichedSample.communityBehavior,
    ...overrides,
  };
}

describe('buildPersonaPromptPrefix', () => {
  it('always leads with persona.systemPrompt (최우선 페르소나 컨텍스트)', () => {
    const p = personaWith();
    const prompt = buildPersonaPromptPrefix(p, 'post');
    expect(prompt.startsWith(p.systemPrompt)).toBe(true);
  });

  it('produces a different prompt per activity type for the same persona (공통 프롬프트 재사용 금지)', () => {
    const p = personaWith();
    const post = buildPersonaPromptPrefix(p, 'post');
    const comment = buildPersonaPromptPrefix(p, 'comment');
    const reply = buildPersonaPromptPrefix(p, 'reply');
    const reaction = buildPersonaPromptPrefix(p, 'reaction');

    const prompts = [post, comment, reply, reaction];
    expect(new Set(prompts).size).toBe(4);
    expect(post).toContain('새 글을 작성할 차례');
    expect(comment).toContain('댓글을 작성할 차례');
    expect(reply).toContain('답글을 작성할 차례');
    expect(reaction).toContain('판단할 차례');
  });

  // 2026-09-07 실제로 겪은 사고: enriched 페르소나의 systemPrompt 자체가 이미 정체성/맥락/
  // 성격/4개 활동 전부의 커뮤니티 행동 규칙/안전 지침을 담고 있는데, 여기서 같은 내용을
  // 감정 성향·행동 기준·안전 지침으로 또 붙여서 50개 에이전트를 그대로 둔 채 토큰 사용량이
  // 거의 2배로 뛰었다. 그 중복이 다시 생기지 않는지 고정하는 회귀 테스트.
  it('does not duplicate communityBehavior/emotionalProfile/safety text for an enriched persona (토큰 낭비 회귀 테스트)', () => {
    const p = personaWith();
    const prompt = buildPersonaPromptPrefix(p, 'comment');
    // systemPrompt 자체엔 이 값들이 원래 들어있다(enrichment가 이 필드들로 합성한 거니까) —
    // 그건 정상. 문제는 그 뒤에 "또" 붙이는 것이므로, systemPrompt 이후로 덧붙은 부분만 본다.
    const appended = prompt.slice(p.systemPrompt.length);

    expect(appended).not.toContain(p.communityBehavior!.comment);
    expect(appended).not.toContain(p.emotionalProfile!.core);
    expect(appended).not.toContain(p.persona!.baselineMood);
    expect(appended).not.toContain('[이 활동에 대한 당신만의 기준]');
    expect(appended).not.toContain('[항상 지킬 것]');
    // systemPrompt 뒤에는 "[지금 할 일]" 한 줄 정도만 추가돼야 한다(대폭 안 늘어남)
    expect(appended.length).toBeLessThan(100);
  });

  it('falls back to the legacy behavior-note + safety reminder when a persona has no enrichment (하위 호환)', () => {
    const p = personaWith({ persona: undefined, emotionalProfile: undefined, communityBehavior: undefined });
    const prompt = buildPersonaPromptPrefix(p, 'post');
    expect(prompt.startsWith(p.systemPrompt)).toBe(true);
    expect(prompt).toContain(PERSONA_SAFETY_REMINDER.trim());
    // communityBehavior가 없으니 활동별 기준 섹션 자체가 안 생겨야 함
    expect(prompt).not.toContain('[이 활동에 대한 당신만의 기준]');
  });

  it('includes a repetition-avoidance block only when recentTexts are given', () => {
    const p = personaWith();
    const without = buildPersonaPromptPrefix(p, 'post');
    const withRecent = buildPersonaPromptPrefix(p, 'post', ['어제 이렇게 시작하는 글을 썼다']);
    expect(without).not.toContain('반복 방지');
    expect(withRecent).toContain('반복 방지');
    expect(withRecent).toContain('어제 이렇게 시작하는 글을 썼다');
  });
});

describe('buildActivityBehaviorNote', () => {
  it('returns empty string for a persona without communityBehavior', () => {
    const p = personaWith({ communityBehavior: undefined });
    expect(buildActivityBehaviorNote(p, 'post')).toBe('');
  });

  it('still differentiates by activity for a non-enriched persona that somehow has communityBehavior set', () => {
    const p = personaWith();
    expect(buildActivityBehaviorNote(p, 'post')).toContain(p.communityBehavior!.post);
    expect(buildActivityBehaviorNote(p, 'reaction')).toContain(p.communityBehavior!.reaction);
  });
});

// "금지 표현 및 과도한 반복을 최소한으로 검사" — enrichment 데이터 자체에 대한 최소 검증.
// 실제 LLM 출력 검사는 content-gate.ts(TOXIC_KEYWORDS)가 런타임에 매번 하고, 여기서는 입력
// 데이터(100명 systemPrompt) 자체가 오염돼 있지 않은지, 그리고 전부 판박이로 안 나왔는지만 본다.
describe('enriched dataset quality checks', () => {
  const TOXIC_KEYWORDS = ['시발', '개새끼', '병신', '지랄', 'ㅅㅂ', 'ㅄ'];

  it('contains no toxic keywords anywhere in the enriched text fields', () => {
    const entries = loadEnrichedPersonaContent();
    for (const e of entries) {
      const haystack = [
        e.bio,
        e.tone,
        e.systemPrompt,
        e.persona.perspective,
        e.emotionalProfile.core,
        e.communityBehavior.post,
        e.communityBehavior.comment,
        e.communityBehavior.disagreement,
      ].join('\n');
      for (const word of TOXIC_KEYWORDS) {
        expect(haystack.includes(word), `${e.id} contains "${word}"`).toBe(false);
      }
    }
  });

  it('does not repeat the exact same systemPrompt/bio across different agents', () => {
    const entries = loadEnrichedPersonaContent();
    expect(new Set(entries.map((e) => e.systemPrompt)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.bio)).size).toBeGreaterThan(entries.length * 0.8);
  });
});
