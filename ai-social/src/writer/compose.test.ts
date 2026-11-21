import { describe, it, expect } from 'vitest';
import { composeDraft, buildSectionSystemPrompt, renderDraft } from './compose.js';
import { parseSectionText } from './write-types.js';
import { makeBundle, mockLlm, persona, usr } from './write-fixtures.js';
import type { Outline } from './outline.js';

const outline: Outline = {
  title: 'Ollama 새 버전',
  angle: '릴리스 노트 정리',
  lengthHint: 'medium',
  sections: [
    { heading: '무엇이 바뀌었나', purpose: '릴리스 소개', factIds: ['F1', 'F2'] },
    { purpose: '논문 결과', factIds: ['F3'] },
  ],
};

describe('parseSectionText', () => {
  const allowed = new Set(['F1', 'F2']);
  it('문장별 마커를 cardIds로 옮기고 텍스트에서 제거(마침표 앞/뒤 모두)', () => {
    const p = parseSectionText('릴리스 노트 보니까 v0.12.3이 나왔다. [F1] GPT-OSS도 된다[F2].', allowed);
    expect(p[0].map((s) => s.text)).toEqual(['릴리스 노트 보니까 v0.12.3이 나왔다.', 'GPT-OSS도 된다.']);
    expect(p[0].map((s) => s.cardIds)).toEqual([['F1'], ['F2']]);
  });
  it('버전 숫자의 점에서는 문장을 자르지 않는다', () => {
    const p = parseSectionText('v1.2.3 이 나왔다 [F1]', allowed);
    expect(p[0]).toHaveLength(1);
  });
  it('허용 밖 마커 무시, 마크다운·URL 제거, 빈 줄로 문단 구분', () => {
    const p = parseSectionText('## 제목\n- **굵게** 시작이다. [F7]\n\n1. 둘째 문단 https://x.example/a 이다. [F2]', allowed);
    expect(p).toHaveLength(2);
    expect(p[0].map((x) => x.text)).toEqual(['제목', '굵게 시작이다.']);
    expect(p[1][0].text).toBe('둘째 문단 이다.');
    expect(JSON.stringify(p)).not.toMatch(/[#*]|https?:/);
  });
});

describe('parseSectionText 확장 (줄바꿈·약어·마크다운)', () => {
  const allowed = new Set(['F1', 'F2']);
  it('줄바꿈은 문장 경계 — 다음 줄 마커가 앞 줄 근거로 번지지 않는다', () => {
    const p = parseSectionText('줄1 마커없음\n줄2 마커없음 [F2]', allowed);
    expect(p[0]).toEqual([{ text: '줄1 마커없음', cardIds: [] }, { text: '줄2 마커없음', cardIds: ['F2'] }]);
  });
  it('마커만 있는 줄은 앞 문장에 붙는다', () => {
    const p = parseSectionText('문장이다.\n[F1]', allowed);
    expect(p[0]).toEqual([{ text: '문장이다.', cardIds: ['F1'] }]);
  });
  it('e.g. / i.e. / vs. 에서는 분리하지 않는다', () => {
    const p = parseSectionText('로컬 모델, e.g. 작은 것들이 좋다. [F1] A vs. B 는 다르다. [F2]', allowed);
    expect(p[0].map((s) => s.text)).toEqual(['로컬 모델, e.g. 작은 것들이 좋다.', 'A vs. B 는 다르다.']);
  });
  it('링크·표·기울임·HTML 태그 정리', () => {
    const p = parseSectionText('[릴리스 노트](https://x.example/a) 참고다. [F1]\n| 항목 | 값 |\n|---|---|\n| a | b |\n*기울임* 문장<br>끝이다.\n<b>태그</b> 제거', allowed);
    const texts = p[0].map((s) => s.text);
    expect(texts[0]).toBe('릴리스 노트 참고다.');
    expect(texts.join('|')).toContain('항목, 값');
    expect(texts.join('\n')).not.toMatch(/\||<|>|\*|\]\(/);
    expect(texts.join('|')).toContain('기울임 문장 끝이다.');
  });
});

describe('출처 줄 형식', () => {
  it('"- 출처명 URL" 인라인 줄이며 URL만 단독인 줄이 없다(frontend parseBodySegments가 OG 카드를 만들지 않도록)', async () => {
    const bundle = makeBundle();
    const d = { title: 't', sections: [{ factIds: ['F1', 'F3'], paragraphs: [[{ text: 'a.', cardIds: ['F1'] }, { text: 'b.', cardIds: ['F3'] }]] }] };
    const { body } = renderDraft(d, bundle);
    const lines = body.split('\n');
    const refs = lines.slice(lines.indexOf('참고') + 1);
    expect(refs).toEqual(['- Ollama release https://a.example/post', '- Paper https://b.example/paper']);
    expect(lines.some((l) => /^https?:\/\/\S+$/.test(l.trim()))).toBe(false);
  });
});

describe('compose 프롬프트 규칙 문구', () => {
  it('지어낸 경험·수치 금지, URL 금지, 마크다운 금지, 마커 지시가 들어 있다', () => {
    const sys = buildSectionSystemPrompt(persona);
    expect(sys).toContain('지어낸 사용 경험');
    expect(sys).toContain('만들어내지 마세요');
    expect(sys).toContain('출처 URL을 본문에 쓰지 마세요');
    expect(sys).toContain('마크다운 헤더');
    expect(sys).toContain('[F3]');
    expect(sys).toContain('릴리스 노트에 따르면');
  });
});

describe('composeDraft / renderDraft', () => {
  it('섹션마다 배정된 카드만 컨텍스트로 주고, 마커·마크다운 없이 출처 줄을 붙인다', async () => {
    const llm = mockLlm((m) =>
      usr(m).includes('(1/2)')
        ? '릴리스 노트 보니까 v0.12.3이 2026년 11월 4일에 나왔다. [F1]\n\n**GPT-OSS** 지원이 붙었다. [F2]'
        : '논문을 보면 MMLU에서 12% 올랐다고 한다. [F3]'
    );
    const bundle = makeBundle();
    const draft = await composeDraft(bundle, outline, persona, { llm });
    // 컨텍스트 격리
    expect(usr(llm.calls[0].messages)).toContain('[F1]');
    expect(usr(llm.calls[0].messages)).not.toContain('MMLU');
    expect(usr(llm.calls[1].messages)).not.toContain('v0.12.3 was released');
    // 시스템 프롬프트: 페르소나 + 문체 규칙, 짧게쓰기/출처금지 없음
    const sys = buildSectionSystemPrompt(persona);
    expect(sys).toContain('당신은 테스터입니다.');
    expect(sys).toContain('상투적 패턴');
    expect(sys).not.toContain('2~5문장');
    expect(sys).not.toContain('절대 붙여넣지');

    const { body, usedUrls } = renderDraft(draft, bundle);
    expect(body).not.toMatch(/\[F\d+\]/);
    expect(body.split('\n\n참고\n')[0]).not.toMatch(/\*\*|^#|^[-*] /m);
    expect(body).toContain('무엇이 바뀌었나\n\n');
    expect(body).toMatch(/\n\n참고\n- Ollama release https:\/\/a\.example\/post\n- Paper https:\/\/b\.example\/paper$/);
    expect(usedUrls).toEqual(['https://a.example/post', 'https://b.example/paper']);
    expect(draft.sections[0].paragraphs[0][0].cardIds).toEqual(['F1']);
  });

  it('섹션 본문이 비면 ComposeError', async () => {
    const llm = mockLlm(() => '   ');
    await expect(composeDraft(makeBundle(), outline, persona, { llm })).rejects.toThrow(/비었다/);
  });
});
