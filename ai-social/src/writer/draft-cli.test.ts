import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../db/database.js';
import type { AgentPersona } from '../types.js';
import { parseDraftArgs, runDraftCli } from './draft-cli.js';
import { RobotsChecker } from './robots.js';
import { WriterService } from './service.js';
import { Mutex } from './mutex.js';
import { HttpClient } from './sources/http.js';
import { mockLlm, persona } from './write-fixtures.js';

describe('parseDraftArgs', () => {
  it('--category <slug> / --category=<slug>', () => {
    expect(parseDraftArgs(['--category', 'qna'])).toEqual({ category: 'qna' });
    expect(parseDraftArgs(['--category=local'])).toEqual({ category: 'local' });
  });
  it('값이 없으면 오류', () => {
    expect(parseDraftArgs([])).toHaveProperty('error');
    expect(parseDraftArgs(['--category'])).toHaveProperty('error');
    expect(parseDraftArgs(['--category', '--x'])).toHaveProperty('error');
  });
});

describe('runDraftCli', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-cli-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('해당 카테고리 페르소나로 드라이런 1회: drafts에 저장하고 요약을 출력, 게시 콜백 없음', async () => {
    const db = openDatabase(dir);
    const http = new HttpClient({ fetchImpl: async () => new Response('', { status: 404 }), hostMinGapMs: {} });
    const pickTopic = vi.fn(async () => null);
    const service = new WriterService(db, { db, llm: mockLlm(() => '{}'), http, robots: new RobotsChecker(http), steps: { pickTopic } }, new Mutex());
    const produce = vi.spyOn(service, 'produce');
    const lines: string[] = [];
    const personas = [{ ...persona, enabled: true, preferredCategories: ['local'] }, { ...persona, id: 'other', preferredCategories: ['qna'] }] as unknown as AgentPersona[];

    const code = await runDraftCli(['--category', 'local'], { personas, service, out: (l) => lines.push(l) });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(produce.mock.calls[0][0].id).toBe('p1');
    expect(produce.mock.calls[0][2]).toEqual({ dryRun: true }); // 게시 콜백이 없다
    expect(service.drafts.list()).toHaveLength(1);
    expect(code).toBe(1); // 폐기(no-topic)
    expect(lines.join('\n')).toContain('폐기');
    expect(lines.join('\n')).toContain('게시되지 않았습니다');
    db.close();
  });

  it('담당 페르소나가 없거나 인자가 틀리면 파이프라인을 돌리지 않는다', async () => {
    const service = { produce: vi.fn() } as unknown as WriterService;
    const out = vi.fn();
    expect(await runDraftCli(['--category', 'nope'], { personas: [{ ...persona, preferredCategories: ['qna'] } as unknown as AgentPersona], service, out })).toBe(2);
    expect(await runDraftCli([], { personas: [], service, out })).toBe(2);
    expect(service.produce).not.toHaveBeenCalled();
  });
});
