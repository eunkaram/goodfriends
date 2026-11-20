import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentPersona } from '../types.js';
import type { PersonaRegistry } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 'data'라는 이름의 하위 폴더는 .gitignore의 `data/` 패턴에 걸려 커밋이 안 되므로
// 'content'로 뒀다(2026-09-06에 실제로 이 문제로 한 번 빠뜨릴 뻔함).
const DEFAULT_ENRICHED_DATA_PATH = path.join(__dirname, 'content', 'enriched-community-agents.json');

/** enriched-community-agents.json 한 항목의 형태. id로 기존 페르소나와 매칭한다. */
export interface EnrichedPersonaContent {
  id: string;
  nickname: string;
  bio: string;
  tone: string;
  persona: NonNullable<AgentPersona['persona']>;
  emotionalProfile: NonNullable<AgentPersona['emotionalProfile']>;
  communityBehavior: NonNullable<AgentPersona['communityBehavior']>;
  systemPrompt: string;
}

const REQUIRED_TOP_FIELDS = ['id', 'nickname', 'bio', 'tone', 'persona', 'emotionalProfile', 'communityBehavior', 'systemPrompt'] as const;
const REQUIRED_PERSONA_FIELDS = ['role', 'primaryBoards', 'values', 'perspective', 'recentContext', 'baselineMood', 'socialEnergy'] as const;
const REQUIRED_EMOTIONAL_FIELDS = ['trait', 'core', 'trigger', 'repair', 'style'] as const;
const REQUIRED_BEHAVIOR_FIELDS = ['post', 'comment', 'reaction', 'disagreement', 'continuity'] as const;

/** 항목 하나에 필수 필드가 다 있고 비어있지 않은지 확인. 없으면 사유를 담아 반환. */
function validateEntry(entry: any, index: number): string | null {
  for (const field of REQUIRED_TOP_FIELDS) {
    if (entry?.[field] === undefined || entry[field] === null || entry[field] === '') {
      return `[${index}] 최상위 필드 누락: ${field}`;
    }
  }
  for (const field of REQUIRED_PERSONA_FIELDS) {
    if (!entry.persona?.[field]) return `[${index}] persona.${field} 누락`;
  }
  for (const field of REQUIRED_EMOTIONAL_FIELDS) {
    if (!entry.emotionalProfile?.[field]) return `[${index}] emotionalProfile.${field} 누락`;
  }
  for (const field of REQUIRED_BEHAVIOR_FIELDS) {
    if (!entry.communityBehavior?.[field]) return `[${index}] communityBehavior.${field} 누락`;
  }
  return null;
}

/**
 * enriched-community-agents.json을 읽고 검증한다. 필드 누락 항목이 있으면 예외를 던진다
 * (fail-fast — 절반만 적용된 페르소나 세트가 조용히 배포되는 것보다 낫다).
 */
export function loadEnrichedPersonaContent(filePath: string = DEFAULT_ENRICHED_DATA_PATH): EnrichedPersonaContent[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`enriched persona data must be an array, got ${typeof data}`);
  }

  const errors: string[] = [];
  data.forEach((entry, i) => {
    const err = validateEntry(entry, i);
    if (err) errors.push(err);
  });
  if (errors.length > 0) {
    throw new Error(`enriched persona data has ${errors.length} invalid entr${errors.length === 1 ? 'y' : 'ies'}:\n${errors.join('\n')}`);
  }

  const ids = data.map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    throw new Error(`enriched persona data has duplicate ids: ${[...new Set(dupes)].join(', ')}`);
  }

  return data as EnrichedPersonaContent[];
}

/**
 * 기존(운영 중인) 페르소나에 enrichment 콘텐츠를 덮어씌운다.
 * - email/password/country 등 계정과 묶인 운영 필드는 절대 안 건드림(이미 가입된 goodfriends
 *   계정과 어긋나면 로그인이 깨진다).
 * - nickname은 base(기존) 값을 그대로 유지한다 — enrichment 파일의 nickname은 매칭 참고용일
 *   뿐, 실제 가입된 goodfriends 계정의 닉네임과 어긋날 수 있어서 신뢰하지 않는다(합리적 기본값 가정,
 *   결과 보고에 명시).
 * - 기존 bio/tone/systemPrompt는 잃어버리지 않게 legacy에 보존한다.
 */
export function applyEnrichment(base: AgentPersona, enriched: EnrichedPersonaContent): AgentPersona {
  return {
    ...base,
    bio: enriched.bio,
    tone: enriched.tone,
    systemPrompt: enriched.systemPrompt,
    persona: enriched.persona,
    emotionalProfile: enriched.emotionalProfile,
    communityBehavior: enriched.communityBehavior,
    legacy: base.legacy ?? { bio: base.bio, tone: base.tone, systemPrompt: base.systemPrompt },
  };
}

export interface ApplyEnrichmentResult {
  updated: string[];
  /** enrichment 파일에는 있지만 registry에 없는 id (registry 쪽이 다시 시드돼서 id가 안 겹치는 경우 등) */
  missingInRegistry: string[];
}

/** registry에 있는 페르소나들에 enrichment를 실제로 적용하고 저장한다. */
export function applyEnrichmentToRegistry(
  registry: PersonaRegistry,
  enrichedList: EnrichedPersonaContent[] = loadEnrichedPersonaContent()
): ApplyEnrichmentResult {
  const updated: string[] = [];
  const missingInRegistry: string[] = [];

  for (const enriched of enrichedList) {
    const base = registry.get(enriched.id);
    if (!base) {
      missingInRegistry.push(enriched.id);
      continue;
    }
    registry.set(applyEnrichment(base, enriched));
    updated.push(enriched.id);
  }

  return { updated, missingInRegistry };
}
