import crypto from 'node:crypto';
import type { AgentPersona } from '../types.js';
import { loadEnrichedPersonaContent, type EnrichedPersonaContent } from './enrich.js';

/**
 * goodfriends 에이전트 10명(카테고리당 1명, news 제외)의 시드 로직.
 * 정의(말투·systemPrompt·활동 확률·username)는 content/goodfriends-agents.json에 사람이 직접 썼고,
 * 여기서는 그 정의에 계정 필드(이메일·비밀번호)를 붙여 AgentPersona로 만든다.
 * (Reafy용 100명 랜덤 생성기는 제거됨 — 유저네임이 정형 단어풀로 분해되면 봇 무리로 보이는 문제도 같이 사라진다.)
 */

/** news는 봇 전용이라 에이전트 담당이 아니다. */
export const AGENT_CATEGORY_SLUGS = ['qna', 'idea', 'free', 'frontier', 'local', 'agents', 'aiservice', 'coding', 'automation', 'creative'] as const;

export const AGENT_EMAIL_DOMAIN = 'goodfriends.local';

/** goodfriends-agents.json 한 항목: enriched 필드 + 계정/활동 필드. */
export interface GoodfriendsAgentDefinition extends EnrichedPersonaContent {
  name: string;
  username: string;
  birthdate: string;
  country: string;
  postalCode: string;
  timezone: string;
  interests: string[];
  preferredCategories: string[];
  postProb: number;
  commentProb: number;
  reactionProb: number;
  externalSearchProb: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
}

const REQUIRED_STRINGS = ['name', 'username', 'birthdate', 'country', 'postalCode', 'timezone'] as const;
const REQUIRED_NUMBERS = ['postProb', 'commentProb', 'reactionProb', 'externalSearchProb', 'minIntervalMinutes', 'maxIntervalMinutes'] as const;

export function loadAgentDefinitions(filePath?: string): GoodfriendsAgentDefinition[] {
  const defs = loadEnrichedPersonaContent(filePath) as GoodfriendsAgentDefinition[];
  defs.forEach((d, i) => {
    for (const k of REQUIRED_STRINGS) {
      if (typeof d[k] !== 'string' || !d[k]) throw new Error(`[${i}] ${k} 누락`);
    }
    for (const k of REQUIRED_NUMBERS) {
      if (typeof d[k] !== 'number' || !Number.isFinite(d[k])) throw new Error(`[${i}] ${k} 누락`);
    }
    if (!Array.isArray(d.interests) || d.interests.length === 0) throw new Error(`[${i}] interests 누락`);
    if (!Array.isArray(d.preferredCategories) || d.preferredCategories.length !== 1) {
      throw new Error(`[${i}] preferredCategories는 담당 slug 하나여야 한다`);
    }
  });
  return defs;
}

/**
 * 시드 시점에 crypto로 만든 임의 비밀번호(24자, base64url). 저장소·JSON에는 두지 않고 SQLite에만 들어간다.
 * goodfriends 가입 규칙(backend/src/auth.ts: 8자 이상)을 만족한다.
 */
export function generatePassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function buildPersonas(defs: GoodfriendsAgentDefinition[] = loadAgentDefinitions(), makePassword: () => string = generatePassword): AgentPersona[] {
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    nickname: d.nickname,
    email: `${d.username}@${AGENT_EMAIL_DOMAIN}`,
    password: makePassword(),
    birthdate: d.birthdate,
    country: d.country,
    postalCode: d.postalCode,
    timezone: d.timezone,
    username: d.username,
    bio: d.bio,
    interests: [...d.interests],
    preferredCategories: [...d.preferredCategories],
    tone: d.tone,
    systemPrompt: d.systemPrompt,
    postProb: d.postProb,
    commentProb: d.commentProb,
    reactionProb: d.reactionProb,
    externalSearchProb: d.externalSearchProb,
    minIntervalMinutes: d.minIntervalMinutes,
    maxIntervalMinutes: d.maxIntervalMinutes,
    persona: d.persona,
    emotionalProfile: d.emotionalProfile,
    communityBehavior: d.communityBehavior,
  }));
}
