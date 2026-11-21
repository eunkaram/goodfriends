import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDatabase } from '../db/database.js';
import { DraftStore } from '../writer/drafts.js';
import { createDashboardServer } from './server.js';

describe('대시보드 초안 API', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let store: DraftStore;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-drafts-'));
    const db = openDatabase(dir);
    store = new DraftStore(db);
    store.insert({
      personaId: 'p1', category: 'qna', status: 'passed', title: '통과한 글', body: '본문입니다',
      sources: [{ url: 'https://a.example/x', title: 'A' }],
      facts: [{ claim: '주장', quote: 'quote text here', url: 'https://a.example/x', sourceTitle: 'A', publishedAt: null }],
      review: { invalidCards: [], sentences: [], fixes: [], rounds: 1 },
      images: [{ url: 'https://c.example/i.png', caption: '그림' }], reasons: [], createdAt: '2026-11-20T01:00:00.000Z',
    });
    store.insert({
      personaId: 'p2', category: 'free', status: 'discarded', title: '', body: '', sources: [], facts: [], review: null, images: [], reasons: ['no-topic'], createdAt: '2026-11-20T02:00:00.000Z',
    });
    const app = createDashboardServer({ getAll: () => [] } as any, { getAllStates: () => [], getLogs: () => [] } as any, { getStatus: () => ({ running: false }) } as any, {} as any, store);
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/drafts: 최신순 목록(상태·카테고리·제목·사유), 본문·사실 카드는 제외', async () => {
    const { drafts } = (await (await fetch(`${base}/api/drafts`)).json()) as any;
    expect(drafts.map((d: any) => [d.status, d.category, d.title, d.reasons])).toEqual([
      ['discarded', 'free', '', ['no-topic']],
      ['passed', 'qna', '통과한 글', []],
    ]);
    expect(drafts[0]).not.toHaveProperty('body');
    expect(drafts[0]).not.toHaveProperty('facts');
  });

  it('상태·카테고리 필터', async () => {
    const a = (await (await fetch(`${base}/api/drafts?status=passed`)).json()) as any;
    expect(a.drafts.map((d: any) => d.title)).toEqual(['통과한 글']);
    const b = (await (await fetch(`${base}/api/drafts?category=free`)).json()) as any;
    expect(b.drafts).toHaveLength(1);
  });

  it('GET /api/drafts/:id: 본문·사실 카드·리뷰·이미지·출처 상세, 없으면 404', async () => {
    const { drafts } = (await (await fetch(`${base}/api/drafts`)).json()) as any;
    const passedId = drafts.find((d: any) => d.status === 'passed').id;
    const d = (await (await fetch(`${base}/api/drafts/${passedId}`)).json()) as any;
    expect(d).toMatchObject({ title: '통과한 글', body: '본문입니다', publishedPostId: null });
    expect(d.facts[0].claim).toBe('주장');
    expect(d.review.rounds).toBe(1);
    expect(d.images[0].url).toBe('https://c.example/i.png');
    expect(d.sources[0].url).toBe('https://a.example/x');
    expect((await fetch(`${base}/api/drafts/nope`)).status).toBe(404);
  });

  it('대시보드 HTML에 초안 목록·상세 UI(한국어)가 있다', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('글 초안');
    expect(html).toContain('/api/drafts');
    expect(html).toContain('사실 카드');
    expect(html).toContain('리뷰 판정');
  });
});
