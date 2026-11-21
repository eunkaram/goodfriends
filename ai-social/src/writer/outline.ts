/**
 * 개요 생성: ResearchBundle + 페르소나 → {title, angle, sections[], lengthHint}.
 * 길이 상한 없음 — 사실 수·주제에 맞춰 짧은 팁부터 긴 정리까지. 모든 섹션은 실제 사실 카드 id에 근거해야 한다.
 */
import { buildPersonaPromptPrefix } from '../llm/persona-prompt.js';
import type { AgentPersona } from '../types.js';
import type { ResearchBundle } from './types.js';
import {
  DATA_ONLY_NOTICE,
  buildCardRefs,
  normalizeCardId,
  parseJsonLoose,
  renderCardsForPrompt,
  type WriterDeps,
} from './write-types.js';

export type LengthHint = 'short' | 'medium' | 'long';

export interface OutlineSection {
  heading?: string;
  purpose: string;
  factIds: string[];
}

export interface Outline {
  title: string;
  angle: string;
  sections: OutlineSection[];
  lengthHint: LengthHint;
}

export class OutlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutlineError';
  }
}

const LENGTH_HINTS: LengthHint[] = ['short', 'medium', 'long'];

/**
 * LLM 응답 → 검증된 Outline. 존재하지 않는 카드 id는 버리고, 유효 id가 하나도 없는 섹션은 제거한다
 * (사실 카드에 없는 내용 섹션 금지). 남는 섹션이 없거나 제목이 없으면 OutlineError.
 */
export function validateOutline(raw: unknown, validIds: Set<string>): Outline {
  const o = raw as any;
  if (!o || typeof o !== 'object') throw new OutlineError('개요가 JSON 객체가 아니다');
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) throw new OutlineError('개요에 title이 없다');
  if (!Array.isArray(o.sections)) throw new OutlineError('개요에 sections 배열이 없다');

  const sections: OutlineSection[] = [];
  for (const s of o.sections) {
    if (!s || typeof s !== 'object') continue;
    const ids: string[] = [];
    for (const v of Array.isArray(s.factIds) ? s.factIds : []) {
      const id = normalizeCardId(v);
      if (id && validIds.has(id) && !ids.includes(id)) ids.push(id);
    }
    if (ids.length === 0) continue;
    const purpose = typeof s.purpose === 'string' ? s.purpose.trim() : '';
    const heading = typeof s.heading === 'string' && s.heading.trim() ? s.heading.trim() : undefined;
    sections.push({ ...(heading ? { heading } : {}), purpose: purpose || heading || '', factIds: ids });
  }
  if (sections.length === 0) throw new OutlineError('유효한 사실 카드에 근거한 섹션이 없다');

  const lengthHint: LengthHint = LENGTH_HINTS.includes(o.lengthHint)
    ? o.lengthHint
    : sections.length <= 1 ? 'short' : sections.length <= 3 ? 'medium' : 'long';
  return { title, angle: typeof o.angle === 'string' ? o.angle.trim() : '', sections, lengthHint };
}

export async function generateOutline(
  bundle: ResearchBundle,
  persona: AgentPersona,
  deps: WriterDeps
): Promise<Outline> {
  const cards = buildCardRefs(bundle);
  if (cards.size === 0) throw new OutlineError('사실 카드가 없다');
  const validIds = new Set(cards.keys());

  const system = `${buildPersonaPromptPrefix(persona, 'post')}

당신은 goodfriends 커뮤니티에 올릴 글의 개요를 짜는 중입니다. ${DATA_ONLY_NOTICE}

규칙:
- 글 길이에 상한은 없습니다. 사실 카드가 적고 단순하면 섹션 1개짜리 짧은 팁으로, 사실이 많고 주제가 크면 섹션 여러 개의 긴 정리로 짜세요. 분량을 채우려고 억지로 늘리지 마세요.
- 모든 섹션은 아래 사실 카드에 근거해야 합니다. 섹션마다 쓸 카드 id를 factIds에 넣으세요. 카드에 없는 내용(직접 써본 경험, 벤치마크, 수치, 전망)으로 섹션을 만들지 마세요.
- 제목은 과장된 낚시성 없이 구체적으로. heading은 필요할 때만, 마크다운 기호 없는 평문 한 줄로.
- lengthHint는 "short"(1~2문단), "medium", "long" 중 하나.
- 반드시 JSON으로만 출력:
{"title":"...","angle":"이 글의 관점 한 문장","sections":[{"heading":"(선택)","purpose":"이 섹션에서 전달할 것","factIds":["F1","F2"]}],"lengthHint":"medium"}`;

  const user = `[카테고리]: ${bundle.category}
[주제]: ${bundle.topic.title}

[사실 카드]
${renderCardsForPrompt([...cards.values()])}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const feedback = lastErr ? `\n\n[이전 응답 문제] ${lastErr.message}. 형식과 factIds를 고쳐서 다시 출력하세요.` : '';
    const raw = await deps.llm.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user + feedback },
      ],
      true,
      { timeoutMs: deps.timeoutMs, maxTokens: 2048 }
    );
    const parsed = parseJsonLoose(raw);
    try {
      if (parsed === null) throw new OutlineError('JSON 파싱 실패');
      return validateOutline(parsed, validIds);
    } catch (err: any) {
      lastErr = err;
      deps.log?.(`[outline] 시도 ${attempt + 1} 실패: ${err.message}`);
    }
  }
  throw lastErr ?? new OutlineError('개요 생성 실패');
}
