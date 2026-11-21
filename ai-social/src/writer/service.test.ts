import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import { hasUsedUrl } from './history.js';
import { Mutex } from './mutex.js';
import { RobotsChecker } from './robots.js';
import { WriterService, type ServiceDeps } from './service.js';
import { HttpClient } from './sources/http.js';
import type { WriteResult } from './index.js';
import type { WriterSteps } from './run.js';
import { makeBundle, mockLlm, persona } from './write-fixtures.js';
import { buildCardRefs, renderBody, type Draft } from './write-types.js';

const TOPIC = { title: 'Ollama 0.12.3', url: 'https://a.example/post', sourceId: 'github:ollama/ollama', publishedAt: null };

function passedWrite(extra: Partial<WriteResult> = {}): WriteResult {
  const bundle = makeBundle();
  const draft: Draft = { title: 'Ollama 새 버전 정리', sections: [{ factIds: ['F1'], paragraphs: [[{ text: 'Ollama v0.12.3이 나왔다.', cardIds: ['F1'] }]] }] };
  const { body, usedUrls } = renderBody(draft, buildCardRefs(bundle));
  return {
    status: 'passed', title: draft.title, body, usedSources: usedUrls.map((url) => ({ url, title: 'Ollama release' })),
    review: { invalidCards: [], sentences: [], fixes: [], rounds: 1 }, reasons: [], outline: null, draft, ...extra,
  };
}
const steps = (over: Partial<WriterSteps> = {}): Partial<WriterSteps> => ({
  pickTopic: async () => ({ category: 'qna', topic: TOPIC, related: [], rest: [] }),
  buildResearchBundle: async () => ({ bundle: makeBundle() }),
  writePost: async () => passedWrite(),
  attachImages: async (r) => ({ ...r, images: [{ sectionIndex: 0, url: 'https://c.example/i.png', sourceUrl: 'https://a.example/post', credit: 'a', caption: 'c', reason: 'r' }], imageRejections: [] }),
  ...over,
});

describe('WriterService', () => {
  let dir: string;
  let db: DatabaseSync;
  let base: ServiceDeps;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-service-'));
    db = openDatabase(dir);
    const http = new HttpClient({ fetchImpl: async () => new Response('', { status: 404 }), hostMinGapMs: {} });
    base = { db, llm: mockLlm(() => '{}'), http, robots: new RobotsChecker(http), steps: steps() };
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const make = (over: Partial<ServiceDeps> = {}, mutex = new Mutex()) => new WriterService(db, { ...base, ...over }, mutex);

  it('DRY_RUN passed: 게시 없이 drafts에 저장(JSON 필드 포함, publishedPostId null)하고 주제 사용 이력을 남긴다', async () => {
    const svc = make();
    const { draft, published } = await svc.produce(persona, 'qna', { dryRun: true });
    expect(published).toBeNull();
    const row = svc.drafts.get(draft.id)!;
    expect(row).toMatchObject({ personaId: 'p1', category: 'qna', status: 'passed', title: 'Ollama 새 버전 정리', publishedPostId: null, reasons: [] });
    expect(row.body).toContain('Ollama v0.12.3');
    expect(row.sources[0].url).toBe('https://a.example/post');
    expect(row.facts).toHaveLength(3);
    expect(row.images).toHaveLength(1);
    expect((row.review as any).rounds).toBe(1);
    expect(hasUsedUrl(db, TOPIC.url)).toBe(true);
  });

  it('DRY_RUN discarded도 저장하되(사유 포함) 주제 사용 이력은 남기지 않는다', async () => {
    const svc = make({ steps: steps({ writePost: async () => passedWrite({ status: 'discarded', reasons: ['리뷰어: unsupported'] }) }) });
    const { draft } = await svc.produce(persona, 'qna', { dryRun: true });
    const row = svc.drafts.get(draft.id)!;
    expect(row.status).toBe('discarded');
    expect(row.reasons).toEqual(['리뷰어: unsupported']);
    expect(row.publishedPostId).toBeNull();
    expect(hasUsedUrl(db, TOPIC.url)).toBe(false);
  });

  it('게시 모드: passed면 publish 1회 호출 후 publishedPostId 기록 + 이력 기록', async () => {
    const svc = make();
    const publish = vi.fn(async () => ({ ok: true, id: 'pub-123' }));
    const { draft, published } = await svc.produce(persona, 'qna', { dryRun: false, publish });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ title: 'Ollama 새 버전 정리', body: expect.stringContaining('Ollama v0.12.3') });
    expect(published).toEqual({ ok: true, id: 'pub-123' });
    expect(draft.publishedPostId).toBe('pub-123');
    expect(svc.drafts.get(draft.id)!.publishedPostId).toBe('pub-123');
    expect(hasUsedUrl(db, TOPIC.url)).toBe(true);
  });

  it('게시 실패(응답 실패·예외)면 이력을 남기지 않고 publishedPostId도 null, 초안은 남는다', async () => {
    const failing = [async () => ({ ok: false, error: 'EMAIL_NOT_VERIFIED' }), async () => { throw new Error('network'); }];
    for (const [i, publish] of failing.entries()) {
      const svc = make();
      // 페르소나마다 제목 중복 검사가 따로라 반복마다 다른 페르소나를 쓴다
      const { draft, published } = await svc.produce({ ...persona, id: `p-fail-${i}` }, 'qna', { dryRun: false, publish });
      expect(published?.ok).toBe(false);
      expect(svc.drafts.get(draft.id)).toMatchObject({ status: 'passed', publishedPostId: null });
      expect(hasUsedUrl(db, TOPIC.url)).toBe(false);
    }
  });

  it('게시 모드에서도 discarded는 게시하지 않고 저장만', async () => {
    const svc = make({ steps: steps({ pickTopic: async () => null }) });
    const publish = vi.fn(async () => ({ ok: true, id: 'x' }));
    const { draft, published } = await svc.produce(persona, 'qna', { dryRun: false, publish });
    expect(publish).not.toHaveBeenCalled();
    expect(published).toBeNull();
    expect(svc.drafts.get(draft.id)).toMatchObject({ status: 'discarded', reasons: ['no-topic'] });
  });

  it('같은 페르소나가 최근에 만든 passed 초안과 제목이 같으면 다음 초안은 폐기(제목 중복)', async () => {
    const svc = make();
    expect((await svc.produce(persona, 'qna', { dryRun: true })).result.status).toBe('passed');
    // 이력에 이미 쓴 주제라 두 번째도 같은 스텁이 나오지만, 제목이 같아 최종 검사에서 걸린다
    const second = await svc.produce(persona, 'qna', { dryRun: true });
    expect(second.result.status).toBe('discarded');
    expect(second.result.reasons[0]).toMatch(/^repeated-title/);
  });

  it('글쓰기는 프로세스 전체에서 동시에 1개: 서로 다른 서비스 인스턴스가 같은 뮤텍스를 공유하면 겹치지 않는다', async () => {
    const shared = new Mutex();
    let active = 0;
    let maxActive = 0;
    const slow: Partial<WriterSteps> = {
      pickTopic: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return null;
      },
    };
    const a = make({ steps: steps(slow) }, shared);
    const b = make({ steps: steps(slow) }, shared);
    await Promise.all([a.produce(persona, 'qna', { dryRun: true }), b.produce(persona, 'free', { dryRun: true }), a.produce(persona, 'idea', { dryRun: true }), b.produce(persona, 'local', { dryRun: true })]);
    expect(maxActive).toBe(1);
    expect(shared.state).toEqual({ running: 0, waiting: 0 });
  });

  it('앞 작업이 실패해도 대기열은 계속 흐른다', async () => {
    const m = new Mutex();
    const results: string[] = [];
    await Promise.allSettled([
      m.run(async () => { throw new Error('boom'); }),
      m.run(async () => { results.push('second'); }),
    ]);
    expect(results).toEqual(['second']);
  });

  it('기본 뮤텍스(프로세스 전역)를 쓰는 두 서비스도 겹치지 않는다', async () => {
    let active = 0;
    let maxActive = 0;
    const slow = steps({
      pickTopic: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return null;
      },
    });
    const a = new WriterService(db, { ...base, steps: slow });
    const b = new WriterService(db, { ...base, steps: slow });
    await Promise.all([a.produce(persona, 'qna', { dryRun: true }), b.produce(persona, 'qna', { dryRun: true })]);
    expect(maxActive).toBe(1);
  });
});
