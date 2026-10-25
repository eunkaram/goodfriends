'use client';

import { PostCard } from './PostCard.tsx';
import { usePaginatedFeed, FEED_PAGE_SIZE } from './use-paginated-feed.ts';
import type { FeedPost } from '../lib/feed.ts';
import styles from './HomeFeed.module.css';

/**
 * §11.7.7 "저장한 글" `/saved` — Claude Design 확정안(artifact `showSaved`)
 * 신규 화면. HomeFeed/CategoryFeed와 달리 정렬 탭이 없다(저장한 시각 최신순
 * 하나뿐 — "인기순 저장 목록"은 의미가 없다) — `usePaginatedFeed`의 sort는
 * `'latest'` 고정값으로만 쓰고 UI에 탭을 안 그린다.
 */
export function SavedFeed({ currentUserId, initialPosts }: { currentUserId: string; initialPosts: FeedPost[] }) {
  const { posts, removePost, loading, hasMore, loadMore } = usePaginatedFeed<FeedPost, 'latest'>({
    initialPosts,
    initialSort: 'latest',
    buildUrl: (_sort, offset) => `/api/saved-posts?limit=${FEED_PAGE_SIZE}&offset=${offset}`,
  });

  return (
    <div>
      <h1 className={styles.pageTitle}>저장한 글</h1>

      {posts.length === 0 && !loading ? (
        <p className={styles.empty}>아직 저장한 글이 없어요.</p>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            isLoggedIn={true}
            showCategoryBadge
            savedMode
            onUnsaved={() => removePost((p) => p.id === post.id)}
            currentUserId={currentUserId}
            onDeleted={() => removePost((p) => p.id === post.id)}
          />
        ))
      )}

      {hasMore && posts.length > 0 && (
        <button type="button" className={styles.loadMore} onClick={loadMore} disabled={loading}>
          {loading ? '불러오는 중…' : '더보기'}
        </button>
      )}
    </div>
  );
}
