'use client';

import { useEffect, useState } from 'react';
import { t } from '../lib/i18n/ko.ts';
import styles from '../app/admin/admin.module.css';

type PostRow = {
  id: string;
  publicId: string;
  title: string;
  bodyExcerpt: string;
  authorUsername: string;
  isCommunity: boolean;
  categoryId: string | null;
  categoryNameKey: string | null;
  categorySlug: string | null;
  createdAt: string;
};

type CategoryOption = { id: string; name: string };

const PAGE_SIZE = 20;

/** PostCard.tsx의 href 로직과 동일 — 커뮤니티 글은 카테고리 슬러그, 로그 글은 `/post/{publicId}`(모더레이터는 항상 로그인 상태라 불변식 10의 로그인 게이트에 안 걸린다). */
function postHref(p: PostRow): string {
  return p.categorySlug ? `/${p.categorySlug}/${p.publicId}` : `/post/${p.publicId}`;
}

/**
 * 글 검색+삭제(사용자 지시, 2026-08-18 — "유저 관리처럼 신고 여부와 무관하게
 * 검색해서 삭제"). AdminUserSearch.tsx와 같은 패턴 — /api/admin/posts만
 * 호출한다. 범위는 사용자가 확정: **전체공개 글만**(비공개/친구공개/팔로워공개
 * 로그는 여기 안 뜬다 — 그건 여전히 /admin/reports를 통해서만).
 */
/** authorId를 주면 그 유저가 쓴 전체공개 글만 보여준다(사용자 지시, 2026-09-08 — "유저로 글을 트래킹") — /admin/users/[id] 상세 화면 전용. */
export function AdminPostSearch({ authorId }: { authorId?: string } = {}) {
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data: { categories?: CategoryOption[] }) => setCategories(data.categories ?? []));
  }, []);

  async function runSearch(nextOffset: number, append: boolean) {
    setError(null);
    const authorParam = authorId ? `&authorId=${authorId}` : '';
    const res = await fetch(`/api/admin/posts?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${nextOffset}${authorParam}`);
    const data = (await res.json()) as { posts?: PostRow[] };
    const rows = data.posts ?? [];
    setPosts((prev) => (append ? [...prev, ...rows] : rows));
    setOffset(nextOffset);
    setHasMore(rows.length === PAGE_SIZE);
  }

  useEffect(() => {
    runSearch(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deletePost(id: string) {
    if (!confirm('이 글을 삭제할까요?')) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/posts/${id}/delete`, { method: 'POST' });
    setBusyId(null);
    if (!res.ok) {
      setError('삭제에 실패했어요.');
      return;
    }
    await runSearch(0, false);
  }

  async function changeCategory(id: string, categoryId: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/posts/${id}/category`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError('카테고리 변경에 실패했어요.');
      return;
    }
    await runSearch(0, false);
  }

  return (
    <div>
      <form
        className={styles.searchRow}
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(0, false);
        }}
      >
        <input
          type="text"
          placeholder={authorId ? '제목/본문으로 검색 (비워두면 이 유저의 전체공개 글 전체)' : '제목/본문으로 검색 (비워두면 전체공개 글 전체)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="글 검색"
        />
        <button type="submit">검색</button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list} style={{ marginTop: 'var(--space-lg)' }}>
        {posts.length === 0 && <p className={styles.empty}>글이 없어요.</p>}
        {posts.map((p) => (
          <div key={p.id} className={styles.row}>
            <div className={styles.rowMain}>
              <a className={styles.username} href={postHref(p)} target="_blank" rel="noopener noreferrer">
                {p.title || '(제목 없음)'} ↗
              </a>
              {p.bodyExcerpt && <span className={styles.fieldValue}>{p.bodyExcerpt}</span>}
              <span className={styles.meta}>
                {p.authorUsername} · {p.isCommunity && p.categoryNameKey ? t(p.categoryNameKey) : '로그'} ·{' '}
                {new Date(p.createdAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <div className={styles.actions}>
              {p.isCommunity && (
                <select
                  aria-label="카테고리 이동"
                  value={p.categoryId ?? ''}
                  onChange={(e) => changeCategory(p.id, e.target.value)}
                  disabled={busyId !== null}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className={styles.banBtn} onClick={() => deletePost(p.id)} disabled={busyId !== null}>
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button type="button" className={styles.cancelBtn} onClick={() => runSearch(offset + PAGE_SIZE, true)} disabled={busyId !== null}>
          더 보기
        </button>
      )}
    </div>
  );
}
