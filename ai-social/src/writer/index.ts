/**
 * 글 작성 파이프라인 단일 진입점: ResearchBundle → 개요 → 본문 → 검증 → 결과.
 * 엔진 연결은 하지 않는다(호출부에서 LLM·페르소나를 주입해 쓴다).
 */
import type { AgentPersona } from '../types.js';
import { composeDraft, ComposeError } from './compose.js';
import { generateOutline, OutlineError, type Outline } from './outline.js';
import type { ResearchBundle } from './types.js';
import { verifyDraft, type ReviewReport } from './verify.js';
import { buildCardRefs, renderBody, type WriterDeps } from './write-types.js';

export interface WriteResult {
  status: 'passed' | 'discarded';
  title: string;
  /** 플레인 텍스트 본문(끝에 "참고" + 출처 URL 줄). 내부 마커 없음. discarded여도 마지막 초안을 담는다(게시 금지). */
  body: string;
  usedSources: { url: string; title: string }[];
  review: ReviewReport;
  /** discarded 사유 */
  reasons: string[];
  outline: Outline | null;
}

const EMPTY_REVIEW: ReviewReport = { invalidCards: [], sentences: [], fixes: [], rounds: 0 };

export async function writePost(
  bundle: ResearchBundle,
  persona: AgentPersona,
  deps: WriterDeps & { now?: Date }
): Promise<WriteResult> {
  const fail = (reason: string, outline: Outline | null): WriteResult => ({
    status: 'discarded', title: outline?.title ?? '', body: '', usedSources: [], review: EMPTY_REVIEW, reasons: [reason], outline,
  });

  let outline: Outline;
  try {
    outline = await generateOutline(bundle, persona, deps);
  } catch (err) {
    if (err instanceof OutlineError) return fail(`outline-failed: ${err.message}`, null);
    throw err;
  }
  let draft;
  try {
    draft = await composeDraft(bundle, outline, persona, deps);
  } catch (err) {
    if (err instanceof ComposeError) return fail(`compose-failed: ${err.message}`, outline);
    throw err;
  }

  const verified = await verifyDraft(bundle, draft, persona, deps);
  const cards = buildCardRefs(bundle);
  const { body, usedUrls } = renderBody(verified.draft, cards);
  const titleOf = new Map(bundle.facts.map((f) => [f.url, f.sourceTitle]));
  return {
    status: verified.status,
    title: verified.draft.title,
    body,
    usedSources: usedUrls.map((url) => ({ url, title: titleOf.get(url) ?? '' })),
    review: verified.review,
    reasons: verified.reasons,
    outline,
  };
}
