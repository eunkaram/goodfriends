import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import { RobotsChecker } from './robots.js';
import { runWriterPipeline, type WriterRunDeps, type WriterSteps } from './run.js';
import { HttpClient } from './sources/http.js';
import type { WriteResult } from './index.js';
import type { Candidate } from './types.js';
import { makeBundle, mockLlm, persona } from './write-fixtures.js';
import { buildCardRefs, renderBody, type Draft } from './write-types.js';

const TOPIC: Candidate = { title: 'Ollama 0.12.3', url: 'https://a.example/post', sourceId: 'github:ollama/ollama', publishedAt: null };

function passedWrite(extra: Partial<WriteResult> = {}): WriteResult {
  const bundle = makeBundle();
  const draft: Draft = { title: 'Ollama 새 버전 정리', sections: [{ factIds: ['F1'], paragraphs: [[{ text: 'Ollama v0.12.3이 나왔다.', cardIds: ['F1'] }]] }] };
  const { body, usedUrls } = renderBody(draft, buildCardRefs(bundle));
  return {
    status: 'passed', title: draft.title, body, usedSources: usedUrls.map((url) => ({ url, title: 'Ollama release' })),
    review: { invalidCards: [], sentences: [], fixes: [], rounds: 1 }, reasons: [], outline: null, draft, ...extra,
  };
}

/** 실제 네트워크 없이 도는 기본 단계(주제·사실·작성·이미지 모두 스텁). */
function stubSteps(over: Partial<WriterSteps> = {}): Partial<WriterSteps> {
  return {
    pickTopic: async () => ({ category: 'qna', topic: TOPIC, related: [], rest: [] }),
    buildResearchBundle: async () => ({ bundle: makeBundle() }),
    writePost: async () => passedWrite(),
    attachImages: async (r) => ({ ...r, images: [], imageRejections: [] }),
    ...over,
  };
}

describe('runWriterPipeline', () => {
  let dir: string;
  let db: DatabaseSync;
  let pages: string[];
  let deps: WriterRunDeps;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-run-'));
    db = openDatabase(dir);
    pages = [];
    const fetchImpl = async (u: string) => {
      if (u.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /\n');
      pages.push(u);
      return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    };
    const http = new HttpClient({ fetchImpl, hostMinGapMs: {} });
    deps = { db, llm: mockLlm(() => '{}'), http, robots: new RobotsChecker(http), steps: stubSteps() };
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('통과: 주제 → 사실 → 작성 → 이미지 → 최종 게이트를 거쳐 passed + 주제·출처·사실이 결과에 담긴다', async () => {
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.status).toBe('passed');
    expect(r.reasons).toEqual([]);
    expect(r.topic).toEqual({ url: TOPIC.url, title: TOPIC.title });
    expect(r.facts).toHaveLength(3);
    expect(r.sources[0].url).toBe('https://a.example/post');
    expect(r.personaId).toBe('p1');
    expect(r.category).toBe('qna');
  });

  it('RobotsChecker가 없으면(타입 우회) 실행 전에 거부한다', async () => {
    // @ts-expect-error robots는 필수 — 생략하면 타입 오류
    const bad: WriterRunDeps = { db, llm: deps.llm, http: deps.http };
    await expect(runWriterPipeline(persona, 'qna', bad)).rejects.toThrow(/RobotsChecker/);
  });

  it('원문은 robots를 거친다: Disallow면 페이지를 가져오지 않고 research-failed로 폐기', async () => {
    deps.steps = { pickTopic: stubSteps().pickTopic }; // 사실 단계는 실제 구현을 쓴다
    deps.collect = async () => [{ ...TOPIC }, { ...TOPIC, url: 'https://b.example/2', title: 'Other thing entirely' }];
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.status).toBe('discarded');
    expect(r.reasons[0]).toMatch(/^research-failed/);
    expect(pages).toEqual([]); // robots.txt만 요청했고 본문 페이지는 한 번도 요청하지 않았다
  });

  it('주제가 없으면 no-topic으로 폐기', async () => {
    deps.steps = stubSteps({ pickTopic: async () => null });
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r).toMatchObject({ status: 'discarded', reasons: ['no-topic'], topic: null });
  });

  it('작성 단계가 폐기하면 그 사유와 마지막 초안을 그대로 담는다', async () => {
    deps.steps = stubSteps({ writePost: async () => passedWrite({ status: 'discarded', reasons: ['리뷰어: unsupported'] }) });
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.status).toBe('discarded');
    expect(r.reasons).toEqual(['리뷰어: unsupported']);
    expect(r.body).not.toBe('');
  });

  it('최종 게이트: PII가 본문에 있으면 폐기', async () => {
    deps.steps = stubSteps({ writePost: async () => passedWrite({ body: '문의는 010-1234-5678 로 주세요.' }) });
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.status).toBe('discarded');
    expect(r.reasons[0]).toMatch(/^final-gate: PII/);
  });

  it('최종 검사: 최근 글과 제목이 겹치면 폐기', async () => {
    deps.recentTexts = ['Ollama 새 버전 정리 - 지난주에 쓴 글'];
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.status).toBe('discarded');
    expect(r.reasons[0]).toMatch(/^repeated-title/);
  });

  it('데드라인 초과: LLM이 멈춰도 abort하고 discarded(deadline), 이후 LLM 호출은 거부된다', async () => {
    const chat = vi.fn(() => new Promise<string>(() => {})); // 영원히 안 끝남
    deps.llm = { chat };
    let lateError: unknown = null;
    deps.steps = stubSteps({
      buildResearchBundle: async (_sel, d) => {
        await d.llm.chat([{ role: 'user', content: 'x' }]);
        return { bundle: makeBundle() };
      },
    });
    deps.limits = { deadlineMs: 60 };
    const t0 = Date.now();
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r).toMatchObject({ status: 'discarded', reasons: ['deadline'] });
    expect(chat).toHaveBeenCalledTimes(1);
    // 데드라인 이후엔 래퍼가 새 호출을 막는다
    const wrapped = new (await import('./budget.js')).RunBudget({ deadlineMs: 1, maxLlmCalls: 5 });
    await new Promise((res) => setTimeout(res, 5));
    try {
      await wrapped.wrapLlm({ chat }).chat([]);
    } catch (e) {
      lateError = e;
    }
    expect((lateError as Error)?.message).toContain('deadline');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('LLM 호출 상한 초과: 단계가 LLM 오류를 삼켜도 discarded(llm-limit), 실제 호출은 상한까지만', async () => {
    const llm = mockLlm(() => '{}');
    deps.llm = llm;
    deps.limits = { maxLlmCalls: 3 };
    deps.steps = stubSteps({
      buildResearchBundle: async (_sel, d) => {
        for (let i = 0; i < 10; i++) {
          try {
            await d.llm.chat([{ role: 'user', content: 'x' }]);
          } catch {
            /* facts.ts처럼 청크 단위로 삼킨다 */
          }
        }
        return { bundle: makeBundle() };
      },
    });
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r).toMatchObject({ status: 'discarded', reasons: ['llm-limit'] });
    expect(llm.calls).toHaveLength(3);
    expect(r.llmCalls).toBe(3);
  });

  it('vision 호출도 LLM 상한에 포함된다', async () => {
    deps.limits = { maxLlmCalls: 1 };
    const vision = vi.fn(async () => '{}');
    deps.vision = vision;
    deps.steps = stubSteps({
      attachImages: async (r, _b, d) => {
        await d!.vision!({ system: '', prompt: '', imageDataUrl: '' });
        await d!.vision!({ system: '', prompt: '', imageDataUrl: '' }).catch(() => {});
        return { ...r, images: [], imageRejections: [] };
      },
    });
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.reasons).toEqual(['llm-limit']);
    expect(vision).toHaveBeenCalledTimes(1);
  });

  it('LLM 호출 타임아웃은 남은 데드라인보다 길지 않게 줄어든다', async () => {
    const llm = mockLlm(() => '{}');
    deps.llm = llm;
    deps.limits = { deadlineMs: 10_000 };
    deps.timeoutMs = 600_000;
    deps.steps = stubSteps({
      buildResearchBundle: async (_s, d) => {
        await d.llm.chat([], false, { timeoutMs: d.timeoutMs });
        return { bundle: makeBundle() };
      },
    });
    await runWriterPipeline(persona, 'qna', deps);
    expect(llm.calls[0].options.timeoutMs).toBeLessThanOrEqual(10_000);
  });

  it('예상 못 한 오류도 던지지 않고 discarded(pipeline-error)', async () => {
    deps.steps = stubSteps({ pickTopic: async () => { throw new Error('db locked'); } });
    const r = await runWriterPipeline(persona, 'qna', deps);
    expect(r.status).toBe('discarded');
    expect(r.reasons[0]).toContain('pipeline-error: db locked');
  });
});
