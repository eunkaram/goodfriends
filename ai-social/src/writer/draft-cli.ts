/**
 * 1회 드라이런 CLI의 로직(scripts/draft.ts가 얇게 감싼다): 카테고리의 담당 페르소나로 파이프라인을 1회 돌려
 * drafts에 저장하고 요약을 출력한다. 항상 드라이런 — 게시 콜백을 넘기지 않으므로 게시할 수 없다.
 */
import type { AgentPersona } from '../types.js';
import type { WriterService } from './service.js';
import type { FeedReader } from './topic.js';

export function parseDraftArgs(argv: string[]): { category: string } | { error: string } {
  const i = argv.findIndex((a) => a === '--category' || a.startsWith('--category='));
  if (i < 0) return { error: '사용법: npm run draft -- --category <slug>' };
  const value = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  if (!value || value.startsWith('--')) return { error: '--category 값이 필요합니다(예: --category qna)' };
  return { category: value.trim() };
}

export async function runDraftCli(
  argv: string[],
  deps: { personas: AgentPersona[]; service: WriterService; feedFor?: (persona: AgentPersona) => FeedReader; out?: (line: string) => void }
): Promise<number> {
  const out = deps.out ?? ((l) => console.log(l));
  const args = parseDraftArgs(argv);
  if ('error' in args) {
    out(args.error);
    return 2;
  }
  const persona = deps.personas.find((p) => p.enabled !== false && p.preferredCategories.includes(args.category));
  if (!persona) {
    out(`'${args.category}' 카테고리를 담당하는 활성 페르소나가 없습니다.`);
    return 2;
  }

  out(`[드라이런] ${persona.nickname}(${persona.id}) · 카테고리 ${args.category} — 게시하지 않고 drafts에만 저장합니다.`);
  const { draft, result } = await deps.service.produce(persona, args.category, { dryRun: true }, { feed: deps.feedFor?.(persona) });

  out(`초안 ID : ${draft.id}`);
  out(`상태    : ${result.status === 'passed' ? '통과' : '폐기'}`);
  out(`제목    : ${result.title || '(없음)'}`);
  if (result.topic) out(`주제    : ${result.topic.title} (${result.topic.url})`);
  if (result.reasons.length) out(`사유    : ${result.reasons.join(' / ')}`);
  out(`출처 ${result.sources.length}건 · 사실 카드 ${result.facts.length}건 · 이미지 ${result.images.length}장 · 리뷰 ${result.review?.rounds ?? 0}라운드`);
  out(`LLM 호출 ${result.llmCalls}회 · ${(result.elapsedMs / 1000).toFixed(1)}초`);
  out('게시되지 않았습니다(DRY_RUN). 대시보드의 "글 초안"에서 본문을 확인하세요.');
  return result.status === 'passed' ? 0 : 1;
}
