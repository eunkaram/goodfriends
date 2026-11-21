import { describe, it, expect } from 'vitest';
import { parseBodySegments } from '../../../frontend/lib/link-detect.js';
import {
  attachImages, buildVisionPrompt, collectCandidates, createLocalVision, isDirectImageUrl, isRenderableImageLine,
  isStandaloneUrlLine, normalizeImageUrl, parseVisionResponse, sniffImage, validateImage, type VisionFn,
} from './images.js';
import type { WriteResult } from './index.js';
import { cleanSourceName, renderBody, buildCardRefs, type Draft } from './write-types.js';
import { makeBundle } from './write-fixtures.js';
import type { ResearchBundle } from './types.js';

// ── 이미지 바이트 픽스처(헤더만 유효, 나머지는 패딩) ─────────────────
function pad(head: number[], size: number): Uint8Array {
  const out = new Uint8Array(Math.max(size, head.length));
  out.set(head);
  return out;
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const l16 = (n: number) => [n & 255, (n >> 8) & 255];
const l24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const png = (w: number, h: number, size = 20000) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h)], size);
const jpeg = (w: number, h: number, size = 20000) =>
  pad([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 1, 1, 0x11, 0], size);
const gif = (w: number, h: number, size = 20000) => pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...l16(w), ...l16(h)], size);
const webpX = (w: number, h: number, size = 20000) =>
  pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, ...l24(w - 1), ...l24(h - 1)], size);

type Handler = (headers: Record<string, string>, url: string) => Response;
function ok(bytes: Uint8Array, ctype = 'image/png', extra: Record<string, string> = {}): Response {
  return new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': ctype, ...extra } });
}
function mockFetch(routes: Record<string, Handler | Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = async (input: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: input, headers });
    const r = routes[input];
    if (!r) return new Response('nope', { status: 404 });
    return typeof r === 'function' ? r(headers, input) : r.clone();
  };
  return { impl, calls };
}

describe('goodfriends 렌더 호환(link-detect 포팅)', () => {
  it('확장자(+쿼리)가 있는 URL만 이미지로 판별, 확장자 없는 이미지 URL은 판별 못 함', () => {
    expect(isDirectImageUrl('https://x.example/a.jpg')).toBe(true);
    expect(isDirectImageUrl('https://x.example/a.JPEG?w=800&q=80')).toBe(true);
    expect(isDirectImageUrl('https://x.example/a.webp')).toBe(true);
    expect(isDirectImageUrl('https://x.example/image/12345')).toBe(false);
    expect(isDirectImageUrl('https://x.example/a.jpg#frag')).toBe(false);
    expect(isDirectImageUrl('https://x.example/a.jpg/download')).toBe(false);
  });
  it('단독 URL 줄 판정은 줄 전체가 URL 하나일 때만', () => {
    expect(isStandaloneUrlLine('https://x.example/a.png')).toBe(true);
    expect(isStandaloneUrlLine('  https://x.example/a.png  ')).toBe(true);
    expect(isStandaloneUrlLine('그림 https://x.example/a.png')).toBe(false);
    expect(isStandaloneUrlLine('https://x.example/a b.png')).toBe(false);
    expect(isRenderableImageLine('https://x.example/a.png')).toBe(true);
    expect(isRenderableImageLine('https://x.example/photo')).toBe(false);
  });
  it('실제 frontend parseBodySegments와 판별이 일치한다', () => {
    const cases = ['https://x.example/a.jpg', 'https://x.example/a.png?w=800', 'https://x.example/photo', 'https://x.example/a.jpg#f', 'https://x.example/a.webp'];
    for (const u of cases) {
      const segs = parseBodySegments(`문단\n\n${u}\n(이미지: x)`);
      const link = segs.find((s) => s.type === 'link') as any;
      expect(!!link?.link.isDirectImage).toBe(isRenderableImageLine(u));
    }
  });
});

describe('후보 필터', () => {
  it('data:·svg·ico·http·사설 호스트·추적 호스트 제외', () => {
    expect(normalizeImageUrl('data:image/png;base64,AAAA', 'body')).toBeNull();
    expect(normalizeImageUrl('https://x.example/a.svg', 'body')).toBeNull();
    expect(normalizeImageUrl('https://x.example/favicon.ico', 'body')).toBeNull();
    expect(normalizeImageUrl('http://x.example/a.jpg', 'body')).toBeNull();
    expect(normalizeImageUrl('https://127.0.0.1/a.jpg', 'body')).toBeNull();
    expect(normalizeImageUrl('https://192.168.0.4/a.jpg', 'body')).toBeNull();
    expect(normalizeImageUrl('https://secure.gravatar.com/avatar/abc.jpg', 'body')).toBeNull();
    expect(normalizeImageUrl('https://pixel.example/a.gif', 'body')).toBeNull();
    expect(normalizeImageUrl('/relative.jpg', 'body')).toBeNull();
  });
  it('로고·아이콘·아바타·배너·추적 픽셀 파일명 제외, 일반 사진은 통과', () => {
    for (const n of ['logo.png', 'site-logo-dark.png', 'img/icons/a.png', 'avatars/u1.jpg', 'tracking-pixel.gif', 'spacer.gif', 'banner_728.png', 'sprite.png'])
      expect(normalizeImageUrl(`https://x.example/${n}`, 'body'), n).toBeNull();
    expect(normalizeImageUrl('https://x.example/2026/11/ollama-benchmark.png', 'body')).toBe('https://x.example/2026/11/ollama-benchmark.png');
    expect(normalizeImageUrl('https://x.example/catalog/photo.jpg', 'body')).not.toBeNull(); // "ad"가 catalog 안에 있어도 오탐 없음
  });
  it('URL에 박힌 작은 크기 힌트 제외(-150x150, ?w=40), 큰 크기는 통과', () => {
    expect(normalizeImageUrl('https://x.example/a-150x150.jpg', 'body')).toBeNull();
    expect(normalizeImageUrl('https://x.example/a.jpg?w=40', 'body')).toBeNull();
    expect(normalizeImageUrl('https://x.example/a-1200x630.jpg', 'body')).not.toBeNull();
    expect(normalizeImageUrl('https://x.example/a.jpg?w=1200#top', 'body')).toBe('https://x.example/a.jpg?w=1200');
  });
  it('og:image는 사이트 공통 기본 공유 이미지 이름이면 제외', () => {
    expect(normalizeImageUrl('https://x.example/static/og-image.png', 'og')).toBeNull();
    expect(normalizeImageUrl('https://x.example/static/default.jpg', 'og')).toBeNull();
    expect(normalizeImageUrl('https://x.example/static/og-image.png', 'body')).not.toBeNull();
    expect(normalizeImageUrl('https://x.example/posts/12/cover.jpg', 'og')).not.toBeNull();
  });
  it('본문 img 우선, og 뒤, 중복 제거 / 여러 출처에 같이 나오는 URL(공통 이미지)은 제외', () => {
    const b = makeBundle();
    b.sources[0].images = ['https://a.example/p1.png', 'https://shared.example/hero.png', 'data:image/gif;base64,AA', 'https://a.example/p1.png'];
    b.sources[0].ogImage = 'https://a.example/og/cover.png';
    b.sources[1].images = ['https://shared.example/hero.png', 'https://b.example/f.png'];
    const c = collectCandidates(b, ['https://a.example/post']);
    expect(c.map((x) => [x.url, x.origin])).toEqual([['https://a.example/p1.png', 'body'], ['https://a.example/og/cover.png', 'og']]);
    expect(collectCandidates(b, ['https://b.example/paper']).map((x) => x.url)).toEqual(['https://b.example/f.png']);
  });
});

describe('sniffImage (헤더 크기 파싱)', () => {
  it('png/jpeg/gif/webp', () => {
    expect(sniffImage(png(800, 450))).toEqual({ mime: 'image/png', width: 800, height: 450 });
    expect(sniffImage(jpeg(1024, 768))).toEqual({ mime: 'image/jpeg', width: 1024, height: 768 });
    expect(sniffImage(gif(640, 480))).toEqual({ mime: 'image/gif', width: 640, height: 480 });
    expect(sniffImage(webpX(1200, 630))).toEqual({ mime: 'image/webp', width: 1200, height: 630 });
  });
  it('이미지가 아니면 null', () => {
    expect(sniffImage(new TextEncoder().encode('<html>not an image at all, long enough text</html>'))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});

describe('validateImage', () => {
  const U = 'https://img.example/p/a.png';
  const check = (routes: Record<string, Handler | Response>, url = U, options = {}) => {
    const m = mockFetch(routes);
    return validateImage(url, { fetchImpl: m.impl as any, options }).then((r) => ({ r, calls: m.calls }));
  };

  it('정상: 200·image/png·크기 OK → Referer 없이 1회 + Referer=goodfriends로 1회 요청', async () => {
    const { r, calls } = await check({ [U]: ok(png(800, 450)) });
    expect(r).toMatchObject({ ok: true, finalUrl: U, info: { width: 800, height: 450, mime: 'image/png' } });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.Referer).toBeUndefined();
    expect(calls[1].headers.Referer).toBe('https://goodfriends.co/');
    expect(calls[0].headers['User-Agent']).toContain('goodfriends-ai-social');
  });
  it('GOODFRIENDS_PUBLIC_ORIGIN 설정값을 Referer로 쓴다', async () => {
    const { calls } = await check({ [U]: ok(png(800, 450)) }, U, { publicOrigin: 'https://dev.example' });
    expect(calls[1].headers.Referer).toBe('https://dev.example/');
  });
  it('비200 제외', async () => {
    expect((await check({ [U]: new Response('x', { status: 404 }) })).r).toMatchObject({ ok: false, reason: expect.stringContaining('404') });
    expect((await check({ [U]: new Response('x', { status: 403 }) })).r.ok).toBe(false);
  });
  it('이미지가 아닌 Content-Type 제외(text/html, image/svg+xml, image/avif)', async () => {
    expect((await check({ [U]: ok(png(800, 450), 'text/html') })).r.ok).toBe(false);
    expect((await check({ [U]: ok(png(800, 450), 'image/svg+xml') })).r.ok).toBe(false);
    expect((await check({ [U]: ok(png(800, 450), 'image/avif') })).r.ok).toBe(false);
    expect((await check({ [U]: ok(png(800, 450), 'image/png; charset=binary') })).r.ok).toBe(true);
  });
  it('Content-Type이 이미지여도 내용이 이미지가 아니면 제외', async () => {
    const html = new TextEncoder().encode('<html>'.padEnd(20000, 'x'));
    expect((await check({ [U]: ok(html) })).r).toMatchObject({ ok: false, reason: expect.stringContaining('헤더') });
  });
  it('작은 이미지 제외: 바이트 하한, 픽셀 폭, 높이, 극단 비율', async () => {
    expect((await check({ [U]: ok(png(800, 450, 500)) })).r).toMatchObject({ ok: false, reason: expect.stringContaining('작은 파일') });
    expect((await check({ [U]: ok(png(300, 300)) })).r).toMatchObject({ ok: false, reason: expect.stringContaining('작은 이미지') });
    expect((await check({ [U]: ok(png(800, 100)) })).r.ok).toBe(false);
    expect((await check({ [U]: ok(png(2000, 400)) })).r).toMatchObject({ ok: false, reason: expect.stringContaining('비율') });
  });
  it('핫링크 차단: Referer 없이는 되지만 Referer=goodfriends로 막히면 제외', async () => {
    const r1 = await check({ [U]: (h) => (h.Referer ? new Response('no', { status: 403 }) : ok(png(800, 450))) });
    expect(r1.r).toMatchObject({ ok: false, reason: expect.stringContaining('핫링크') });
  });
  it('핫링크 차단: Referer 없는 요청이 막히면 제외', async () => {
    const r = await check({ [U]: (h) => (h.Referer ? ok(png(800, 450)) : new Response('no', { status: 403 })) });
    expect(r.r.ok).toBe(false);
    expect(r.calls).toHaveLength(1);
  });
  it('핫링크 차단: Referer 요청에만 placeholder(HTML)를 주면 제외', async () => {
    const r = await check({ [U]: (h) => (h.Referer ? ok(png(800, 450), 'text/html') : ok(png(800, 450))) });
    expect(r.r.ok).toBe(false);
  });
  it('리다이렉트: 최종 URL을 돌려주고 Referer 확인도 최종 URL로', async () => {
    const F = 'https://cdn.example/final/a.jpg';
    const { r, calls } = await check({
      [U]: new Response(null, { status: 302, headers: { location: F } }),
      [F]: ok(jpeg(1200, 800), 'image/jpeg'),
    });
    expect(r).toMatchObject({ ok: true, finalUrl: F });
    expect(calls.map((c) => c.url)).toEqual([U, F, F]);
  });
  it('상대 Location 리다이렉트 처리, 확장자 없는 최종 URL은 goodfriends가 이미지로 못 그려 제외', async () => {
    const rel = await check({ [U]: new Response(null, { status: 301, headers: { location: '/p/b.png' } }), 'https://img.example/p/b.png': ok(png(800, 450)) });
    expect(rel.r).toMatchObject({ ok: true, finalUrl: 'https://img.example/p/b.png' });
    const noext = await check({ [U]: new Response(null, { status: 302, headers: { location: 'https://cdn.example/image/123' } }), 'https://cdn.example/image/123': ok(png(800, 450)) });
    expect(noext.r).toMatchObject({ ok: false, reason: expect.stringContaining('렌더') });
  });
  it('안전하지 않은 리다이렉트(http, 사설 IP)·리다이렉트 과다 제외', async () => {
    expect((await check({ [U]: new Response(null, { status: 302, headers: { location: 'http://cdn.example/a.png' } }) })).r.ok).toBe(false);
    expect((await check({ [U]: new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a.png' } }) })).r.ok).toBe(false);
    const loop = new Response(null, { status: 302, headers: { location: U } });
    expect((await check({ [U]: loop })).r).toMatchObject({ ok: false, reason: expect.stringContaining('과다') });
  });
  it('최대 바이트: Content-Length 선언 초과, 스트림이 상한을 넘는 경우 모두 제외', async () => {
    expect((await check({ [U]: ok(png(800, 450), 'image/png', { 'content-length': '999999999' }) })).r).toMatchObject({ ok: false, reason: expect.stringContaining('최대') });
    expect((await check({ [U]: ok(png(800, 450, 50000)) }, U, { maxBytes: 30000 })).r).toMatchObject({ ok: false, reason: expect.stringContaining('최대') });
    expect((await check({ [U]: ok(png(800, 450, 50000)) }, U, { maxBytes: 60000 })).r.ok).toBe(true);
  });
  it('타임아웃·네트워크 예외는 제외(예외를 던지지 않는다)', async () => {
    const hang = ((_u: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any;
    const r = await validateImage(U, { fetchImpl: hang, options: { timeoutMs: 20 } });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('타임아웃') });
    const boom = (async () => { throw new Error('ECONNRESET'); }) as any;
    expect((await validateImage(U, { fetchImpl: boom })).ok).toBe(false);
  });
});

describe('vision', () => {
  it('응답 파싱: 코드펜스 허용, relevant가 boolean이 아니면 null', () => {
    expect(parseVisionResponse('{"relevant": true, "caption": "벤치마크 그래프", "reason": "내용과 일치"}')).toEqual({ relevant: true, caption: '벤치마크 그래프', reason: '내용과 일치' });
    expect(parseVisionResponse('```json\n{"relevant": false, "caption": "", "reason": "로고"}\n```')?.relevant).toBe(false);
    expect(parseVisionResponse('{"relevant": "yes"}')).toBeNull();
    expect(parseVisionResponse('모르겠습니다')).toBeNull();
    expect(parseVisionResponse('[1,2]')).toBeNull();
  });
  it('프롬프트에 광고·로고 제외 기준과 이미지 속 지시 무시 문구가 있다', () => {
    expect(buildVisionPrompt('섹션 내용')).toContain('광고');
    expect(buildVisionPrompt('섹션 내용')).toContain('로고');
  });
  it('createLocalVision: base64 data URL·thinking 끔·JSON 모드로 보내고 think 태그를 제거한다', async () => {
    let body: any;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>{"relevant":true}' } }] }), { status: 200 });
    }) as any;
    const out = await createLocalVision({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', fetchImpl })({ system: 's', prompt: 'p', imageDataUrl: 'data:image/png;base64,AAAA' });
    expect(out).toBe('{"relevant":true}');
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });
  it('createLocalVision: HTTP 오류는 throw', async () => {
    const fetchImpl = (async () => new Response('x', { status: 500 })) as any;
    await expect(createLocalVision({ fetchImpl })({ system: 's', prompt: 'p', imageDataUrl: 'd' })).rejects.toThrow();
  });
});

// ── 배치 ─────────────────────────────────────────────────────────────

function passedResult(bundle: ResearchBundle, sections: { heading?: string; text: string; ids: string[] }[]): WriteResult {
  const draft: Draft = {
    title: '제목',
    sections: sections.map((s) => ({ heading: s.heading, factIds: s.ids, paragraphs: [[{ text: s.text, cardIds: s.ids }]] })),
  };
  const { body, usedUrls } = renderBody(draft, buildCardRefs(bundle));
  return {
    status: 'passed', title: draft.title, body, usedSources: usedUrls.map((url) => ({ url, title: '' })),
    review: { invalidCards: [], sentences: [], fixes: [], rounds: 1 }, reasons: [], outline: null, draft,
  };
}

describe('attachImages', () => {
  const A1 = 'https://a.example/img/one.png';
  const A2 = 'https://a.example/img/two.png';
  const B1 = 'https://b.example/img/three.png';
  function setup() {
    const bundle = makeBundle();
    bundle.sources[0].images = [A1, A2];
    bundle.sources[0].siteName = 'Ollama | **Blog**';
    bundle.sources[1].images = [B1];
    const fetch = mockFetch({ [A1]: ok(png(800, 450)), [A2]: ok(png(900, 500)), [B1]: ok(jpeg(1000, 600), 'image/jpeg') });
    const yes: VisionFn = async () => '{"relevant": true, "caption": "그림", "reason": "일치"}';
    const result = passedResult(bundle, [
      { heading: '소개', text: 'Ollama v0.12.3이 나왔다.', ids: ['F1', 'F2'] },
      { text: 'MMLU 12% 향상이다.', ids: ['F3'] },
    ]);
    return { bundle, fetch, yes, result };
  }

  it('형식: 섹션 문단 뒤에 빈 줄 + URL 단독 줄 + "(이미지: 출처명)" 줄, 섹션당 1장', async () => {
    const { bundle, fetch, yes, result } = setup();
    const r = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision: yes });
    expect(r.images.map((i) => i.url)).toEqual([A1, B1]);
    expect(r.body).toBe(
      ['소개', 'Ollama v0.12.3이 나왔다.', `${A1}\n(이미지: Ollama Blog)`, 'MMLU 12% 향상이다.', `${B1}\n(이미지: b.example)`, '참고\n- Ollama release https://a.example/post\n- Paper https://b.example/paper']
        .join('\n\n'),
    );
    // 두 번째 후보(A2)는 같은 섹션이라 쓰지 않는다
    expect(r.body).not.toContain(A2);
  });
  it('실제 frontend 파서가 이미지 줄을 <img>(isDirectImage link)로 읽고, 참고 줄은 그대로 텍스트', async () => {
    const { bundle, fetch, yes, result } = setup();
    const r = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision: yes });
    const segs = parseBodySegments(r.body);
    const links = segs.filter((s) => s.type === 'link') as any[];
    expect(links.map((l) => [l.link.url, l.link.isDirectImage])).toEqual([[A1, true], [B1, true]]);
    expect(segs.some((s) => s.type === 'text' && s.value.startsWith('(이미지: Ollama Blog)'))).toBe(true);
  });
  it('글당 N장 제한(설정값)', async () => {
    const { bundle, fetch, yes, result } = setup();
    const r = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision: yes, options: { maxPerPost: 1 } });
    expect(r.images).toHaveLength(1);
    expect(r.body.split('\n').filter((l) => l.startsWith('(이미지:'))).toHaveLength(1);
    const zero = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision: yes, options: { maxPerPost: 0 } });
    expect(zero.body).toBe(result.body);
  });
  it('vision이 부적합 판정하면 다음 후보를 시도하고, 모두 부적합이면 본문 불변', async () => {
    const { bundle, fetch, result } = setup();
    let n = 0;
    const second: VisionFn = async () => (n++ === 0 ? '{"relevant": false, "caption": "", "reason": "로고"}' : '{"relevant": true, "caption": "c", "reason": "r"}');
    const r = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision: second, options: { maxPerPost: 1 } });
    expect(r.images.map((i) => i.url)).toEqual([A2]);
    expect(r.imageRejections[0].reason).toContain('로고');
    const no: VisionFn = async () => '{"relevant": false, "caption": "", "reason": "광고"}';
    const r2 = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision: no });
    expect(r2.body).toBe(result.body);
    expect(r2.images).toEqual([]);
  });
  it('vision 실패(예외·파싱 불가·미지정)면 이미지 없이 진행(글 그대로)', async () => {
    const { bundle, fetch, result } = setup();
    const boom: VisionFn = async () => { throw new Error('LLM down'); };
    const junk: VisionFn = async () => '이미지가 좋아 보입니다';
    for (const vision of [boom, junk, undefined]) {
      const r = await attachImages(result, bundle, { fetchImpl: fetch.impl as any, vision });
      expect(r.body).toBe(result.body);
      expect(r.images).toEqual([]);
      expect(r.status).toBe('passed');
    }
  });
  it('검증 실패 이미지(핫링크·작은 이미지)는 건너뛰고 다음 후보 사용', async () => {
    const { bundle, yes, result } = setup();
    const f = mockFetch({ [A1]: (h) => (h.Referer ? new Response('x', { status: 403 }) : ok(png(800, 450))), [A2]: ok(png(900, 500)), [B1]: ok(png(100, 100)) });
    const r = await attachImages(result, bundle, { fetchImpl: f.impl as any, vision: yes });
    expect(r.images.map((i) => i.url)).toEqual([A2]);
    expect(r.imageRejections.map((x) => x.url)).toEqual([A1, B1]);
  });
  it('discarded·draft 없음·usedSources 밖 출처의 이미지는 붙이지 않는다', async () => {
    const { bundle, fetch, yes, result } = setup();
    const d = await attachImages({ ...result, status: 'discarded' }, bundle, { fetchImpl: fetch.impl as any, vision: yes });
    expect(d.images).toEqual([]);
    expect(fetch.calls).toHaveLength(0);
    const nd = await attachImages({ ...result, draft: null }, bundle, { fetchImpl: fetch.impl as any, vision: yes });
    expect(nd.body).toBe(result.body);
    const only = await attachImages({ ...result, usedSources: [{ url: 'https://a.example/post', title: '' }] }, bundle, { fetchImpl: fetch.impl as any, vision: yes });
    expect(only.images.map((i) => i.url)).toEqual([A1]);
  });
  it('같은 이미지(리다이렉트 최종 URL 동일)를 두 섹션에 중복 배치하지 않는다', async () => {
    const bundle = makeBundle();
    bundle.sources[0].images = ['https://a.example/x/1.png'];
    bundle.sources[1].images = ['https://b.example/x/2.png'];
    const FINAL = 'https://cdn.example/same.png';
    const f = mockFetch({
      'https://a.example/x/1.png': new Response(null, { status: 302, headers: { location: FINAL } }),
      'https://b.example/x/2.png': new Response(null, { status: 302, headers: { location: FINAL } }),
      [FINAL]: ok(png(800, 450)),
    });
    const result = passedResult(bundle, [{ text: '가.', ids: ['F1'] }, { text: '나.', ids: ['F3'] }]);
    const r = await attachImages(result, bundle, { fetchImpl: f.impl as any, vision: async () => '{"relevant":true,"caption":"c","reason":"r"}' });
    expect(r.images.map((i) => i.url)).toEqual([FINAL]);
  });
  it('출처명 정리: 마크다운·|·URL 제거', () => {
    expect(cleanSourceName('Release **v0.12** | notes')).toBe('Release v0.12 notes');
    expect(cleanSourceName('[Docs](https://x.example) `code` <b>굵게</b>')).toBe('Docs code 굵게');
    expect(cleanSourceName('줄\n바꿈  https://x.example/a.png 뒤')).toBe('줄 바꿈 뒤');
    expect(cleanSourceName('가'.repeat(100)).length).toBe(60);
    expect(cleanSourceName('')).toBe('');
  });
  it('renderBody: 출처명이 정리돼 참고 줄에도 적용, 이미지 없으면 기존과 동일', () => {
    const b = makeBundle();
    b.facts[0].sourceTitle = 'Release **v0.12** | notes';
    const d: Draft = { title: 't', sections: [{ factIds: ['F1'], paragraphs: [[{ text: '문장이다.', cardIds: ['F1'] }]] }] };
    const { body } = renderBody(d, buildCardRefs(b));
    expect(body).toBe('문장이다.\n\n참고\n- Release v0.12 notes https://a.example/post');
    expect(renderBody(d, buildCardRefs(b), new Map()).body).toBe(body);
  });
});
