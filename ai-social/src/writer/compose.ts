/**
 * 본문 작성: 개요의 섹션 단위로 생성. 섹션마다 배정된 사실 카드만 컨텍스트로 준다.
 * reafy의 "2~5문장으로 짧게"·"출처 URL 금지" 규칙은 적용하지 않는다(길이 상한 없음, 출처는 끝의 '참고' 줄).
 * 문장별 근거 카드는 내부 마커([F3])로 받아 DraftSentence.cardIds에 보관하고 최종 출력에서는 제거한다.
 */
import { ANTI_AI_STYLE_RULE } from '../llm/llm-client.js';
import { buildPersonaPromptPrefix } from '../llm/persona-prompt.js';
import type { AgentPersona } from '../types.js';
import type { Outline } from './outline.js';
import type { ResearchBundle } from './types.js';
import {
  DATA_ONLY_NOTICE,
  buildCardRefs,
  cleanMarkdownLine,
  parseSectionText,
  renderBody,
  renderCardsForPrompt,
  type CardRef,
  type Draft,
  type DraftSection,
  type WriterDeps,
} from './write-types.js';

export class ComposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeError';
  }
}

const LENGTH_GUIDE: Record<Outline['lengthHint'], string> = {
  short: '이 글은 짧은 편입니다. 섹션당 1~2문단이면 충분합니다.',
  medium: '이 글은 중간 길이입니다. 섹션당 1~3문단으로 쓰세요.',
  long: '이 글은 긴 정리 글입니다. 필요한 만큼 충분히 풀어 쓰되 카드에 없는 얘기로 분량을 채우지 마세요.',
};

export function buildSectionSystemPrompt(persona: AgentPersona): string {
  return `${buildPersonaPromptPrefix(persona, 'post')}

당신은 goodfriends 커뮤니티의 활동 멤버 '${persona.nickname}'입니다. 말투(${persona.tone})를 유지하세요.
지금은 외부 자료를 읽고 정리해 공유하는 글의 한 섹션을 쓰는 중입니다. ${DATA_ONLY_NOTICE}

작성 규칙:
1. 아래 [사실 카드]에 있는 내용만 쓰세요. 카드의 주장·원문에 없는 숫자·버전·날짜·가격·제품명·모델명·벤치마크를 절대 만들어내지 마세요.
2. 직접 써봤다, 돌려봤다, 측정했다 같은 지어낸 사용 경험을 쓰지 마세요. 입장은 "문서 보니까", "릴리스 노트에 따르면", "논문을 보면"처럼 자료를 읽은 사람입니다. 의견·느낌을 덧붙이는 건 좋지만 사실처럼 단정하지 마세요.
3. 사실을 담은 모든 문장 끝에 근거 카드 id를 [F3]처럼 붙이세요(여러 개면 [F1][F2]). 카드를 쓰지 않은 순수 의견·연결 문장은 마커 없이 쓰되 숫자·고유명사를 넣지 마세요. 마커는 독자에게 보이지 않게 후처리로 제거됩니다. 주어진 id만 쓰세요.
4. 플레인 텍스트로만 쓰세요. 마크다운 헤더(#), 볼드(**), 불릿·번호 목록, 코드 블록, 표를 쓰지 마세요. 문단은 빈 줄로 나누세요. 소제목은 이 섹션 본문에 넣지 마세요(따로 붙입니다).
5. 출처 URL을 본문에 쓰지 마세요(글 끝에 따로 붙입니다).
6. ${ANTI_AI_STYLE_RULE}
7. 인사말·자기소개·"여러분은 어떻게 생각하세요?" 같은 질문 마무리를 쓰지 마세요. 오직 이 섹션 본문 텍스트만 출력하세요.`;
}

export function buildSectionUserPrompt(
  outline: Outline,
  sectionIdx: number,
  cards: CardRef[],
  prevTail: string | null
): string {
  const sec = outline.sections[sectionIdx];
  return `[글 제목]: ${outline.title}
[글의 관점]: ${outline.angle}
[분량]: ${LENGTH_GUIDE[outline.lengthHint]}
[이 섹션 (${sectionIdx + 1}/${outline.sections.length})]${sec.heading ? ` 소제목: ${sec.heading}` : ''}
이 섹션의 목적: ${sec.purpose}
${prevTail ? `[바로 앞 섹션의 마지막 문장]: ${prevTail}\n(내용을 반복하지 말고 자연스럽게 이어가세요.)\n` : ''}
[사실 카드]
${renderCardsForPrompt(cards)}

위 사실 카드만 근거로 이 섹션 본문을 쓰세요.`;
}

export async function composeDraft(
  bundle: ResearchBundle,
  outline: Outline,
  persona: AgentPersona,
  deps: WriterDeps
): Promise<Draft> {
  const allCards = buildCardRefs(bundle);
  const system = buildSectionSystemPrompt(persona);
  const sections: DraftSection[] = [];
  let prevTail: string | null = null;

  for (let i = 0; i < outline.sections.length; i++) {
    const sec = outline.sections[i];
    const cards = sec.factIds.map((id) => allCards.get(id)).filter((c): c is CardRef => !!c);
    const raw = await deps.llm.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: buildSectionUserPrompt(outline, i, cards, prevTail) },
      ],
      false,
      { timeoutMs: deps.timeoutMs, maxTokens: 3000 }
    );
    const paragraphs = parseSectionText(raw, new Set(sec.factIds));
    if (paragraphs.length === 0) throw new ComposeError(`섹션 ${i + 1} 본문이 비었다`);
    const heading = sec.heading ? cleanMarkdownLine(sec.heading) || undefined : undefined;
    sections.push({ ...(heading ? { heading } : {}), factIds: sec.factIds, paragraphs });
    const last = paragraphs[paragraphs.length - 1];
    prevTail = last[last.length - 1].text;
  }
  return { title: outline.title, sections };
}

/** 초안 → 최종 본문 문자열(내부 마커 없음). */
export function renderDraft(draft: Draft, bundle: ResearchBundle) {
  return renderBody(draft, buildCardRefs(bundle));
}
