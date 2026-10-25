/**
 * 본문 텍스트에서 링크를 감지한다 - 글쓰기 모달 실시간 미리보기, 피드/상세
 * 렌더링 양쪽이 공유한다(사용자 지시, 2026-08 - "thread처럼 입력이 되어야해
 * (유튜브 링크를 넣으면 자동으로 임베드)"). DB 스키마는 안 바꿨다 - body엔
 * 원문 링크가 텍스트 그대로 저장되고, 렌더링할 때마다 이 함수로 다시 찾는다.
 * 여러 링크가 있어도 레이아웃 안정성을 위해 첫 번째 링크만 미리보기로 띄운다.
 */
const URL_RE = /https?:\/\/[^\s<>"]+/;
const URL_RE_G = /https?:\/\/[^\s<>"]+/g;

// www./m. 서브도메인, watch?v=, youtu.be, /embed/, /shorts/ 전부 커버.
// 뒤에 다른 쿼리가 붙어도 video ID(11자 고정)만 정확히 뽑는다.
const YOUTUBE_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

// 🔒 실전 발견(2026-08, 사용자 리포트 — "쇼츠를 입력했는데도 가로로 출력") —
// 유튜브 oEmbed(`/oembed?...`)가 Shorts(세로 영상)에도 일반 영상과 똑같은
// 기본 임베드 크기(200x113, 16:9)를 그대로 돌려주는 걸 실측으로 확인했다 —
// oEmbed의 width/height는 "영상의 실제 intrinsic 비율"이 아니라 "권장 플레이어
// 크기"라 Shorts를 구분하지 못한다. YouTube Data API(키 필요, 이 프로젝트엔
// 없음) 없이는 oEmbed로 세로 여부를 알 방법이 없어, URL 자체가 `/shorts/`
// 경로면(Shorts는 정의상 항상 세로) 그 신호를 오히려 더 신뢰할 수 있는
// 판별 기준으로 쓴다.
const YOUTUBE_SHORTS_RE = /youtube\.com\/shorts\//i;

export function isYoutubeShortsUrl(url: string): boolean {
  return YOUTUBE_SHORTS_RE.test(url);
}

// 사용자 발견 - 외부에서 긁어온 콘텐츠를 붙여넣으면 이미지 URL이
// 그대로 텍스트로 들어오는데, OG 카드 로직이 content-type이 text/html이
// 아니면 거부해서 이미지가 조용히 안 그려졌다. 흔한 확장자는 여기서
// 바로 감지해 서버 왕복 없이 이미지로 바로 그린다.
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg)(\?[^\s]*)?$/i;

export function isDirectImageUrl(url: string): boolean {
  return IMAGE_EXT_RE.test(url);
}

// 사용자 지시(2026-08) - "video.twimg.com/.../vid/avc1/.../*.mp4와 같이
// 미디어나 이미지를 넣을 경우 태그로 전환해서 페이지에서 바로 볼수
// 있도록". 직접 이미지 URL과 같은 패턴 - 확장자로 클라이언트에서 바로
// 판별해 <video>로 그린다(서버 왕복 없음, <img>와 마찬가지로 우리
// 서버를 안 거치니 SSRF 표면도 안 늘어난다).
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)(\?[^\s]*)?$/i;

export function isDirectVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

// 🔒 사용자 지시(2026-08, "m3u8같이 스트리밍 형태의 url을 입력하면...
// 최소한으로 작업해줘") — HLS 매니페스트는 `isDirectVideoUrl`의 확장자
// 목록에 없어서(진행형 다운로드 파일이 아니라 세그먼트 목록이라 재생
// 방식 자체가 다르다) 별도로 판별한다 — `<video src>`만으로는 Safari/iOS
// 외 브라우저에서 재생이 안 되고(LinkPreviewCard.tsx의 HlsVideo 참고).
const HLS_EXT_RE = /\.m3u8(\?[^\s]*)?$/i;

export function isHlsUrl(url: string): boolean {
  return HLS_EXT_RE.test(url);
}

export type DetectedLink = {
  url: string;
  youtubeVideoId: string | null;
  /** 🔒 사용자 지시(2026-08, "가로/세로 규격을 찾아서 자동으로 임베드") —
   * `/shorts/` URL이면 항상 세로(9:16)로 취급한다(oEmbed가 못 알려주는 정보). */
  isYoutubeShorts: boolean;
  isDirectImage: boolean;
  isDirectVideo: boolean;
  /** 🔒 사용자 지시(2026-08, "m3u8... 최소한으로") — HLS 스트림. compact
   * 모드는 isDirectVideo와 같은 취급(썸네일 추출 시도, 실패하면 플레이스홀더),
   * non-compact는 HlsVideo가 hls.js를 조건부로 붙인다. */
  isHlsVideo: boolean;
};

/**
 * 사용자 지시(2026-08, "유튜브또는 동영상의 경우 리스트에서는 썸네일또는
 * 미리보기 이미지로 보여주게 해줘") — 유튜브의 공개 썸네일 CDN 패턴이라
 * API 키·서버 왕복 없이 클라이언트에서 바로 그릴 수 있다(iframe 임베드와
 * 같은 이유로 서버를 안 거친다).
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * 사용자 지시(2026-08, "이미지/영상처럼 페이지에서 노출되면 링크는
 * 안보여주면 좋겠어") — 첫 번째 링크가 미리보기(이미지·영상·유튜브·OG
 * 카드)로 실제 노출될 때, 본문 텍스트에서 그 링크(및 바로 앞뒤 공백)를
 * 제거해 링크가 텍스트와 미리보기 두 군데에 중복으로 보이는 걸 없앤다.
 * url이 본문에 없으면(호출 실수 방지) 원문 그대로 반환한다. 앞뒤 텍스트가
 * 둘 다 있으면 공백 하나로 이어붙이고(줄바꿈 등은 뭉개진다 — 실용적
 * 절충, link-preview.ts의 SSRF 방어 문서화와 같은 태도), 링크 하나만
 * 있던 문장이면 빈 문자열을 반환한다.
 */
export function stripFirstLink(text: string, url: string): string {
  const { before, after } = splitAroundLink(text, url);
  if (before && after) return `${before} ${after}`;
  return before || after;
}

/**
 * stripFirstLink와 같은 트리밍(링크 앞뒤 공백 제거)을 하되 before/after를
 * 합치지 않고 따로 반환한다. 🔒 사용자 발견(2026-08, "글 내용보기
 * 페이지의 글 순서가 이상하네... 유튜브, 글 내용순이거든. 근데 글내용과
 * 유튜브가 분리되어서 나와") — LinkAwareBody가 stripFirstLink의 합쳐진
 * 결과를 항상 텍스트 문단으로 먼저 그리고 그 뒤에 LinkPreviewCard를
 * 그려서, 사용자가 링크를 글 맨 앞(또는 중간)에 썼어도 렌더링은 항상
 * "텍스트 먼저, 영상 나중"으로 나왔다 — 실제로 쓴 순서와 무관했다. 이
 * 함수로 앞/뒤를 분리해 LinkAwareBody가 "앞 텍스트 → 미리보기 → 뒤
 * 텍스트" 순서 그대로(원문 위치를 그대로 보존해) 렌더링할 수 있게 한다.
 */
export function splitAroundLink(text: string, url: string): { before: string; after: string } {
  const idx = text.indexOf(url);
  if (idx === -1) return { before: text, after: '' };
  const before = text.slice(0, idx).replace(/\s+$/, '');
  const after = text.slice(idx + url.length).replace(/^\s+/, '');
  return { before, after };
}

export type TextPart = { type: 'text'; value: string } | { type: 'url'; value: string };

/**
 * #16 — 프리뷰 카드로 안 빠지고 문장 중간에 남는 URL(카드 프리뷰 실패,
 * 첫 번째 이후의 추가 링크 등)도 클릭 가능한 링크로 보이게 텍스트를
 * 조각낸다. 렌더링(target="_blank" 등)은 호출부(컴포넌트) 몫 — 이 함수는
 * SSR도 되는 순수 로직만.
 */
export function splitTextLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE_G)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, idx) });
    parts.push({ type: 'url', value: match[0] });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}

/** 본문에서 첫 번째 URL을 찾는다. 없으면 null. */
export function detectFirstLink(text: string): DetectedLink | null {
  const match = text.match(URL_RE);
  if (!match) return null;
  const url = match[0];
  const ytMatch = url.match(YOUTUBE_RE);
  return {
    url,
    youtubeVideoId: ytMatch ? ytMatch[1] : null,
    isYoutubeShorts: ytMatch ? isYoutubeShortsUrl(url) : false,
    isDirectImage: isDirectImageUrl(url),
    isDirectVideo: isDirectVideoUrl(url),
    isHlsVideo: isHlsUrl(url),
  };
}

/**
 * 사용자 발견(2026-08) - "이미지가 여러개 있는것을 긁어서 붙여넣었는데
 * 이미지 하나만 등록. 이미지 링크와 이미지명도 보이면 안돼. 긁어온 내용이
 * 그대로 붙여져서 저장되어야해." 예전엔 붙여넣기에서 찾은 첫 이미지 URL을
 * 본문 텍스트 끝에 그대로 이어 붙였다 - 그래서 이미지가 한 장으로 제한되고
 * 그 URL이 눈에 보이는 텍스트로 남았다. 이제 paste-html-to-text.ts(클라이언트
 * 전용 DOM 워커라 SSR도 되는 이 파일엔 두지 않는다)가 붙여넣기 시점에 여러
 * 이미지를 전부 마커로 본문 안에 심어 넣고, 아래 함수들이 렌더링 시점에
 * 그 마커를 진짜 이미지로 되돌린다. 마커 접두어는 유니코드 제어문자
 * 하나(SOH, code point 1)로 시작한다 - 사람이 실제로 타이핑할 리 없는
 * 문자라 정상 텍스트와 절대 안 겹치고, 혹시 렌더링을 안 거치고 새어나가도
 * 화면에 보이지 않는 문자라 무해하다.
 */
const IMAGE_MARKER_PREFIX = String.fromCharCode(1) + 'IMG:';
const IMAGE_MARKER_RE = new RegExp(String.fromCharCode(1) + 'IMG:(\\S+)', 'g');

export type BodySegment = { type: 'text'; value: string } | { type: 'image'; url: string };

/** 본문에 이미지 마커가 하나라도 있는지 - 있으면 기존 단일 링크 미리보기 대신 다중 이미지 렌더링을 쓴다. */
export function hasImageMarkers(body: string): boolean {
  return body.includes(IMAGE_MARKER_PREFIX);
}

/** 본문을 텍스트/이미지 조각으로 순서대로 쪼갠다. 원래 위치 근처에 이미지가 그대로 남는다. */
export function parseBodyWithImageMarkers(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(IMAGE_MARKER_RE)) {
    const idx = match.index ?? 0;
    const before = body.slice(lastIndex, idx).trim();
    if (before) segments.push({ type: 'text', value: before });
    segments.push({ type: 'image', url: match[1] });
    lastIndex = idx + match[0].length;
  }
  const rest = body.slice(lastIndex).trim();
  if (rest) segments.push({ type: 'text', value: rest });
  return segments;
}

/** 붙여넣기 시점에 이미지 위치에 심을 마커 텍스트를 만든다(paste-html-to-text.ts 전용). */
export function makeImageMarker(url: string): string {
  return `${IMAGE_MARKER_PREFIX}${url}`;
}

/**
 * 사용자 지시(2026-08, "글, 영상, 글, 미디어, 영상 이런식으로 수정했었는데
 * 또 고낭났어. 글쓰기와 글 내용수정 둘다 같은 기능이어야해") — 이미지
 * 마커와 똑같은 방식으로, "한 줄 전체가 정확히 URL 하나뿐인" 줄을 별도
 * `link` 세그먼트로 뽑아낸다. 여러 이미지·여러 링크·텍스트가 어떤 순서로
 * 섞여 있어도(예: 텍스트→영상→텍스트→이미지→영상) 원래 위치 그대로
 * 해석할 수 있게 하는 게 목적 — 예전엔 본문 전체에서 딱 하나의 링크만
 * (detectFirstLink) 찾아 텍스트 앞이나 뒤에 붙이는 게 전부였다.
 *
 * 🔒 "줄 전체가 URL"이라는 조건을 일부러 좁게 잡았다 — 문장 중간에
 * 자연스럽게 낀 링크("이거 봤어? https://... 재밌더라")까지 임베드로
 * 바꾸면 문장 흐름이 깨진다. Threads·Slack·Notion 등도 대체로 "링크가
 * 그 줄의 전부일 때만" 자동 임베드한다 — 그 관례를 따랐다. 문장 중간에
 * 낀 레거시 링크는 이 함수가 세그먼트를 하나도 못 찾으면(hasMedia=false)
 * BodyContent.tsx가 기존 detectFirstLink+LinkAwareBody 경로로 그대로
 * 처리한다(하위호환, §"링크 순서 보존" 라운드의 동작 그대로 유지).
 */
export type BodyMediaSegment = { type: 'text'; value: string } | { type: 'image'; url: string } | { type: 'link'; link: DetectedLink };

function isStandaloneLinkLine(line: string): DetectedLink | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const link = detectFirstLink(trimmed);
  return link && link.url === trimmed ? link : null;
}

/** parseBodySegments가 최소 하나의 image/link 세그먼트를 만들지 판정 — 호출부가 새 다중 미디어 렌더링과 레거시 단일 링크 폴백 중 뭘 쓸지 고르는 데 쓴다. */
export function hasStandaloneMediaLine(body: string): boolean {
  if (hasImageMarkers(body)) return true;
  return body.split('\n').some((line) => isStandaloneLinkLine(line) !== null);
}

/** 본문을 텍스트/이미지/링크 조각으로 순서대로 쪼갠다 — parseBodyWithImageMarkers를
 * 확장해 "줄 전체가 URL인" 줄도 image 마커와 동일하게 독립 세그먼트로 취급한다. */
export function parseBodySegments(body: string): BodyMediaSegment[] {
  const withImages = hasImageMarkers(body) ? parseBodyWithImageMarkers(body) : [{ type: 'text' as const, value: body }];

  const segments: BodyMediaSegment[] = [];
  for (const seg of withImages) {
    if (seg.type === 'image') {
      segments.push(seg);
      continue;
    }
    const lines = seg.value.split('\n');
    let buffer: string[] = [];
    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text) segments.push({ type: 'text', value: text });
      buffer = [];
    };
    for (const line of lines) {
      const link = isStandaloneLinkLine(line);
      if (link) {
        flush();
        segments.push({ type: 'link', link });
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
  return segments;
}
