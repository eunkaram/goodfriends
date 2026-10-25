'use client';

import { useCallback, useState } from 'react';
import { splitAroundLink, type DetectedLink } from '../lib/link-detect.ts';
import { LinkPreviewCard } from './LinkPreviewCard.tsx';
import { LinkifiedText } from './LinkifiedText.tsx';

/**
 * BodyContent의 "본문에 링크가 텍스트로 하나 있는" 경로 전용 — 사용자
 * 지시(2026-08, "글 리스트와 내용보기에서 이미지/영상처럼 페이지에서
 * 노출되면 링크는 안보여주면 좋겠어. 대신 노출이 안되는경우는 링크가
 * 보여야해"). 기본값은 "미리보기가 뜬다"로 낙관적으로 가정해 링크 원문을
 * 처음부터 숨긴다(대부분 실제로 뜨므로 텍스트가 잠깐 보였다 사라지는
 * 깜빡임을 피한다) — LinkPreviewCard가 아무것도 못 그렸다고 알려오면
 * (이미지 로드 실패·영상 로드 실패·OG 메타데이터 없음 등) 그제서야
 * 링크가 포함된 원문 그대로 되돌린다.
 *
 * 🔒 사용자 발견(2026-08, "유튜브, 글 내용순이거든. 근데 글내용과
 * 유튜브가 분리되어서 나와") — 예전엔 앞/뒤 텍스트를 stripFirstLink로
 * 하나로 합쳐 항상 "텍스트 문단 → 미리보기" 순서로만 그렸다. 사용자가
 * 링크를 글 맨 앞에 쓰면(예: "유튜브 링크\n이 영상 재밌어요") 실제로는
 * 영상이 먼저 나와야 하는데 텍스트가 먼저 나오는 식으로 순서가 항상
 * 뒤바뀌었다. splitAroundLink로 앞/뒤를 분리해 원문 위치 그대로
 * "앞 텍스트 → 미리보기 → 뒤 텍스트" 순서로 렌더링한다.
 */
export function LinkAwareBody({
  body,
  link,
  textClassName,
  compact,
  fullWidth,
}: {
  body: string;
  link: DetectedLink;
  textClassName?: string;
  compact?: boolean;
  fullWidth?: boolean;
}) {
  const [exposed, setExposed] = useState(true);
  const handleRenderResult = useCallback((rendered: boolean) => setExposed(rendered), []);
  const { before, after } = exposed ? splitAroundLink(body, link.url) : { before: body, after: '' };

  const preview = (
    <LinkPreviewCard
      url={link.url}
      youtubeVideoId={link.youtubeVideoId}
      isYoutubeShorts={link.isYoutubeShorts}
      isDirectImage={link.isDirectImage}
      isDirectVideo={link.isDirectVideo}
      isHlsVideo={link.isHlsVideo}
      compact={compact}
      fullWidth={fullWidth}
      onRenderResult={handleRenderResult}
    />
  );

  return (
    <>
      {textClassName && before && (
        <p className={textClassName}>
          <LinkifiedText text={before} />
        </p>
      )}
      {preview}
      {exposed && textClassName && after && (
        <p className={textClassName}>
          <LinkifiedText text={after} />
        </p>
      )}
    </>
  );
}
