/**
 * 일반 링크 OG 카드 미리보기 — §11.9.2류 "Threads처럼 자동 임베드"(사용자 지시,
 * 2026-08)의 일반 링크 쪽. 유튜브(src/link-detect.ts)는 video ID만 뽑아
 * 클라이언트가 바로 iframe을 그리지만, 일반 링크는 그 페이지의 OG 메타태그를
 * **서버가** 가져와야 한다 — 브라우저에서 임의 사이트로 직접 fetch하면
 * CORS에 막힌다.
 *
 * 🔒 SSRF 방어 — 사용자가 넣은 URL로 우리 서버가 요청을 보내는 구조라, 그
 * 대상이 우리 내부망이나 클라우드 메타데이터 엔드포인트(169.254.169.254 등)를
 * 가리키면 안 된다. 여기서 막는 것: (1) http/https만 허용 (2) hostname 자체가
 * 사설/루프백 리터럴이면 거부 (3) DNS 조회 결과 IP도 재검사. ⚠️ 한계: lookup()
 * 시점과 실제 fetch 시점 사이에 DNS 응답이 바뀌는 TOCTOU(DNS rebinding)까지는
 * 못 막는다 — 완전 방어는 fetch가 사용할 소켓의 IP를 직접 고정해야 하는데,
 * Node 기본 fetch(undici)는 그 훅을 안 준다. 지금은 "명백한 내부망 타겟팅"만
 * 막는 실용적 수준이라는 걸 알고 쓸 것.
 *
 * 🔒 보안 점검 발견(2026-08-22) — 위 검증은 최초 요청 hostname에만 걸려있고,
 * `fetch(url, { redirect: 'follow' })`는 그 뒤 리다이렉트를 재검증 없이
 * 그대로 따라갔다. 공개 URL(검증 통과) → 그 서버가 302로 내부망 주소를
 * 가리키게 응답 → fetch가 조용히 따라가는 우회가 가능했다(그것도 응답이
 * text/html이면 title/description까지 그대로 호출자에게 반환됨 — blind
 * SSRF가 아니라 내용 유출까지 됨). `redirect: 'manual'`로 바꾸고 매 홉마다
 * 똑같은 검증(isSafeUrl)을 다시 통과시키는 루프로 고쳤다 — 아래 참고.
 */
import { lookup } from 'node:dns/promises';

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  /** 🔒 사용자 발견 — 확장자 없는 CDN 이미지 URL(og:태그 없음)도 content-type으로 잡는다. true면 image를 카드가 아니라 원본 크기 그대로 그린다. */
  isImage?: boolean;
};

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 300_000; // <head>만 있으면 충분 — 큰 페이지 전체를 받지 않는다

export function isPrivateOrLoopbackIp(ip: string): boolean {
  if (ip === '0.0.0.0' || ip === '::' || ip === '::1') return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true; // 링크로컬 — 클라우드 메타데이터(169.254.169.254) 포함
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // IPv6 ULA(fc00::/7)
  if (/^fe80:/i.test(ip)) return true; // IPv6 링크로컬
  return false;
}

async function isSafeRemoteHost(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return false;
  if (isPrivateOrLoopbackIp(hostname)) return false;
  try {
    const { address } = await lookup(hostname);
    return !isPrivateOrLoopbackIp(address);
  } catch {
    return false; // resolve 실패 — 안전하게 거부
  }
}

/** 스킴+호스트 검증을 한데 묶은 것 — 최초 요청과 리다이렉트 매 홉에 똑같이 적용한다. */
export async function isSafeUrl(url: URL): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isSafeRemoteHost(url.hostname);
}

const MAX_REDIRECTS = 5;

/**
 * fetch()의 redirect:'follow'와 달리 매 홉마다 isSafeUrl로 다시 검증한다 —
 * 최초 hostname만 검증하고 리다이렉트는 무검증으로 따라가던 SSRF 우회를 막는다.
 */
async function fetchFollowingSafeRedirects(startUrl: URL, signal: AbortSignal): Promise<Response | null> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeUrl(current))) return null;
    const res = await fetch(current.toString(), {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AICommunityLinkPreview/1.0)' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      await res.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(res.headers.get('location')!, current);
      } catch {
        return null;
      }
      current = next;
      continue;
    }
    return res;
  }
  return null; // 리다이렉트가 너무 많음 — 안전하게 포기
}

function extractMeta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    // property="og:title" / name="og:title" 둘 다, content 속성 순서 무관하게 매치
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      'i',
    );
    const m = html.match(re);
    const value = m?.[1] ?? m?.[2];
    if (value) return decodeHtmlEntities(value.trim());
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export type YoutubeEmbedSize = { width: number; height: number };

// 🔒 사용자 지시(2026-08, "비디오 링크를 넣으면 자동으로 잘 불러와 지는데.
// 가로/세로 규격을 찾아서 자동으로 임베드 시켜줘") — 지금까지 유튜브
// 임베드는 항상 고정 16:9 박스였다(LinkPreviewCard.module.css `.youtubeWrap`)
// — 세로 영상(Shorts 등)을 넣으면 실제 비율과 안 맞았다. 유튜브 oEmbed
// 엔드포인트가 그 영상의 실제 표준 임베드 width/height(비율 그대로)를
// 돌려준다 — 여기 자체가 fetchLinkPreview와 달리 SSRF 방어가 필요 없다,
// videoId만 변수고 호출 대상 호스트(www.youtube.com)는 사용자 입력이 아니라
// 항상 고정이라서다.
export async function fetchYoutubeEmbedSize(videoId: string): Promise<YoutubeEmbedSize | null> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await fetch(oembedUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { width?: unknown; height?: unknown };
    if (typeof data.width !== 'number' || typeof data.height !== 'number' || data.width <= 0 || data.height <= 0) return null;
    return { width: data.width, height: data.height };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!(await isSafeUrl(parsed))) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFollowingSafeRedirects(parsed, controller.signal);
    if (!res || !res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';

    // 🔒 사용자 발견 — 확장자로 못 잡는 이미지 URL(예: 확장자 없는 CDN)은
    // content-type으로 잡는다. 헤더만 보고 판단하니 본문은 버퍼링하지
    // 않고 바로 정리한다(수백 KB~수 MB짜리 이미지를 메모리에 안 올림).
    if (contentType.startsWith('image/')) {
      await res.body?.cancel().catch(() => {});
      return { url: parsed.toString(), title: null, description: null, image: parsed.toString(), siteName: null, isImage: true };
    }
    if (!contentType.includes('text/html')) return null;

    const buf = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buf.slice(0, MAX_HTML_BYTES));

    const title = extractMeta(html, 'og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
    const description = extractMeta(html, 'og:description', 'description');
    const image = extractMeta(html, 'og:image');
    const siteName = extractMeta(html, 'og:site_name') ?? parsed.hostname;

    if (!title && !description && !image) return null;
    return { url: parsed.toString(), title, description, image, siteName };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
