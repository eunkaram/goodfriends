/**
 * writer 서비스: 파이프라인 실행(프로세스 전역 뮤텍스로 동시 1개) → drafts 저장 → (DRY_RUN=false일 때만) 게시.
 *
 * - DRY_RUN: 게시 API를 부르지 않는다. 초안은 passed·discarded 모두 drafts에 저장한다.
 * - 게시 모드: passed만 publish 콜백(createPost)으로 올리고, 성공하면 drafts.publishedPostId를 기록한다.
 * - 주제 사용 이력(recordTopicUsage)은 passed가 "게시 성공" 또는 "드라이런 저장 성공"을 한 뒤에만 남긴다
 *   (discarded·게시 실패는 남기지 않아 다음에 같은 주제를 다시 쓸 수 있다).
 */
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import type { AgentPersona } from '../types.js';
import { DraftStore, type DraftRecord } from './drafts.js';
import { recordTopicUsage } from './history.js';
import { createLocalVision } from './images.js';
import { Mutex, globalWriteMutex } from './mutex.js';
import { RobotsChecker } from './robots.js';
import { runWriterPipeline, type WriterRunDeps, type WriterRunResult } from './run.js';
import { HttpClient, type FetchImpl } from './sources/http.js';
import { collectCandidates } from './sources/registry.js';
import type { FeedReader } from './topic.js';
import type { WriterLlm } from './write-types.js';

export type PublishFn = (post: { title: string; body: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
/** 게시 모드는 publish 콜백이 반드시 있어야 한다(타입으로 강제). */
export type PublishMode = { dryRun: true } | { dryRun: false; publish: PublishFn };

export interface WriterOutcome {
  draft: DraftRecord;
  result: WriterRunResult;
  /** 게시를 시도했을 때만(DRY_RUN이거나 discarded면 null) */
  published: { ok: boolean; id?: string; error?: string } | null;
}

export type ServiceDeps = Omit<WriterRunDeps, 'feed' | 'recentTexts'>;

export class WriterService {
  readonly drafts: DraftStore;

  constructor(
    private readonly db: DatabaseSync,
    private readonly deps: ServiceDeps,
    private readonly mutex: Mutex = globalWriteMutex
  ) {
    this.drafts = new DraftStore(db);
  }

  async produce(
    persona: AgentPersona,
    category: string,
    mode: PublishMode,
    ctx: { recentTexts?: string[]; feed?: FeedReader } = {}
  ): Promise<WriterOutcome> {
    const recentTexts = [...(ctx.recentTexts ?? []), ...this.drafts.recentPassedTitles(persona.id)];
    // 글쓰기는 프로세스 전체에서 동시에 1개. 데드라인은 락을 잡은 뒤부터 센다(대기 시간 제외).
    const result = await this.mutex.run(() => runWriterPipeline(persona, category, { ...this.deps, feed: ctx.feed, recentTexts }));

    const draft = this.drafts.insert({
      personaId: persona.id,
      category,
      status: result.status,
      title: result.title,
      body: result.body,
      sources: result.sources,
      facts: result.facts,
      review: result.review,
      images: result.images,
      reasons: result.reasons,
    });

    let published: WriterOutcome['published'] = null;
    let usageOk = result.status === 'passed' && mode.dryRun; // 드라이런 passed: 저장 성공 = 사용
    if (result.status === 'passed' && !mode.dryRun) {
      published = await mode.publish({ title: result.title, body: result.body }).catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
      if (published.ok && published.id) {
        this.drafts.setPublished(draft.id, published.id);
        draft.publishedPostId = published.id;
        usageOk = true;
      }
    }
    if (usageOk) this.recordUsage(persona, category, result);
    return { draft, result, published };
  }

  private recordUsage(persona: AgentPersona, category: string, result: WriterRunResult): void {
    const seen = new Set<string>();
    const entries = [...(result.topic ? [result.topic] : []), ...result.sources];
    for (const e of entries) {
      if (seen.has(e.url)) continue;
      seen.add(e.url);
      recordTopicUsage(this.db, { url: e.url, title: e.title || result.title, category, agentId: persona.id });
    }
  }
}

/** 운영용 팩토리: HttpClient·RobotsChecker를 여기서 묶어 robots 확인을 빠뜨릴 수 없게 한다. */
export function createWriterService(opts: { llm: WriterLlm; storageDir?: string; fetchImpl?: FetchImpl; mutex?: Mutex }): WriterService {
  const db = openDatabase(opts.storageDir ?? path.resolve(process.cwd(), 'data'));
  const http = new HttpClient({ fetchImpl: opts.fetchImpl });
  const robots = new RobotsChecker(http);
  return new WriterService(db, { db, llm: opts.llm, vision: createLocalVision(), http, robots, collect: (c) => collectCandidates(c, http), imageFetch: opts.fetchImpl }, opts.mutex);
}
