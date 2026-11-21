import { describe, it, expect } from 'vitest';
import { writePost } from './index.js';
import { makeBundle, mockLlm, persona, sys, usr } from './write-fixtures.js';

function pipelineLlm(opts: { sectionText: string; verdict?: string }) {
  return mockLlm((m, json) => {
    if (sys(m).includes('개요를 짜는 중')) {
      return JSON.stringify({ title: 'Ollama 새 버전 정리', angle: '릴리스 노트', lengthHint: 'short', sections: [{ purpose: '소개', factIds: ['F1', 'F2'] }] });
    }
    if (sys(m).includes('사실 확인 검수자')) return JSON.stringify({ results: [1, 2, 3].map((n) => ({ id: `F${n}`, supported: true })) });
    if (sys(m).includes('팩트체크 리뷰어')) {
      const lines = [...usr(m).matchAll(/^(\d+)\. /gm)];
      return JSON.stringify({ reviews: lines.map((l) => ({ i: Number(l[1]), verdict: opts.verdict ?? 'supported', cardIds: [], note: '' })) });
    }
    if (sys(m).includes('고치는 중')) return JSON.stringify({ action: 'delete' });
    if (!json) return opts.sectionText;
    return undefined;
  });
}

describe('writePost', () => {
  it('개요 → 본문 → 검증 통과: 마커 없는 본문 + 참고 출처', async () => {
    const llm = pipelineLlm({ sectionText: '릴리스 노트 보니까 v0.12.3이 11월 4일에 나왔다. [F1]\n\nGPT-OSS 지원도 붙었다. [F2]' });
    const r = await writePost(makeBundle(), persona, { llm });
    expect(r.status).toBe('passed');
    expect(r.title).toBe('Ollama 새 버전 정리');
    expect(r.body).not.toMatch(/\[F\d/);
    expect(r.body.endsWith('참고\n- Ollama release https://a.example/post')).toBe(true);
    expect(r.usedSources).toEqual([{ url: 'https://a.example/post', title: 'Ollama release' }]);
  });

  it('근거 없는 수치가 계속 남으면 discarded', async () => {
    const llm = pipelineLlm({ sectionText: 'v9.9.9가 나왔다. [F1]' });
    const r = await writePost(makeBundle(), persona, { llm });
    expect(r.status).toBe('discarded');
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('개요 실패는 discarded(outline-failed)', async () => {
    const llm = mockLlm(() => 'bad');
    const r = await writePost(makeBundle(), persona, { llm });
    expect(r.status).toBe('discarded');
    expect(r.reasons[0]).toContain('outline-failed');
  });
});
