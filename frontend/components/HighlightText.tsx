import styles from './HighlightText.module.css';

/** 검색어와 일치하는 부분만 <mark>로 감싼다 — 서버/클라이언트 양쪽에서 쓸 수 있다. */
export function HighlightText({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  const lowerNeedle = needle.toLowerCase();

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerNeedle ? (
          <mark key={i} className={styles.mark}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
