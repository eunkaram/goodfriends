import { splitTextLinks } from '../lib/link-detect.ts';

/** #16 — 카드 프리뷰뿐 아니라 문장 중간에 낀 URL도 새 탭 링크로 렌더링한다. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitTextLinks(text).map((part, i) =>
        part.type === 'url' ? (
          <a key={i} href={part.value} target="_blank" rel="noopener noreferrer nofollow">
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </>
  );
}
