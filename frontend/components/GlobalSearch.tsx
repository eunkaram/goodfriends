'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchPostHit, SearchResults } from '../lib/search.ts';
import { HighlightText } from './HighlightText.tsx';
import styles from './GlobalSearch.module.css';

const MIN_QUERY_LENGTH = 2;
const DROPDOWN_LIMIT = 4;

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.1" />
      <path d="M19 19l-3.8-3.8" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function postHref(post: Pick<SearchPostHit, 'categorySlug' | 'publicId'>): string {
  return post.categorySlug ? `/${post.categorySlug}/${post.publicId}` : `/post/${post.publicId}`;
}

function hasAnyResult(results: SearchResults): boolean {
  return results.posts.items.length > 0;
}

/**
 * 우측 사이드바 전체검색 — 300ms 디바운스로 `/api/search`를 호출해
 * 제목/본문을 합친 상위 결과를 한 드롭다운에 보여준다.
 * Enter(폼 제출)는 `/search` 전체 결과 페이지로 이동한다.
 */
export function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setOpen(false);
      setLoading(false);
      setError(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=${DROPDOWN_LIMIT}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('SEARCH_FAILED');
        const data = (await res.json()) as SearchResults;
        if (controller.signal.aborted) return;
        setResults(data);
        setOpen(true);
      } catch {
        if (controller.signal.aborted) return;
        setResults(null);
        setError(true);
        setOpen(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  const showPanel = open && trimmed.length >= MIN_QUERY_LENGTH;

  return (
    <div className={styles.wrap} ref={rootRef}>
      <form className={styles.form} action="/search" role="search" onSubmit={onSubmit}>
        <SearchIcon />
        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          name="q"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (trimmed.length >= MIN_QUERY_LENGTH && (results || error)) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder="전체검색"
          title="제목·본문에서 두 글자 이상 검색"
          aria-label="전체검색"
          autoComplete="off"
        />
        {trimmed && (
          <button
            type="button"
            className={styles.clear}
            aria-label="검색어 지우기"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <ClearIcon />
          </button>
        )}
        {loading && <span className={styles.spinner} aria-label="검색 중" />}
      </form>

      {showPanel && (
        <div className={styles.panel} role="region" aria-label="검색 결과">
          {error ? (
            <p className={styles.empty}>검색 중 문제가 발생했어요.</p>
          ) : !results ? (
            <p className={styles.empty}>검색 중…</p>
          ) : !hasAnyResult(results) ? (
            <p className={styles.empty}>일치하는 결과가 없어요.</p>
          ) : (
            <section>
              {results.posts.items.map((post) => (
                <a key={post.id} className={styles.item} href={postHref(post)} onClick={() => setOpen(false)}>
                  <span className={styles.itemTitle}>
                    <HighlightText text={post.title} query={trimmed} />
                  </span>
                  {post.snippet && (
                    <span className={styles.itemSnippet}>
                      <HighlightText text={post.snippet} query={trimmed} />
                    </span>
                  )}
                </a>
              ))}
            </section>
          )}

          <a className={styles.allResults} href={`/search?q=${encodeURIComponent(trimmed)}`} onClick={() => setOpen(false)}>
            전체 결과 보기
          </a>
        </div>
      )}
    </div>
  );
}
