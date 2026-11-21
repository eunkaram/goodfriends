import { config } from '../config.js';
import type { ChatMessage, ChatOptions } from '../llm/llm-client.js';
import type { ArticleContent, Candidate, FactCard, ResearchBundle, ResearchSource } from './types.js';
import type { FetchArticleHint } from './fetch-article.js';
import type { TopicSelection } from './topic.js';

/** LlmClient 호환(테스트에서 모킹). */
export interface FactLlm {
  chat(messages: ChatMessage[], jsonMode?: boolean, options?: ChatOptions): Promise<string>;
}

export interface FactsDeps {
  llm: FactLlm;
  fetchArticle: (url: string, hint?: FetchArticleHint) => Promise<ArticleContent | null>;
  /** LLM 호출 타임아웃(ms). 기본 config.llm.longTimeoutMs. */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface FactsOptions {
  minSources?: number; // 3
  maxSources?: number; // 8
  chunkChars?: number; // 6000
  maxChunks?: number; // 4
  maxFactsPerSource?: number; // 6
  /** 원문 가져오기 시도 횟수 상한(보충 포함). 기본 14 */
  maxAttempts?: number;
}

export interface FactsResult {
  bundle: ResearchBundle | null;
  /** bundle이 null일 때 사유 */
  reason?: string;
}

const MIN_QUOTE_CHARS = 12;

/** 공백 정규화(연속 공백·개행 → 한 칸, 양끝 제거) + 유니코드 NFC. */
export function normalizeWs(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** 문단 경계 우선으로 chunkChars 이하 조각으로 분할. 한 문단이 더 길면 글자 수로 자른다. */
export function chunkText(text: string, chunkChars = 6000): string[] {
  // 0 이하·NaN이면 아래 `i += chunkChars`가 제자리걸음(무한 루프)이 된다 → 하한을 둔다.
  chunkChars = Number.isFinite(chunkChars) ? Math.max(1, Math.floor(chunkChars)) : 6000;
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const para of text.split(/\n+/)) {
    if (para.length > chunkChars) {
      push();
      for (let i = 0; i < para.length; i += chunkChars) chunks.push(para.slice(i, i + chunkChars));
      continue;
    }
    if (cur.length + para.length + 1 > chunkChars) push();
    cur += `${para}\n`;
  }
  push();
  return chunks;
}

/** LLM 응답 → {claim, quote}[]. 코드펜스·배열 루트 허용. 파싱 불가면 null. */
export function parseFactResponse(raw: string): { claim: string; quote: string }[] | null {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let data: any;
  try {
    data = JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.facts) ? data.facts : null;
  if (!arr) return null;
  const out: { claim: string; quote: string }[] = [];
  for (const f of arr) {
    if (typeof f?.claim === 'string' && typeof f?.quote === 'string' && f.claim.trim() && f.quote.trim()) {
      out.push({ claim: f.claim.trim(), quote: f.quote.trim() });
    }
  }
  return out;
}

/** quote가 원문(공백 정규화 후)에 실제로 포함되는 카드만 남긴다. 너무 짧은 quote·중복 quote도 버린다. */
export function validateCards(
  cards: { claim: string; quote: string }[],
  articleText: string,
  meta: { url: string; sourceTitle: string; publishedAt: string | null }
): FactCard[] {
  const haystack = normalizeWs(articleText);
  const seen = new Set<string>();
  const out: FactCard[] = [];
  for (const c of cards) {
    const quote = normalizeWs(c.quote);
    if (quote.length < MIN_QUOTE_CHARS || seen.has(quote) || !haystack.includes(quote)) continue;
    seen.add(quote);
    out.push({ claim: c.claim, quote, url: meta.url, sourceTitle: meta.sourceTitle, publishedAt: meta.publishedAt });
  }
  return out;
}

function buildMessages(article: ArticleContent, chunk: string, idx: number, total: number, maxFacts: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '당신은 원문에서 검증 가능한 사실만 뽑는 리서치 보조입니다. 반드시 JSON만 출력하세요.\n' +
        `형식: {"facts":[{"claim":"한국어 한 문장으로 정리한 사실","quote":"원문에서 글자 그대로 복사한 문장"}]}\n` +
        `규칙: quote는 아래 원문에 있는 문장을 한 글자도 바꾸지 말고 그대로 복사(번역·요약·말줄임 금지, 원문 언어 유지). ` +
        `claim은 quote가 직접 뒷받침하는 내용만, 원문에 없는 추측·평가·수치 금지. 중요한 사실 최대 ${maxFacts}개. 사실이 없으면 {"facts":[]}.`,
    },
    {
      role: 'user',
      content: `[제목] ${article.title}\n[URL] ${article.url}\n[원문 ${idx + 1}/${total}]\n${chunk}`,
    },
  ];
}

/** 원문 하나 → 검증된 사실 카드. LLM 오류·파싱 실패는 해당 청크만 건너뛴다(예외 없음). */
export async function extractFactsFromArticle(article: ArticleContent, deps: Omit<FactsDeps, 'fetchArticle'>, opts: FactsOptions = {}): Promise<FactCard[]> {
  const maxFacts = opts.maxFactsPerSource ?? 6;
  const chunks = chunkText(article.text, Math.max(50, opts.chunkChars ?? 6000)).slice(0, opts.maxChunks ?? 4);
  const raw: { claim: string; quote: string }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const reply = await deps.llm.chat(buildMessages(article, chunks[i], i, chunks.length, maxFacts), true, {
        timeoutMs: deps.timeoutMs ?? config.llm.longTimeoutMs,
        maxTokens: 2048,
      });
      const parsed = parseFactResponse(reply);
      if (!parsed) {
        deps.log?.(`[facts] LLM JSON 파싱 실패: ${article.url} (chunk ${i + 1})`);
        continue;
      }
      raw.push(...parsed);
    } catch (err: any) {
      deps.log?.(`[facts] LLM 호출 실패: ${article.url} (chunk ${i + 1}): ${err?.message ?? err}`);
    }
  }
  const cards = validateCards(raw, article.text, {
    url: article.url,
    sourceTitle: article.title,
    publishedAt: article.publishedAt,
  });
  if (cards.length < raw.length) deps.log?.(`[facts] quote 검증으로 ${raw.length - cards.length}건 폐기: ${article.url}`);
  return cards.slice(0, maxFacts);
}

/**
 * 주제+관련 후보의 원문을 가져와 사실 카드를 만든다. 원문 사용 가능한 소스(본문 확보 + 검증된 카드 1개 이상)가
 * minSources(3) 미만이면 이번 주제를 포기(bundle=null). 부족하면 selection.rest에서 다른 소스 우선으로 보충.
 * 주제 자신의 원문이 사용 불가여도 포기한다(주제를 뒷받침하는 원문이 없으므로).
 */
export async function buildResearchBundle(selection: TopicSelection, deps: FactsDeps, opts: FactsOptions = {}): Promise<FactsResult> {
  const minSources = opts.minSources ?? 3;
  const maxSources = opts.maxSources ?? 8;
  const maxAttempts = opts.maxAttempts ?? 14;
  const target = Math.min(maxSources, Math.max(minSources, 1 + selection.related.length));

  const primary: Candidate[] = [selection.topic, ...selection.related];
  // 보충 큐: 이미 쓰는 소스와 다른 sourceId를 먼저
  const used = new Set(primary.map((c) => c.sourceId));
  const supplement = [...selection.rest].sort((a, b) => Number(used.has(a.sourceId)) - Number(used.has(b.sourceId)));
  const queue = [...primary, ...supplement];

  const sources: ResearchSource[] = [];
  const facts: FactCard[] = [];
  let attempts = 0;
  let topicOk = false;

  for (const cand of queue) {
    if (sources.length >= target || attempts >= maxAttempts) break;
    attempts++;
    const article = await deps.fetchArticle(cand.url, { title: cand.title, summary: cand.summary, publishedAt: cand.publishedAt });
    if (!article) {
      deps.log?.(`[facts] 원문 가져오기 실패: ${cand.url}`);
      continue;
    }
    const cards = await extractFactsFromArticle(
      { ...article, title: article.title || cand.title, publishedAt: article.publishedAt ?? cand.publishedAt },
      deps,
      opts
    );
    if (cards.length === 0) continue;
    if (cand === selection.topic) topicOk = true;
    sources.push({
      url: article.url || cand.url,
      title: article.title || cand.title,
      text: article.text,
      images: article.images,
      ogImage: article.ogImage,
      siteName: article.siteName,
      publishedAt: article.publishedAt ?? cand.publishedAt,
      sourceId: cand.sourceId,
    });
    facts.push(...cards);
  }

  if (!topicOk) return { bundle: null, reason: '주제 원문에서 검증된 사실을 얻지 못함' };
  if (sources.length < minSources) return { bundle: null, reason: `사용 가능한 원문 ${sources.length}건 < ${minSources}건` };
  return { bundle: { category: selection.category, topic: selection.topic, sources, facts } };
}
