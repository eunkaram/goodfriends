import { describe, it, expect } from 'vitest';
import { generatePersonas, withYa } from './generator.js';

describe('generatePersonas', () => {
  it('generates the requested count with unique ids, nicknames, and emails', () => {
    const personas = generatePersonas(100);
    expect(personas).toHaveLength(100);
    expect(new Set(personas.map((p) => p.id)).size).toBe(100);
    expect(new Set(personas.map((p) => p.nickname)).size).toBe(100);
    expect(new Set(personas.map((p) => p.email)).size).toBe(100);
  });

  it('never puts "ai" in the email local part (that becomes the public goodfriends username)', () => {
    const personas = generatePersonas(200);
    for (const p of personas) {
      const localPart = p.email.split('@')[0];
      expect(localPart.includes('ai')).toBe(false);
    }
  });

  it('never puts digits in the email local part (that becomes the public goodfriends username)', () => {
    const personas = generatePersonas(200);
    for (const p of personas) {
      const localPart = p.email.split('@')[0];
      expect(/\d/.test(localPart)).toBe(false);
    }
  });

  it('randomizes country between US/KR with a postal code matching that country', () => {
    const personas = generatePersonas(200);
    const countries = new Set(personas.map((p) => p.country));
    expect(countries.has('US')).toBe(true);
    expect(countries.has('KR')).toBe(true);
    for (const p of personas) {
      expect(['US', 'KR']).toContain(p.country);
      expect(p.postalCode).toMatch(/^\d{5}$/);
    }
  });

  it('assigns a timezone matching each persona\'s country (quiet-hours reads this per-agent)', () => {
    const personas = generatePersonas(200);
    const usZones = new Set(['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']);
    for (const p of personas) {
      if (p.country === 'KR') expect(p.timezone).toBe('Asia/Seoul');
      else expect(usZones.has(p.timezone!)).toBe(true);
    }
    // 미국은 4개 시간대 중 무작위라 200명 정도면 최소 2개 이상은 나와야 함
    const usTimezones = new Set(personas.filter((p) => p.country === 'US').map((p) => p.timezone));
    expect(usTimezones.size).toBeGreaterThan(1);
  });

  it('keeps probabilities in [0,1] and maxIntervalMinutes above minIntervalMinutes', () => {
    const personas = generatePersonas(50);
    for (const p of personas) {
      for (const prob of [p.postProb, p.commentProb, p.reactionProb, p.externalSearchProb]) {
        expect(prob).toBeGreaterThanOrEqual(0);
        expect(prob).toBeLessThanOrEqual(1);
      }
      expect(p.maxIntervalMinutes).toBeGreaterThan(p.minIntervalMinutes);
      expect(p.interests.length).toBeGreaterThan(0);
    }
  });

  it('gives agents distinct personalities so behavior is not uniformly agreeable', () => {
    const personas = generatePersonas(150);
    // 성격 라벨은 systemPrompt에 "성격: X" 형태로 박아뒀다 — 여러 종류가 실제로 섞여 나오는지 확인
    const personalityNames = new Set(personas.map((p) => p.systemPrompt.match(/성격: (\S+)\./)?.[1]));
    expect(personalityNames.size).toBeGreaterThan(5);
    // 무관심/싸가지없는 성격은 반응 확률이 친절/다정 성격보다 낮아야 한다(behavioral 차이가 실제로 반영됨)
    const indifferent = personas.filter((p) => p.systemPrompt.includes('성격: 무관심함'));
    const kind = personas.filter((p) => p.systemPrompt.includes('성격: 친절함') || p.systemPrompt.includes('성격: 다정함'));
    if (indifferent.length > 0 && kind.length > 0) {
      const avg = (arr: typeof personas, key: 'reactionProb') => arr.reduce((sum, p) => sum + p[key], 0) / arr.length;
      expect(avg(indifferent, 'reactionProb')).toBeLessThan(avg(kind, 'reactionProb'));
    }
  });

  it('mixes several nickname shapes instead of one uniform "형용사+명사" pattern', () => {
    const nicknames = generatePersonas(300).map((p) => p.nickname);
    // 형태가 여러 개 섞이면 길이가 들쭉날쭉해진다 — 전부 같은 패턴이면 길이대 몰림
    expect(new Set(nicknames.map((n) => n.length)).size).toBeGreaterThan(3);
    // 영어 닉네임 패턴(Moonlight 등)이 300개 중 하나도 안 나오는 건 사실상 불가능한 확률
    expect(nicknames.some((n) => /^[A-Z][a-z]+$/.test(n))).toBe(true);
    // 짧은 명사 단독형(콩이, 골목 등)도 섞여 있어야 함
    expect(nicknames.some((n) => /^[가-힣]{2,3}$/.test(n))).toBe(true);
  });
});

describe('withYa (받침 유무에 맞는 "야"/"이야" 조사 선택)', () => {
  it('attaches "야" after a word with no final consonant', () => {
    expect(withYa('하루')).toBe('하루야');
    expect(withYa('필름러')).toBe('필름러야');
  });

  it('attaches "이야" after a word ending in a final consonant (받침)', () => {
    expect(withYa('우체통')).toBe('우체통이야');
    expect(withYa('옥상')).toBe('옥상이야');
  });
});
