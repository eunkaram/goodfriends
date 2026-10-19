'use client';

import { useEffect, useRef } from 'react';

/**
 * m3u8(HLS) 스트림 재생 — 사용자 지시(2026-08, "m3u8같이 스트리밍 형태의
 * url을 입력하면... 최소한으로 작업해줘"). Safari/iOS는 `<video src>`
 * 하나로 HLS를 네이티브 재생하지만, 그 외 브라우저는 세그먼트를 직접
 * 디먹싱해서 MediaSource에 흘려넣어줘야 한다 — 그 역할만 `hls.js`에
 * 맡긴다(동적 import로 실제 m3u8을 만났을 때만 로드, 번들에 항상
 * 포함되지 않는다). 재생 UI 자체는 그대로 네이티브 `<video controls>`다
 * — video.js 같은 풀 플레이어 프레임워크는 안 쓰기로 한 결정(2026-08
 * 논의)과 일관되게, hls.js는 순수 디먹싱 shim으로만 쓴다.
 */
export function HlsVideo({ url, className, onError }: { url: string; className: string; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;
    let hls: import('hls.js').default | null = null;

    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS — hls.js 자체를 불러올 필요가 없다.
      el.src = url;
    } else {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            onError();
            return;
          }
          hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) onError();
          });
          hls.loadSource(url);
          hls.attachMedia(el);
        })
        .catch(() => {
          if (!cancelled) onError();
        });
    }

    return () => {
      cancelled = true;
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return <video ref={videoRef} controls preload="metadata" className={className} onError={onError} />;
}
