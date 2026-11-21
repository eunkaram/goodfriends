/**
 * goodfriends frontend 렌더 계약 테스트. ai-social의 tsc 프로그램(src/**만 포함)에 frontend 소스가 섞이지 않도록
 * src 밖에 둔다 — vitest(`contract/**`)만 이 파일을 읽고, `npm run typecheck`는 읽지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { parseBodySegments } from '../../frontend/lib/link-detect.js';
import { isRenderableImageLine } from '../src/writer/images.js';
import { buildCardRefs, renderBody, type Draft } from '../src/writer/write-types.js';
import { makeBundle } from '../src/writer/write-fixtures.js';

describe('frontend parseBodySegments 계약', () => {
  it('이미지 URL 판별이 ai-social의 isRenderableImageLine과 일치한다', () => {
    const cases = ['https://x.example/a.jpg', 'https://x.example/a.png?w=800', 'https://x.example/photo', 'https://x.example/a.jpg#f', 'https://x.example/a.webp'];
    for (const u of cases) {
      const segs = parseBodySegments(`문단\n\n${u}\n(이미지: x)`);
      const link = segs.find((s) => s.type === 'link') as any;
      expect(!!link?.link.isDirectImage).toBe(isRenderableImageLine(u));
    }
  });
  it('renderBody가 만든 이미지 줄을 frontend가 <img>(isDirectImage link)로 읽고, 참고 줄은 텍스트로 둔다', () => {
    const bundle = makeBundle();
    const draft: Draft = {
      title: '제목',
      sections: [
        { factIds: ['F1'], paragraphs: [[{ text: '가.', cardIds: ['F1'] }]] },
        { factIds: ['F3'], paragraphs: [[{ text: '나.', cardIds: ['F3'] }]] },
      ],
    };
    const A1 = 'https://a.example/img/one.png';
    const B1 = 'https://b.example/img/three.jpg';
    const { body } = renderBody(draft, buildCardRefs(bundle), new Map([[0, { url: A1, credit: 'Ollama Blog' }], [1, { url: B1, credit: 'b.example' }]]));
    const segs = parseBodySegments(body);
    const links = segs.filter((s) => s.type === 'link') as any[];
    expect(links.filter((l) => l.link.isDirectImage).map((l) => l.link.url)).toEqual([A1, B1]);
    expect(segs.some((s) => s.type === 'text' && s.value.startsWith('(이미지: Ollama Blog)'))).toBe(true);
  });
});
