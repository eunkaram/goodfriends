'use client';

import { useEffect, useState } from 'react';
import styles from '../app/admin/admin.module.css';

type CommentRow = {
  id: string;
  bodyExcerpt: string;
  authorUsername: string;
  postId: string;
  postPublicId: string;
  postTitle: string;
  postCategorySlug: string | null;
  createdAt: string;
};

const PAGE_SIZE = 20;

/** AdminPostSearch.tsx의 postHref()와 같은 로직 + PostCard.tsx의 `#comments` 앵커 관례. */
function commentHref(c: CommentRow): string {
  const postHref = c.postCategorySlug ? `/${c.postCategorySlug}/${c.postPublicId}` : `/post/${c.postPublicId}`;
  return `${postHref}#comments`;
}

/**
 * AdminPostSearch.tsx와 같은 패턴 — /api/admin/comments만 호출한다. 전체공개
 * 글에 달린 댓글만(§ 파일 상단 이유는 comments.ts 참고). authorId를 주면
 * 그 유저가 쓴 댓글만(사용자 지시, 2026-09-08 — "유저로 댓글을 트래킹") —
 * /admin/users/[id] 상세 화면 전용.
 */
export function AdminCommentSearch({ authorId }: { authorId?: string } = {}) {
  const [query, setQuery] = useState('');
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runSearch(nextOffset: number, append: boolean) {
    setError(null);
    const authorParam = authorId ? `&authorId=${authorId}` : '';
    const res = await fetch(`/api/admin/comments?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${nextOffset}${authorParam}`);
    const data = (await res.json()) as { comments?: CommentRow[] };
    const rows = data.comments ?? [];
    setComments((prev) => (append ? [...prev, ...rows] : rows));
    setOffset(nextOffset);
    setHasMore(rows.length === PAGE_SIZE);
  }

  useEffect(() => {
    runSearch(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteComment(id: string) {
    if (!confirm('이 댓글을 삭제할까요?')) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/comments/${id}/delete`, { method: 'POST' });
    setBusyId(null);
    if (!res.ok) {
      setError('삭제에 실패했어요.');
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
          placeholder={authorId ? '내용으로 검색 (비워두면 이 유저의 댓글 전체)' : '내용으로 검색 (비워두면 전체공개 글의 댓글 전체)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="댓글 검색"
        />
        <button type="submit">검색</button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list} style={{ marginTop: 'var(--space-lg)' }}>
        {comments.length === 0 && <p className={styles.empty}>댓글이 없어요.</p>}
        {comments.map((c) => (
          <div key={c.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.fieldValue}>{c.bodyExcerpt}</span>
              <span className={styles.meta}>
                {c.authorUsername} ·{' '}
                <a href={commentHref(c)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  "{c.postTitle || '(제목 없음)'}"에 남긴 댓글 ↗
                </a>{' '}
                · {new Date(c.createdAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.banBtn} onClick={() => deleteComment(c.id)} disabled={busyId !== null}>
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
