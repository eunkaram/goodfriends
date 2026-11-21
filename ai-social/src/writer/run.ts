/**
 * writer 파이프라인 오케스트레이션(게시·저장은 하지 않는다 — service.ts):
 * persona + 담당 category → pickTopic → 원문(fetchArticle, RobotsChecker 필수) → 사실 카드 → writePost →
 * passed면 attachImages → 최종 content-gate + 제목 중복 검사 → WriterRunResult.
 *
 * 최악 실행 시간은 전체 데드라인(WRITER_DEADLINE_MS)과 LLM 호출 상한(WRITER_MAX_LLM_CALLS)으로 제한한다.
 * 초과하면 abort하고 discarded(reasons: 'deadline' | 'llm-limit').
 */
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { isRepeatedTitle } from '../engine/interaction-rules.js';
import { hasEncodingCorruption } from '../llm/sanitize.js';
import { checkContentSafety } from '../safety/content-gate.js';
import type { AgentPersona } from '../types.js';
import { RunAborted, RunBudget } from './budget.js';
import { buildResearchBundle } from './facts.js';
import { fetchArticle } from './fetch-article.js';
import { attachImages, type AttachedImage, type DownscaleFn, type ImageRejection, type VisionFn } from './images.js';
import { writePost } from './index.js';
import type { RobotsChecker } from './robots.js';
import type { FetchImpl, HttpClient } from './sources/http.js';
import { collectCandidates } from './sources/registry.js';
import { pickTopic, type FeedReader } from './topic.js';
import type { Candidate, FactCard } from './types.js';
import type { ReviewReport } from './verify.js';
import type { WriterLlm } from './write-types.js';

/** 테스트에서 단계를 바꿔 끼우기 위한 훅(기본은 실제 구현). */
export interface WriterSteps {
  pickTopic: typeof pickTopic;
  buildResearchBundle: typeof buildResearchBundle;
  writePost: typeof writePost;
  attachImages: typeof attachImages;
}

export interface WriterRunDeps {
  db: DatabaseSync;
  llm: WriterLlm;
  /** 없으면 이미지를 붙이지 않는다. */
  vision?: VisionFn;
  http: HttpClient;
  /** 필수. 원문을 가져올 때 robots.txt를 반드시 확인한다(생략 불가 — 타입 + 런타임 검사). */
  robots: RobotsChecker;
  /** 카테고리 후보 수집. 기본: 소스 레지스트리(collectCandidates). */
  collect?: (category: string) => Promise<Candidate[]>;
  /** 최근 피드 대조용 읽기 전용 경로. 생략하면 피드 대조는 건너뛴다. */
  feed?: FeedReader;
  imageFetch?: FetchImpl;
  downscale?: DownscaleFn;
  /** 같은 계정의 최근 글(제목이 앞에 오는 발췌). 제목 중복 검사용. */
  recentTexts?: string[];
  limits?: Partial<{ deadlineMs: number; maxLlmCalls: number }>;
  /** LLM 호출 1회 타임아웃(ms). 기본 config.llm.longTimeoutMs(남은 데드라인으로 다시 줄어든다). */
  timeoutMs?: number;
  now?: () => Date;
  random?: () => number;
  log?: (msg: string) => void;
  steps?: Partial<WriterSteps>;
}

export interface WriterRunResult {
  personaId: string;
  category: string;
  status: 'passed' | 'discarded';
  title: string;
  /** 플레인 텍스트 본문(이미지 줄·참고 줄 포함). discarded여도 마지막 초안을 담을 수 있다(게시 금지). */
  body: string;
  sources: { url: string; title: string }[];
  facts: FactCard[];
  review: ReviewReport | null;
  images: AttachedImage[];
  imageRejections: ImageRejection[];
  reasons: string[];
  /** 고른 주제. 주제를 못 골랐으면 null. */
  topic: { url: string; title: string } | null;
  llmCalls: number;
  elapsedMs: number;
}

export function assertRobots(robots: unknown): asserts robots is RobotsChecker {
  if (!robots || typeof (robots as RobotsChecker).isAllowed !== 'function') {
    throw new Error('writer: RobotsChecker가 필요합니다(원문 수집 전 robots.txt 확인은 생략할 수 없음)');
  }
}

export async function runWriterPipeline(persona: AgentPersona, category: string, deps: WriterRunDeps): Promise<WriterRunResult> {
  assertRobots(deps.robots);
  const steps: WriterSteps = { pickTopic, buildResearchBundle, writePost, attachImages, ...deps.steps };
  const budget = new RunBudget({
    deadlineMs: deps.limits?.deadlineMs ?? config.writer.deadlineMs,
    maxLlmCalls: deps.limits?.maxLlmCalls ?? config.writer.maxLlmCalls,
  });
  const base = { personaId: persona.id, category };
  let topic: WriterRunResult['topic'] = null;
  let partial: Partial<WriterRunResult> = {};

  const finish = (r: Partial<WriterRunResult> & Pick<WriterRunResult, 'status' | 'reasons'>): WriterRunResult => ({
    ...base,
    title: '', body: '', sources: [], facts: [], review: null, images: [], imageRejections: [],
    topic, llmCalls: budget.llmCalls, elapsedMs: budget.elapsedMs(),
    ...r,
  });
  const discard = (reasons: string[], extra: Partial<WriterRunResult> = {}) => finish({ ...partial, ...extra, status: 'discarded', reasons });
  const checkpoint = () => {
    const reason = budget.check();
    if (reason) throw new RunAborted(reason);
  };

  const inner = async (): Promise<WriterRunResult> => {
    const llm = budget.wrapLlm(deps.llm);
    const vision = deps.vision ? budget.wrapVision(deps.vision) : undefined;
    const timeoutMs = deps.timeoutMs ?? config.llm.longTimeoutMs;

    // 1) 주제
    const selection = await steps.pickTopic(category, {
      collect: deps.collect ?? ((c) => collectCandidates(c, deps.http)),
      client: deps.feed,
      db: deps.db,
      now: deps.now,
      random: deps.random,
    });
    checkpoint();
    if (!selection) return discard(['no-topic']);
    topic = { url: selection.topic.url, title: selection.topic.title };

    // 2) 원문 + 사실 카드 (robots 필수, 중단 후에는 더 가져오지 않는다)
    const { bundle, reason } = await steps.buildResearchBundle(selection, {
      llm,
      fetchArticle: async (url, hint) => (budget.check() ? null : fetchArticle(url, { http: deps.http, robots: deps.robots }, hint)),
      timeoutMs,
      log: deps.log,
    });
    checkpoint();
    if (!bundle) return discard([`research-failed: ${reason ?? '알 수 없음'}`]);
    partial = { facts: bundle.facts };

    // 3) 작성·검증
    let written: Awaited<ReturnType<typeof writePost>> & { images?: AttachedImage[]; imageRejections?: ImageRejection[] } = await steps.writePost(bundle, persona, { llm, timeoutMs, log: deps.log, now: deps.now?.() });
    checkpoint();
    partial = { ...partial, title: written.title, body: written.body, sources: written.usedSources, review: written.review };
    if (written.status !== 'passed') return discard(written.reasons.length ? written.reasons : ['review-failed']);

    // 4) 이미지(실패해도 글은 그대로)
    written = await steps.attachImages(written, bundle, { vision, fetchImpl: deps.imageFetch, downscale: deps.downscale, log: deps.log });
    checkpoint();
    const images = written.images ?? [];
    const imageRejections = written.imageRejections ?? [];
    partial = { ...partial, body: written.body, images, imageRejections };

    // 5) 최종 게이트: 세이프티·인코딩 깨짐·제목 중복
    const text = `${written.title}\n${written.body}`;
    const safety = checkContentSafety(text);
    if (!safety.safe) return discard([`final-gate: ${safety.reason}`]);
    if (hasEncodingCorruption(text)) return discard(['final-gate: 텍스트 인코딩 깨짐(대체 문자 감지)']);
    if (isRepeatedTitle(written.title, deps.recentTexts ?? [])) return discard([`repeated-title: ${written.title}`]);

    return finish({ ...partial, status: 'passed', reasons: [] });
  };

  const guard = budget.deadlineGuard();
  try {
    return await Promise.race([inner(), guard.promise]);
  } catch (err) {
    if (err instanceof RunAborted) return discard([err.reason]);
    // 데드라인/상한을 넘긴 뒤 하위 단계가 던진 오류는 사유를 abort로 본다.
    if (budget.aborted) return discard([budget.aborted]);
    deps.log?.(`[writer] 파이프라인 오류: ${(err as Error)?.message ?? err}`);
    return discard([`pipeline-error: ${(err as Error)?.message ?? err}`]);
  } finally {
    guard.clear();
  }
}
