'use client';

import { PostCard } from './PostCard.tsx';
import { usePaginatedFeed, FEED_PAGE_SIZE } from './use-paginated-feed.ts';
import type { FeedPost } from '../lib/feed.ts';
import styles from './HomeFeed.module.css';

/**
 * `/@{username}/posts` — 좌 사이드바 "Posts" 메뉴 전용(사용자 지시, 2026-08 —
 * "좌측 Posts메뉴는 게시판, 공개된 개인 post로 구분없이 최신순으로 리스트를
 * 만들어줘. 목업의 Saved 리스트 페이지를 참고해서 똑같이 만들어줘"). `SavedFeed`와
 * 완전히 같은 구조(정렬 탭 없음, 최신순 고정, 카테고리 배지) — 데이터 소스만
 * `saved_posts` 대신 이 사람이 쓴 글(`fetchLogPosts`)로 바뀐다. `fetchLogPosts`
 * (`src/feed.ts`의 `fetchHomeFeedForLog`)가 `author_id`/`log_id` 둘 다로 매칭해
 * 게시판 글(category_id 있음)과 개인 로그 글(log_id 있음)을 구분 없이
 * `created_at DESC`로 병합해 반환한다 — 이 컴포넌트는 그 결과를 그대로
 * 페이지네이션만 얹어 보여준다(artifact `showMyPosts` 실측 — title "Posts",
 * 20px/600).
 */
export function LogPostsFeed({ username, currentUserId, initialPosts }: { username: string; currentUserId: string; initialPosts: FeedPost[] }) {
  const { posts, removePost, loading, hasMore, loadMore } = usePaginatedFeed<FeedPost, 'latest'>({
    initialPosts,
    initialSort: 'latest',
    buildUrl: (_sort, offset) => `/api/feed?username=${encodeURIComponent(username)}&limit=${FEED_PAGE_SIZE}&offset=${offset}`,
  });

  return (
    <div>
      <h1 className={styles.pageTitle}>Posts</h1>

      {posts.length === 0 && !loading ? (
        <p className={styles.empty}>아직 공개된 글이 없어요.</p>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            isLoggedIn={true}
            showCategoryBadge
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
