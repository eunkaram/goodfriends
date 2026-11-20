import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_CATEGORY_SLUGS, AGENT_EMAIL_DOMAIN, buildPersonas, generatePassword, loadAgentDefinitions } from './generator.js';
import { PersonaRegistry } from './registry.js';
import { deriveUsername, pickPostingCategory } from '../client/goodfriends-client.js';

// backend/src/reserved-usernames.ts · reserved-nicknames.ts 에서 옮긴 값(두 저장소 모듈은 import 경계가 달라 사본으로 검사한다)
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'superadmin', 'moderator', 'mod', 'staff', 'support', 'help', 'official', 'team', 'owner', 'security', 'dev',
  'reafy', 'reafyofficial', 'reafy_official', 'reafyteam', 'gomissy',
  'noreply', 'postmaster', 'webmaster', 'hostmaster', 'abuse', 'mailerdaemon', 'info', 'contact',
  'ai_news_bot', 'ai_digest_bot', 'ai_bot',
  'api', 'www', 'static', 'assets', 'login', 'logout', 'signup', 'signin', 'register', 'settings', 'profile', 'search', 'notifications', 'messages', 'feed', 'market', 'about', 'terms', 'privacy', 'blog', 'docs', 'next', 'favicon', 'robots', 'sitemap',
  'null', 'undefined', 'none', 'anonymous', 'guest', 'test', 'deleted', 'unknown', 'everyone', 'all', 'here',
]);
const RESERVED_NICKNAMES = ['관리자', '운영자', '운영팀', '매니저', '모더레이터', '어드민', '고객센터', '고객지원', '공식', '공지', '공지사항', '시스템', '봇', '레피', '리피', '탈퇴한사용자', '알수없음', '익명', 'admin', 'administrator', 'official', 'moderator', 'staff', 'support', 'system', 'reafy'];
const PROFANITY = ['씨발', '시발', '병신', '개새끼', '새끼', '좆', '지랄', '미친놈', '미친년', '걸레', '창녀', '개소리', '닥쳐', '꺼져', 'fuck', 'shit', 'bitch', 'asshole', 'cunt'];

const defs = loadAgentDefinitions();
const personas = buildPersonas(defs);

describe('goodfriends 에이전트 10명', () => {
  it('정확히 10명이고 담당 slug가 10개 카테고리와 1:1이다 (news 제외)', () => {
    expect(personas).toHaveLength(10);
    const slugs = personas.map((p) => p.preferredCategories);
    for (const s of slugs) expect(s).toHaveLength(1);
    expect(slugs.map((s) => s[0]).sort()).toEqual([...AGENT_CATEGORY_SLUGS].sort());
    expect(slugs.flat()).not.toContain('news');
  });

  it('id·username·nickname·email이 서로 유일하다', () => {
    for (const key of ['id', 'username', 'nickname', 'email'] as const) {
      expect(new Set(personas.map((p) => p[key])).size, key).toBe(10);
    }
  });

  it('username이 deriveUsername 규칙을 만족하고 예약어와 안 겹치며 "ai" 같은 티가 없다', () => {
    for (const p of personas) {
      const u = p.username!;
      expect(u, u).toMatch(/^[a-z0-9_]+$/);
      expect(u.length, u).toBeLessThanOrEqual(20);
      expect(deriveUsername(p.email), u).toBe(u);
      expect(RESERVED_USERNAMES.has(u), u).toBe(false);
      expect(u.includes('ai'), u).toBe(false);
    }
  });

  it('username이 같은 단어풀 조합 한 가지 모양으로 몰려 있지 않다 (모양 3종 이상)', () => {
    const shape = (u: string) => (/_/.test(u) ? (/\d/.test(u) ? 'under+digit' : 'under') : /\d/.test(u) ? 'digit' : 'plain');
    expect(new Set(personas.map((p) => shape(p.username!))).size).toBeGreaterThanOrEqual(3);
  });

  it('이메일 도메인이 @goodfriends.local이고 로컬파트가 username이다', () => {
    for (const p of personas) {
      expect(p.email).toBe(`${p.username}@${AGENT_EMAIL_DOMAIN}`);
      expect(p.email.endsWith('@goodfriends.local')).toBe(true);
    }
  });

  it('nickname이 예약·욕설 닉네임에 걸리지 않는다', () => {
    for (const p of personas) {
      const n = p.nickname.trim().toLowerCase();
      expect(RESERVED_NICKNAMES.map((x) => x.toLowerCase()).includes(n), p.nickname).toBe(false);
      expect(PROFANITY.some((w) => n.includes(w)), p.nickname).toBe(false);
    }
  });

  it('interests에 담당 분야 키워드가 있다', () => {
    for (const p of personas) expect(p.interests.length).toBeGreaterThanOrEqual(5);
  });

  it('systemPrompt에 공통 정확성 규칙이 들어 있고 AI임을 밝히지 않는다는 지침이 있다', () => {
    for (const p of personas) {
      expect(p.systemPrompt, p.id).toContain('확인된 것만');
      expect(p.systemPrompt, p.id).toContain('지어내지 않는다');
      expect(p.systemPrompt, p.id).toContain('모르거나 확인되지 않은 내용은 쓰지 않는다');
      expect(p.systemPrompt, p.id).toContain('정치, 혐오, 광고');
      expect(p.systemPrompt, p.id).toContain('AI라거나');
    }
  });

  it('말투 지침이 10명 모두 다르다 (같은 지침 문구 복붙 방지)', () => {
    const styleSection = (s: string) => s.slice(s.indexOf('[말투와 글버릇]'), s.indexOf('[성격]'));
    expect(new Set(personas.map((p) => styleSection(p.systemPrompt))).size).toBe(10);
    expect(new Set(personas.map((p) => p.tone)).size).toBe(10);
    expect(new Set(personas.map((p) => p.bio)).size).toBe(10);
  });

  it('이모지·자모 사용이 분산돼 있다', () => {
    const hasEmojiUse = personas.filter((p) => /이모지(는|를)? (가끔|자주)|이모지를 자주/.test(p.systemPrompt)).length;
    const noEmoji = personas.filter((p) => /이모지[^.\n]*쓰지 않는다/.test(p.systemPrompt)).length;
    expect(hasEmojiUse).toBeGreaterThanOrEqual(2);
    expect(noEmoji).toBeGreaterThanOrEqual(2);
  });

  it('활동 간격: 페르소나당 하루 신규 글 기대치가 1.5편 이하다 (조용한 시간 5시간 제외 19시간 기준)', () => {
    for (const p of personas) {
      expect(p.minIntervalMinutes).toBeLessThan(p.maxIntervalMinutes);
      const avgInterval = (p.minIntervalMinutes + p.maxIntervalMinutes) / 2;
      const postsPerDay = ((19 * 60) / avgInterval) * p.postProb;
      expect(postsPerDay, p.id).toBeLessThanOrEqual(1.5);
      expect(postsPerDay, p.id).toBeGreaterThan(0.3);
    }
  });

  it('country/timezone이 한국이고 enriched 필드가 다 있다', () => {
    for (const p of personas) {
      expect(p.country).toBe('KR');
      expect(p.timezone).toBe('Asia/Seoul');
      expect(p.persona && p.emotionalProfile && p.communityBehavior).toBeTruthy();
    }
  });
});

describe('비밀번호', () => {
  it('JSON 정의에는 비밀번호가 없다', () => {
    const raw = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'content', 'goodfriends-agents.json'), 'utf-8');
    expect(raw.toLowerCase()).not.toContain('password');
  });

  it('crypto로 만든 8자 이상 값이며 시드마다 다르다 (goodfriends 가입 규칙: auth.ts 8자 이상)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw.length).toBeGreaterThanOrEqual(8);
      expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
      seen.add(pw);
    }
    expect(seen.size).toBe(50);
    expect(new Set(personas.map((p) => p.password)).size).toBe(10);
    for (const p of personas) expect(p.password.length).toBeGreaterThanOrEqual(8);
  });
});

describe('PersonaRegistry 시드', () => {
  it('빈 DB에서 10명을 시드하고, 다시 열어도 비밀번호가 유지된다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goodfriends-seed-test-'));
    try {
      const first = new PersonaRegistry(dir).getAll();
      expect(first).toHaveLength(10);
      expect(first.map((p) => p.preferredCategories[0]).sort()).toEqual([...AGENT_CATEGORY_SLUGS].sort());
      const second = new PersonaRegistry(dir).getAll();
      expect(second).toHaveLength(10);
      const byId = new Map(first.map((p) => [p.id, p.password]));
      for (const p of second) expect(p.password).toBe(byId.get(p.id));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('신규 글 카테고리 선택 (담당 slug만)', () => {
  const categories = [...AGENT_CATEGORY_SLUGS, 'news'].map((slug) => ({ id: `id-${slug}`, name: slug, slug }));

  it('각 페르소나는 담당 slug만 반환받는다 (무작위 폴백 없음)', () => {
    for (const p of personas) {
      for (let i = 0; i < 20; i++) {
        expect(pickPostingCategory(categories, p.preferredCategories)?.slug).toBe(p.preferredCategories[0]);
      }
    }
  });

  it('담당 카테고리가 서버에 없으면 null이다 (다른 곳에 쓰지 않는다)', () => {
    expect(pickPostingCategory(categories.filter((c) => c.slug !== 'coding'), ['coding'])).toBeNull();
  });

  it('news는 담당으로 지정돼도 제외된다', () => {
    expect(pickPostingCategory(categories, ['news'])).toBeNull();
  });
});
