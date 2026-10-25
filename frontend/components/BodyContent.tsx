import { detectFirstLink, parseBodySegments } from '../lib/link-detect.ts';
import { LinkAwareBody } from './LinkAwareBody.tsx';
import { LinkifiedText } from './LinkifiedText.tsx';
import styles from './BodyContent.module.css';

/**
 * 본문에 섞인 텍스트/이미지/링크를 순서대로 렌더링한다(사용자 지시, 2026-08 -
 * "긁어온 내용이 그대로 붙여져서 저장되어야해. 이미지 링크와 이미지명도
 * 보이면 안돼", 그리고 후속 — "글, 영상, 글, 미디어, 영상 이런식으로
 * 수정했었는데 또 고낭났어. 글쓰기와 글 내용수정 둘다 같은 기능이어야해").
 * 뉴스·갤러리 페이지를 긁어 붙였을 때 이미지가 원래 있던 자리 근처에 그대로
 * 나오고, 마커·URL 문자열 자체는 절대 화면에 텍스트로 안 보인다(paste-html-
 * to-text.ts가 심어둔 제어문자 마커라 실수로 못 지워도 렌더링 없이는
 * 무해하게 사라진다). 유튜브·mp4 등 "줄 전체가 URL인" 줄도 이미지 마커와
 * 똑같이 원래 위치에 그대로 남는다(lib/link-detect.ts의 parseBodySegments) —
 * 텍스트·이미지·영상이 어떤 순서·개수로 섞여도(글→영상→글→미디어→영상)
 * 원문 순서 그대로 렌더링된다.
 *
 * 이미지도 독립 링크 줄도 하나 없는 본문(대부분의 기존 글, 문장 중간에
 * 자연스럽게 낀 링크)은 예전처럼 detectFirstLink+LinkAwareBody로 폴백한다
 * (§"링크 순서 보존" 라운드의 동작 그대로 — 하위호환).
 *
 * `textClassName`을 안 주면 텍스트 조각은 안 그린다(PostComposerModal의
 * 작성 중 미리보기처럼 textarea 자체가 원문을 보여주고 있어 이미지만
 * 추가로 필요한 경우). `maxImages`를 주면 이미지·링크 미리보기를 합쳐 그
 * 개수까지만 그린다(PostCard처럼 레이아웃 안정성이 중요한 카드용).
 */
export function BodyContent({
  body,
  textClassName,
  maxImages,
  compact,
  fullWidth,
}: {
  body: string;
  textClassName?: string;
  maxImages?: number;
  /** §11.7.0 피드 카드 전용 — LinkPreviewCard로 그대로 전달(유튜브/직접 영상을 썸네일로). */
  compact?: boolean;
  /** 🔒 사용자 지시(2026-08, "글 보기 페이지에서는 영상/이미지등은 원사이즈또는
   * 100%로 보여주게 해줘") — 포스트 상세 전용, LinkPreviewCard로 그대로 전달. */
  fullWidth?: boolean;
}) {
  const segments = parseBodySegments(body);
  const hasMedia = segments.some((s) => s.type !== 'text');

  if (!hasMedia) {
    // 이미지 마커도, 줄 전체가 URL인 줄도 없다(있었다면 parseBodySegments가
    // 반드시 image/link 세그먼트를 만들었을 것) — 순수 텍스트이거나 문장
    // 중간에 링크가 낀 레거시 패턴. 기존 단일 링크 감지 그대로.
    const link = detectFirstLink(body);
    if (!link) {
      return textClassName && body ? <p className={textClassName}>{body}</p> : null;
    }
    return <LinkAwareBody body={body} link={link} textClassName={textClassName} compact={compact} fullWidth={fullWidth} />;
  }

  let mediaCount = 0;

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return textClassName ? (
            <p key={i} className={textClassName}>
              <LinkifiedText text={seg.value} />
            </p>
          ) : null;
        }
        mediaCount += 1;
        if (maxImages !== undefined && mediaCount > maxImages) return null;
        if (seg.type === 'image') {
          // 🔒 사용자 발견(2026-08, "외부링크 이미지의 원본 넓이가 660px보다
          // 작은데 100%로 늘려져서 보이네") + 후속 지시("모든 글 리스트에도
          // 똑같이 적용해줘") — fullWidth(포스트 상세)뿐 아니라 compact
          // (PostCard·ProfileTabs 답글 목록 등 리스트 전반)에도 원본 크기를
          // 존중한다(styles.imageFullWidth 참고). 컴포저 실시간 미리보기
          // (둘 다 false)만 기존 width:100% 유지 — 리스트가 아니라서 대상 밖.
          const imageClassName = fullWidth || compact ? `${styles.image} ${styles.imageFullWidth}` : styles.image;
          return <img key={i} src={seg.url} alt="" loading="lazy" referrerPolicy="no-referrer" className={imageClassName} />;
        }
        // seg.type === 'link' — 줄 전체가 URL 하나뿐이라 splitAroundLink의
        // before/after가 항상 비어서 LinkAwareBody가 미리보기만(중복 텍스트
        // 없이) 그린다. 실패 시 폴백으로 그 URL 자체가 텍스트로 보인다.
        return (
          <LinkAwareBody key={i} body={seg.link.url} link={seg.link} textClassName={textClassName} compact={compact} fullWidth={fullWidth} />
        );
      })}
    </>
  );
}
