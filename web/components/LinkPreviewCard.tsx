'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkPreview } from '../lib/link-preview.ts';
import { youtubeThumbnailUrl } from '../lib/link-detect.ts';
import { readCachedVideoThumbnail, writeCachedVideoThumbnail } from './video-thumbnail-cache.ts';
import { HlsVideo } from './HlsVideo.tsx';
import styles from './LinkPreviewCard.module.css';

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/**
 * Threads류 "링크를 넣으면 자동으로 임베드"(사용자 지시, 2026-08). 유튜브는
 * video ID만 있으면 되므로 API 호출 없이 바로 iframe으로 재생 가능한 임베드를
 * 그린다 — 일반 링크는 OG 메타데이터를 서버가 대신 가져와야 해서(CORS)
 * `/api/link-preview`를 호출한다. 글쓰기 모달의 실시간 미리보기와 피드/상세의
 * 저장된 글 렌더링이 이 컴포넌트를 그대로 공유한다.
 *
 * 🔒 사용자 발견 — "외부에서 긁어온 내용을 붙여 넣으니 외부 이미지는 로딩이
 * 안돼". 원인은 link-preview.ts가 content-type이 text/html이 아니면
 * 무조건 거부해서, 이미지 URL을 그대로 붙여넣으면 조용히 실패하고
 * 아무것도 안 그려졌던 것 — 이미지는 애초에 OG 카드(제목/설명 텍스트)가
 * 아니라 원본 그대로 보여줘야 한다. `isDirectImage`(확장자로 클라이언트가
 * 바로 판별 — YouTube와 같은 패턴, API 호출 자체가 필요 없다)와
 * `preview.isImage`(확장자 없는 CDN URL을 서버가 content-type으로
 * 판별)를 둘 다 `<img>`로 그린다. `<img>`는 `fetch`와 달리 CORS 없이도
 * 그냥 화면에 나오므로 이 경로는 우리 서버를 안 거친다(SSRF 표면도 그만큼 준다).
 */
export function LinkPreviewCard({
  url,
  youtubeVideoId,
  isYoutubeShorts,
  isDirectImage,
  isDirectVideo,
  isHlsVideo,
  compact,
  fullWidth,
  onRenderResult,
}: {
  url: string;
  youtubeVideoId: string | null;
  /** 🔒 실전 발견(2026-08, 사용자 리포트 — "쇼츠를 입력했는데도 가로로 출력") —
   * 유튜브 oEmbed가 Shorts에도 일반 영상과 같은 기본값(200x113, 16:9)을
   * 그대로 돌려줘서(실측 확인) API 응답만으로는 세로 여부를 알 수 없다.
   * `/shorts/` URL이면 이 값이 true — 항상 9:16로 강제한다. */
  isYoutubeShorts?: boolean;
  isDirectImage: boolean;
  isDirectVideo?: boolean;
  /** 🔒 사용자 지시(2026-08, "m3u8같이 스트리밍 형태의 url을 입력하면...
   * 최소한으로 작업해줘") — HLS 매니페스트. compact는 isDirectVideo와
   * 같은 취급(썸네일 추출 시도), non-compact는 `HlsVideo`(hls.js를
   * 조건부 지연 로드)로 재생한다. */
  isHlsVideo?: boolean;
  /** 🔒 사용자 지시(2026-08, "유튜브또는 동영상의 경우 리스트에서는 썸네일또는
   * 미리보기 이미지로 보여주게 해줘") — 피드 목록(PostCard)에서만 켠다.
   * 유튜브/직접 영상 URL을 실제 iframe·<video>(재생 가능한 플레이어) 대신
   * 가벼운 썸네일/플레이스홀더로 바꾼다 — 목록 카드가 재생 플레이어로
   * 무거워지는 걸 막는다. 상세 페이지는 이 prop을 안 넘겨 기존처럼 실제
   * 재생 가능한 임베드를 그대로 유지한다. isDirectImage·OG 카드는 이미
   * 가벼운 정적 이미지/카드라 compact 여부와 무관하게 그대로. */
  compact?: boolean;
  /** 🔒 사용자 지시(2026-08, "글 보기 페이지에서는 영상/이미지등은 원사이즈또는
   * 100%로 보여주게 해줘") — 포스트 상세 페이지에서만 켠다. 유튜브/직접
   * 이미지/직접 영상의 max-width:420px 상한(후속 20·21)을 해제해 컨테이너
   * 폭 그대로(100%) 보여준다. OG 카드(`.card`, 제목+설명+썸네일)는 대상이
   * 아니다 — 애초에 420px 상한을 건 이유가 "카드가 넓어질수록 오히려
   * 어색해진다"는 지적이었고 그건 상세 페이지에서도 마찬가지다. */
  fullWidth?: boolean;
  /** 🔒 사용자 지시(2026-08, "이미지/영상처럼 페이지에서 노출되면 링크는
   * 안보여주면 좋겠어. 대신 노출이 안되는경우는 링크가 보여야해") — 이
   * 컴포넌트가 실제로 뭔가(썸네일·카드·재생 가능한 임베드)를 그렸는지
   * 아래 렌더 분기와 정확히 같은 논리로 판정해 부모(LinkAwareBody)에게
   * 알린다. 부모는 이 값으로 본문 텍스트에서 링크 원문을 숨길지 결정한다. */
  onRenderResult?: (rendered: boolean) => void;
}) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(undefined); // undefined=로딩중, null=미리보기 없음
  const [failed, setFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [hlsFailed, setHlsFailed] = useState(false);
  const [youtubeAspectRatio, setYoutubeAspectRatio] = useState<string | null>(null);
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);
  const [videoThumbnailAspectRatio, setVideoThumbnailAspectRatio] = useState<string | null>(null);
  const [videoThumbnailIsPortrait, setVideoThumbnailIsPortrait] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const extractVideoRef = useRef<HTMLVideoElement>(null);

  // 🔒 사용자 지시(2026-08, "비디오 링크를 넣으면 자동으로 잘 불러와 지는데.
  // 가로/세로 규격을 찾아서 자동으로 임베드 시켜줘") — 지금까지 .youtubeWrap은
  // 항상 고정 16:9였다(세로 영상·Shorts를 넣으면 실제 비율과 안 맞았다).
  // 🔒 후속 실전 발견(사용자 리포트 — "쇼츠를 입력했는데도 가로로 출력") —
  // 유튜브 oEmbed로 Shorts 실제 비율을 받아오려 했지만, 실측해보니 oEmbed가
  // Shorts에도 일반 영상과 같은 기본 임베드 크기(200x113=16:9)를 그대로
  // 돌려준다 — API 응답만으로는 세로 여부를 알 방법이 없다. `isYoutubeShorts`
  // (URL이 `/shorts/`인지, Shorts는 정의상 항상 세로)를 오히려 더 신뢰할 수
  // 있는 신호로 써서 즉시 9:16으로 고정한다(네트워크 호출 자체가 필요 없다).
  // Shorts가 아닌 일반 링크만 oEmbed로 실제 비율을 조회한다(4:3 등 드문
  // 예외를 오히려 잘 반영해준다 — 문제는 Shorts 케이스뿐이었다).
  useEffect(() => {
    if (!youtubeVideoId) {
      setYoutubeAspectRatio(null);
      return;
    }
    if (isYoutubeShorts) {
      setYoutubeAspectRatio('9 / 16');
      return;
    }
    let cancelled = false;
    fetch(`/api/youtube-size?videoId=${encodeURIComponent(youtubeVideoId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { size: { width: number; height: number } | null } | null) => {
        if (cancelled || !data?.size) return;
        setYoutubeAspectRatio(`${data.size.width} / ${data.size.height}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [youtubeVideoId, isYoutubeShorts]);

  // 🔒 사용자 발견(2026-08) — "mp4가 실행이 안돼" 재현 중 발견: CDN이 hotlink를
  // 막아 요청이 403으로 실패해도 <video>의 `error` 이벤트가 항상 발생하는 건
  // 아니었다(`.error` 프로퍼티는 채워지는데 이벤트가 안 붙는 경우를 실측함) —
  // onError 하나만 믿으면 감지를 놓친다. 일정 시간 안에 메타데이터조차 못
  // 받으면(readyState가 여전히 HAVE_NOTHING) 이벤트 유무와 무관하게 실패로
  // 간주하는 타임아웃을 안전망으로 둔다.
  useEffect(() => {
    if (!isDirectVideo) return;
    setVideoFailed(false);
    const timer = window.setTimeout(() => {
      if (videoRef.current && videoRef.current.readyState === 0) setVideoFailed(true);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [isDirectVideo, url]);

  // 🔒 사용자 지시(2026-08, "m3u8... 최소한으로") — HlsVideo가 자체적으로
  // hls.js의 ERROR 이벤트·네이티브 <video>의 onError를 처리해 실패를
  // 알려온다. url이 바뀌면(같은 컴포넌트 인스턴스가 다른 링크로 재사용될
  // 때) 이전 실패 상태가 새 링크에 남지 않도록 리셋한다.
  useEffect(() => {
    if (!isHlsVideo) return;
    setHlsFailed(false);
  }, [isHlsVideo, url]);

  const handleHlsError = useCallback(() => setHlsFailed(true), []);

  // 🔒 사용자 지시(2026-08, "유튜브처럼 섬네일을 제공하지 않는 mp4와 같은
  // 영상일 경우, 브라우저에서 자동으로 비디오에서 섬네일 추출해서 보여주도록
  // 해줘. HTML5 Video Element와 Canvas API를 조합하여 첫 프레임을 이미지로
  // 추출") — 지금까지 compact(목록) 모드의 직접 영상은 서버 프레임 추출
  // 파이프라인이 없어(§17.3) 정적 회색 플레이스홀더뿐이었다. 서버를 안
  // 거치고 브라우저에서 직접 뽑는다 — 숨겨둔 <video>(preload="metadata")를
  // 아주 살짝(0.1초) seek해 첫 프레임을 강제로 디코딩시킨 뒤 canvas에
  // 그려 data URL로 저장한다. 이 video는 실제 재생용(non-compact의
  // videoRef)과 별개다 — 캡처 전용이라 controls도 없다.
  // 🔒 CORS 한계(link-preview.ts SSRF 방어와 같은 "실용적 수준" 태도) —
  // canvas로 픽셀을 읽으려면(`toDataURL`) crossOrigin="anonymous"가
  // 필수인데, 이건 그 영상 서버가 CORS 헤더를 실제로 보내야만 로드가
  // 성공한다. 대부분의 임의 영상 CDN은 CORS를 안 켜뒀을 가능성이 높다
  // — 이 경우 로드/캡처가 조용히 실패하고 기존 정적 플레이스홀더로
  // 그대로 폴백한다(에러를 사용자에게 보여주지 않음, 순수 향상 시도).
  // 🔒 사용자 발견(2026-08, "이미지가 계속 없어져") — 위 CORS 한계 탓에
  // 추출이 매번 성공한다는 보장이 없어서, 새로고침마다 처음부터 다시
  // 시도하다 보니 어쩌다 실패하는 순간 이전까지 보이던 썸네일이 사라져
  // 보였다. 마운트 시 먼저 `video-thumbnail-cache.ts`(localStorage)를
  // 확인해 이전에 성공한 결과가 있으면 재추출 없이 그대로 쓴다 — 실패한
  // 새로고침이 와도 예전 성공 결과가 그대로 남는다.
  // 🔒 사용자 지시(2026-08, "m3u8... 최소한으로") — compact(목록) 모드는
  // HLS도 isDirectVideo와 똑같이 취급한다: 숨긴 <video src={m3u8}>가
  // Safari/iOS에선 네이티브로 로드돼 프레임 추출이 그대로 성공하고,
  // hls.js가 없는 다른 브라우저에선 로드 자체가 조용히 실패해 기존
  // CORS-실패 폴백 경로(정적 플레이스홀더)를 그대로 탄다 — 새 분기
  // 없이 기존 그레이스풀 디그레이드 로직을 그대로 재사용한다.
  useEffect(() => {
    if (!(isDirectVideo || isHlsVideo) || !compact) return;
    setVideoThumbnail(null);
    setVideoThumbnailAspectRatio(null);
    setVideoThumbnailIsPortrait(false);

    const cached = readCachedVideoThumbnail(url);
    if (cached) {
      setVideoThumbnail(cached.dataUrl);
      setVideoThumbnailAspectRatio(`${cached.width} / ${cached.height}`);
      setVideoThumbnailIsPortrait(cached.height > cached.width);
      return; // 캐시 적중 — 재추출 불필요
    }

    const el = extractVideoRef.current;
    if (!el) return;
    let cancelled = false;

    function capture() {
      if (cancelled || !el) return;
      try {
        const w = el.videoWidth;
        const h = el.videoHeight;
        if (!w || !h) return;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(el, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // CORS 미허용이면 여기서 SecurityError
        if (cancelled) return;
        setVideoThumbnail(dataUrl);
        setVideoThumbnailAspectRatio(`${w} / ${h}`);
        setVideoThumbnailIsPortrait(h > w);
        writeCachedVideoThumbnail(url, { dataUrl, width: w, height: h });
      } catch {
        // 조용히 무시 — 기존 정적 플레이스홀더가 그대로 남는다.
      }
    }

    function onLoadedMetadata() {
      if (cancelled || !el) return;
      try {
        el.currentTime = Math.min(0.1, (el.duration || 1) / 2); // 아주 짧은 영상도 안전하게
      } catch {
        // currentTime 설정 자체가 막히는 브라우저 — seeked 이벤트 없이 바로 시도
        capture();
      }
    }
    function onSeeked() {
      capture();
    }
    function onError() {
      // CORS·hotlink 차단 등으로 로드 실패 — 조용히 기존 플레이스홀더 유지(videoFailed와 별개 상태)
    }

    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('error', onError);
    return () => {
      cancelled = true;
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('error', onError);
    };
  }, [isDirectVideo, isHlsVideo, compact, url]);

  useEffect(() => {
    if (youtubeVideoId || isDirectImage || isDirectVideo || isHlsVideo) return; // 넷 다 서버 왕복 자체가 필요 없다
    setPreview(undefined);
    setFailed(false);
    let cancelled = false;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { preview: LinkPreview | null }) => {
        if (!cancelled) setPreview(data.preview);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, youtubeVideoId, isDirectImage, isDirectVideo, isHlsVideo]);

  // 🔒 사용자 지시(2026-08, "이미지/영상처럼 노출되면 링크는 안보여주고,
  // 노출이 안되는경우는 링크가 보여야해") — 아래 각 렌더 분기가 null을
  // 반환하는 조건과 정확히 같은 논리를 여기 한 곳에 모아 부모에게 알린다
  // (분기를 고치면 이 판정도 같이 고칠 것). 유튜브·compact 직접영상은
  // 현재 실패를 추적하지 않아(플레이스홀더가 항상 뜬다) 항상 true —
  // OG 카드의 `preview === undefined`(로딩 중, 스켈레톤 박스가 이미
  // 떠 있음)도 낙관적으로 true로 본다.
  useEffect(() => {
    if (!onRenderResult) return;
    let rendered: boolean;
    if (youtubeVideoId) rendered = true;
    else if (isDirectImage) rendered = !imgFailed;
    else if (isDirectVideo) rendered = compact ? true : !videoFailed;
    else if (isHlsVideo) rendered = compact ? true : !hlsFailed;
    else rendered = !(failed || preview === null);
    onRenderResult(rendered);
  }, [onRenderResult, youtubeVideoId, isDirectImage, isDirectVideo, isHlsVideo, compact, imgFailed, videoFailed, hlsFailed, failed, preview]);

  // 🔒 사용자 지시(2026-08, "모든 글 리스트에도 똑같이 적용해줘") — 원본
  // 크기 존중(작으면 원본, 크면 100%로만 축소) 처리를 포스트 상세
  // (fullWidth)뿐 아니라 리스트(compact — PostCard·ProfileTabs 답글
  // 목록이 공유)에도 그대로 적용한다. 컴포저 실시간 미리보기(둘 다
  // false)만 기존 max-width:420px 기본값을 유지 — "리스트"가 아니라서
  // 이번 요청 대상이 아니다.
  const directImageClassName = compact || fullWidth ? `${styles.directImage} ${styles.fullWidth}` : styles.directImage;
  const directVideoClassName = fullWidth ? `${styles.directVideo} ${styles.fullWidth}` : styles.directVideo;
  // 🔒 사용자 지시(2026-08, "리스트에서 세로 섬네일이미지가 너무 큰것 같아.
  // 가로 이미지를 pivot 했을때 사이즈로 재조정해줘") — compact 모드에서
  // 세로 콘텐츠(Shorts·세로 영상)가 가로 콘텐츠와 같은 width:100%(최대
  // 420px) 규칙을 그대로 따르면 9:16 비율에서 높이가 746px까지 치솟는다
  // (가로 썸네일 높이 236px의 3배 이상) — .compactPortrait가 가로 썸네일
  // 박스(420×236, 16:9 at max-width 420)를 그대로 90도 돌린 크기로
  // 대신 맞춘다(height:420 고정 + width:auto, aspect-ratio가 폭을
  // 236px 근처로 계산하게 둔다).
  const youtubeWrapClassName = [styles.youtubeWrap, fullWidth && styles.fullWidth, compact && isYoutubeShorts && styles.compactPortrait]
    .filter(Boolean)
    .join(' ');
  const videoPlaceholderClassName = [
    styles.videoPlaceholder,
    fullWidth && styles.fullWidth,
    compact && videoThumbnailIsPortrait && styles.compactPortrait,
  ]
    .filter(Boolean)
    .join(' ');

  if (youtubeVideoId) {
    // 🔒 세로(Shorts) 영상은 non-compact(실제 iframe 재생)일 때 폭 상한도
    // 같이 좁힌다 — 안 그러면 9:16 비율이 컨테이너 폭(fullWidth면 680px)
    // 그대로 늘어나 세로로 1200px 넘게 치솟는다. compact(카드 썸네일)는
    // youtubeWrapClassName의 .compactPortrait가 대신 처리한다(위 참고) —
    // PostCard의 .previewCap은 isDirectImage/이미지 마커만 감지해서 유튜브·
    // 직접영상 미리보기는 애초에 그 캡 대상이 아니다(실전 확인, 사용자 리포트
    // "리스트에서 세로 섬네일이미지가 너무 큰것 같아").
    const youtubeWrapStyle = youtubeAspectRatio
      ? isYoutubeShorts && !compact
        ? { aspectRatio: youtubeAspectRatio, maxWidth: 380 }
        : { aspectRatio: youtubeAspectRatio }
      : undefined;
    if (compact) {
      return (
        <div className={youtubeWrapClassName} style={youtubeWrapStyle}>
          {/* 🔒 /qa 발견 — 삭제·비공개된 영상은 hqdefault.jpg가 404라 onError
              없이는 깨진 이미지 아이콘이 그대로 보였다. isDirectImage와 같은
              imgFailed로 숨기면 배경(--chip-bg)+재생 아이콘만 남아 위 주석의
              "플레이스홀더가 항상 뜬다"는 전제를 실제로 지킨다. */}
          {!imgFailed && (
            <img
              src={youtubeThumbnailUrl(youtubeVideoId)}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className={styles.thumbImage}
              onError={() => setImgFailed(true)}
            />
          )}
          <span className={styles.playIconOverlay} aria-hidden="true">
            <PlayIcon />
          </span>
        </div>
      );
    }
    return (
      <div className={youtubeWrapClassName} style={youtubeWrapStyle}>
        <iframe
          src={`https://www.youtube.com/embed/${youtubeVideoId}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className={styles.youtubeFrame}
        />
      </div>
    );
  }

  if (isDirectImage) {
    if (imgFailed) return null; // 깨진 링크면 조용히 아무것도 안 그린다(OG 카드 실패와 같은 원칙)
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={directImageClassName}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // 🔒 사용자 지시(2026-08) — "미디어나 이미지를 넣을 경우 태그로 전환해서
  // 페이지에서 바로 볼수 있도록". isDirectImage와 같은 패턴 — 확장자로
  // 클라이언트가 바로 판별해 서버 왕복 없이 <video>로 그린다.
  // 🔒 사용자 발견(2026-08) — "mp4가 실행이 안돼. 플레이어 크기가 가로로
  // 길쭉해" — 원인은 CDN이 hotlink를 403으로 막는 경우(예: video.twimg.com,
  // 트위터 CDN은 자기 도메인 밖에서의 직접 재생을 차단한다)였다. 소스가
  // 로드에 실패하면 <video>가 메타데이터를 못 얻어 브라우저 기본 크기
  // (300×150, 2:1)로 주저앉는데, 그걸 width:100%로 늘리면 가로로 아주
  // 얇고 긴 상자가 된다 — isDirectImage의 onError 처리와 같은 원칙으로
  // 실패 시 조용히 아무것도 안 그린다(정상 로드되는 링크는 height:auto가
  // 실제 영상 비율을 그대로 따라가므로 이 문제가 없다). onError만으로는
  // 부족했다 — 실측해보니 403 응답에도 `error` 이벤트가 안 붙는 경우가
  // 있어(위 useEffect의 타임아웃 안전망 참고), 이벤트와 타임아웃 둘 다로
  // 감지한다.
  if (isDirectVideo || isHlsVideo) {
    // 🔒 후속(2026-08, "브라우저에서 자동으로 비디오에서 섬네일 추출해서
    // 보여주도록") — compact 모드는 여전히 재생용 <video>(controls 포함)는
    // 마운트하지 않는다(가벼움 유지) — 대신 캡처 전용 숨김 <video>로 첫
    // 프레임만 뽑아 <img>로 보여준다. 추출 성공 전이거나 실패하면(CORS
    // 미지원 등) 기존 정적 플레이스홀더 그대로. 🔒 사용자 지시(2026-08,
    // "m3u8... 최소한으로") — HLS도 이 자리를 그대로 공유한다(위 추출
    // useEffect 주석 참고, Safari는 추출 성공·나머지는 그레이스풀 폴백).
    if (compact) {
      const placeholderStyle = videoThumbnailAspectRatio ? { aspectRatio: videoThumbnailAspectRatio } : undefined;
      return (
        <div className={videoPlaceholderClassName} style={placeholderStyle}>
          {videoThumbnail && <img src={videoThumbnail} alt="" className={styles.thumbImage} />}
          <span className={styles.playIconOverlay} aria-hidden="true">
            <PlayIcon />
          </span>
          <video
            ref={extractVideoRef}
            src={url}
            crossOrigin="anonymous"
            preload="metadata"
            muted
            playsInline
            aria-hidden="true"
            className={styles.extractVideo}
          />
        </div>
      );
    }
    // 🔒 사용자 지시(2026-08, "m3u8같이 스트리밍 형태의 url을 입력하면...
    // 최소한으로 작업해줘") — HLS는 재생 메커니즘 자체가 달라서(진행형
    // 다운로드가 아니라 세그먼트 목록) `HlsVideo`가 Safari 네이티브 지원
    // 여부에 따라 hls.js를 조건부로 붙인다(components/HlsVideo.tsx 참고).
    if (isHlsVideo) {
      if (hlsFailed) return null;
      return <HlsVideo url={url} className={directVideoClassName} onError={handleHlsError} />;
    }
    if (videoFailed) return null;
    return <video ref={videoRef} src={url} controls preload="metadata" className={directVideoClassName} onError={() => setVideoFailed(true)} />;
  }

  if (failed || preview === null) return null; // 실패했거나 미리보기 정보가 없으면 조용히 아무것도 안 그린다
  if (preview === undefined) return <div className={styles.loading} aria-hidden="true" />;

  if (preview.isImage) {
    return <img src={preview.image ?? url} alt="" loading="lazy" referrerPolicy="no-referrer" className={directImageClassName} />;
  }

  return (
    <a className={styles.card} href={preview.url} target="_blank" rel="noopener noreferrer nofollow">
      {preview.image && <span className={styles.image} style={{ backgroundImage: `url(${preview.image})` }} aria-hidden="true" />}
      <span className={styles.info}>
        {preview.siteName && <span className={styles.siteName}>{preview.siteName}</span>}
        {preview.title && <span className={styles.linkTitle}>{preview.title}</span>}
        {preview.description && <span className={styles.description}>{preview.description}</span>}
      </span>
    </a>
  );
}
