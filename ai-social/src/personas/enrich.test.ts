import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnrichedPersonaContent, applyEnrichment, applyEnrichmentToRegistry } from './enrich.js';
import { PersonaRegistry } from './registry.js';
import type { AgentPersona } from '../types.js';

function baseFor(id: string): AgentPersona {
  return {
    id,
    name: '김민수',
    nickname: 'oldnick',
    email: `${id}@reafy.local`,
    password: 'secret123!',
    birthdate: '1995-01-01',
    country: 'US',
    postalCode: '10001',
    bio: '기존 bio',
    interests: ['chat'],
    preferredCategories: ['chat'],
    tone: '기존 tone',
    systemPrompt: '기존 systemPrompt',
    postProb: 0.2,
    commentProb: 0.7,
    reactionProb: 0.8,
    externalSearchProb: 0.5,
    minIntervalMinutes: 15,
    maxIntervalMinutes: 60,
  };
}

describe('loadEnrichedPersonaContent (실제 데이터 파일 기준)', () => {
  it('loads exactly 100 entries', () => {
    const entries = loadEnrichedPersonaContent();
    expect(entries).toHaveLength(100);
  });

  it('has every required field non-empty on every entry', () => {
    const entries = loadEnrichedPersonaContent();
    for (const e of entries) {
      expect(e.id).toBeTruthy();
      expect(e.nickname).toBeTruthy();
      expect(e.bio).toBeTruthy();
      expect(e.tone).toBeTruthy();
      expect(e.systemPrompt).toBeTruthy();
      for (const k of ['role', 'primaryBoards', 'values', 'perspective', 'recentContext', 'baselineMood', 'socialEnergy'] as const) {
        expect(e.persona[k], `${e.id}.persona.${k}`).toBeTruthy();
      }
      for (const k of ['trait', 'core', 'trigger', 'repair', 'style'] as const) {
        expect(e.emotionalProfile[k], `${e.id}.emotionalProfile.${k}`).toBeTruthy();
      }
      for (const k of ['post', 'comment', 'reaction', 'disagreement', 'continuity'] as const) {
        expect(e.communityBehavior[k], `${e.id}.communityBehavior.${k}`).toBeTruthy();
      }
    }
  });

  it('has unique ids', () => {
    const entries = loadEnrichedPersonaContent();
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('throws with a clear message when a required field is missing', () => {
    const tmp = path.join(os.tmpdir(), `bad-enriched-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify([{ id: 'agent-001', nickname: 'x', bio: 'y', tone: 'z', systemPrompt: 'w' /* persona 등 누락 */ }]));
    expect(() => loadEnrichedPersonaContent(tmp)).toThrow(/persona/);
    fs.rmSync(tmp);
  });

  it('throws on duplicate ids', () => {
    const entries = loadEnrichedPersonaContent();
    const tmp = path.join(os.tmpdir(), `dup-enriched-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify([entries[0], entries[0]]));
    expect(() => loadEnrichedPersonaContent(tmp)).toThrow(/duplicate/);
    fs.rmSync(tmp);
  });
});

describe('applyEnrichment (병합 로직)', () => {
  const enriched = loadEnrichedPersonaContent()[0];

  it('overwrites bio/tone/systemPrompt/persona/emotionalProfile/communityBehavior from the enrichment content', () => {
    const base = baseFor(enriched.id);
    const merged = applyEnrichment(base, enriched);

    expect(merged.bio).toBe(enriched.bio);
    expect(merged.tone).toBe(enriched.tone);
    expect(merged.systemPrompt).toBe(enriched.systemPrompt);
    expect(merged.persona).toEqual(enriched.persona);
    expect(merged.emotionalProfile).toEqual(enriched.emotionalProfile);
    expect(merged.communityBehavior).toEqual(enriched.communityBehavior);
  });

  it('never touches account/operational fields (email, password, country, probabilities, ...)', () => {
    const base = baseFor(enriched.id);
    const merged = applyEnrichment(base, enriched);

    expect(merged.email).toBe(base.email);
    expect(merged.password).toBe(base.password);
    expect(merged.country).toBe(base.country);
    expect(merged.postalCode).toBe(base.postalCode);
    expect(merged.postProb).toBe(base.postProb);
    expect(merged.commentProb).toBe(base.commentProb);
    expect(merged.minIntervalMinutes).toBe(base.minIntervalMinutes);
    expect(merged.maxIntervalMinutes).toBe(base.maxIntervalMinutes);
  });

  it('keeps the base nickname (identifier) instead of trusting the enrichment file\'s nickname', () => {
    const base = baseFor(enriched.id);
    const merged = applyEnrichment(base, enriched);
    expect(merged.nickname).toBe('oldnick');
  });

  it('preserves the pre-enrichment bio/tone/systemPrompt under legacy (no data loss)', () => {
    const base = baseFor(enriched.id);
    const merged = applyEnrichment(base, enriched);
    expect(merged.legacy).toEqual({ bio: '기존 bio', tone: '기존 tone', systemPrompt: '기존 systemPrompt' });
  });

  it('does not overwrite an already-set legacy on a second application (no double-loss)', () => {
    const base = baseFor(enriched.id);
    const once = applyEnrichment(base, enriched);
    const differentEnriched = { ...enriched, bio: '두 번째 enrichment bio' };
    const twice = applyEnrichment(once, differentEnriched);
    expect(twice.legacy).toEqual({ bio: '기존 bio', tone: '기존 tone', systemPrompt: '기존 systemPrompt' });
    expect(twice.bio).toBe('두 번째 enrichment bio');
  });
});

describe('applyEnrichmentToRegistry (100명 로드 확인)', () => {
  it('applies enrichment to all 100 registry personas matched by id, and skips ones not present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reafy-enrich-test-'));
    try {
      const registry = new PersonaRegistry(tmpDir); // 비어있으면 defaults.ts로 100명 자동 시드됨
      const before = registry.getAll();
      expect(before).toHaveLength(100);

      const result = applyEnrichmentToRegistry(registry);

      expect(result.updated).toHaveLength(100);
      expect(result.missingInRegistry).toHaveLength(0);

      const after = registry.getAll();
      for (const p of after) {
        expect(p.persona, p.id).toBeTruthy();
        expect(p.emotionalProfile, p.id).toBeTruthy();
        expect(p.communityBehavior, p.id).toBeTruthy();
        expect(p.legacy, p.id).toBeTruthy();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports missing ids instead of throwing when registry and enrichment file diverge', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reafy-enrich-test-'));
    try {
      const registry = new PersonaRegistry(tmpDir);
      // registry를 하나만 남기고 다 지워서 의도적으로 어긋나게 만든다
      const [keep, ...rest] = registry.getAll();
      for (const p of rest) registry.remove(p.id);

      const result = applyEnrichmentToRegistry(registry);
      expect(result.updated).toEqual([keep.id]);
      expect(result.missingInRegistry.length).toBe(99);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
