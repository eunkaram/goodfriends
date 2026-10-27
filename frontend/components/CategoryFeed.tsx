'use client';

import { PostCard } from './PostCard.tsx';
import { usePaginatedFeed, FEED_PAGE_SIZE } from './use-paginated-feed.ts';
import { useComposerModal } from './composer-modal-context.tsx';
import dynamic from 'next/dynamic';
import type { FeedPost } from '../lib/feed.ts';
import type { Category } from '../lib/categories.ts';
import styles from './HomeFeed.module.css';

// Tiptap(~100KB gz)은 모달을 열 때만 로드 — 피드 첫 번들에서 뺀다.
const PostComposerModal = dynamic(() => import('./PostComposerModal.tsx').then((m) => m.PostComposerModal), { ssr: false });

export interface CategoryFeedProps {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  initialPosts: FeedPost[];
  isLoggedIn: boolean;
  /** New Post 모달의 카테고리 선택지(커뮤니티 전체) — 현재 카테고리가 기본 선택된다 */
  composerCategories: Category[];
  currentUsername?: string;
  currentNickname?: string;
  /** 🔒 사용자 발견(2026-08, "글쓰기, 글 수정 팝업에 내 아바타가 표시가
   * 안돼") — 글쓰기 모달 아바타 실제 사진용, 없으면 이니셜로 폴백. */
  currentAvatarUrl?: string | null;
  /** 낙관적 삽입 카드의 authorId + PostCard "···" 메뉴의 본인 글 판별(삭제하기 노출)용 */
  currentUserId?: string | null;
}

/**
 * §11.7.3 3~4번 — 포스트 카드. 인라인 글쓰기는 좌 사이드바가 홈과
 * 통일되면서(사용자 지시, 2026-08 — "이게 홈, 커뮤니티에서 기본 메뉴야")
 * New Post 모달로 교체했다(HomeFeed와 같은 패턴, PostComposerModal 공유).
 * 🔒 이 교체 전엔 `.composerRow` CSS가 이미 없어져서(홈 글쓰기 박스
 * 재구성 때 지워짐) 이 화면의 인라인 글쓰기가 조용히 깨져 있었다 — 모달
 * 전환으로 자연히 해소됨.
 * 🔒 사용자 지시(2026-08) — "아래 최신/인기 탭 메뉴 제거"(artifact `showList`
 * 에 정렬 탭 자체가 없다). 정렬은 항상 최신순 하나뿐이라 `usePaginatedFeed`
 * 의 sort 전환 기능도 같이 걷어냈다 — 안 쓰는 changeSort를 남겨두지 않는다.
 */
export function CategoryFeed({
  categoryId,
  categorySlug,
  categoryName,
  initialPosts,
  isLoggedIn,
  composerCategories,
  currentUsername,
  currentNickname,
  currentAvatarUrl,
  currentUserId,
}: CategoryFeedProps) {
  const { posts, prependPost, removePost, loading, hasMore, loadMore } = usePaginatedFeed<FeedPost, 'latest'>({
    initialPosts,
    initialSort: 'latest',
    buildUrl: (_sort, offset) => `/api/feed?category=${categorySlug}&sort=latest&limit=${FEED_PAGE_SIZE}&offset=${offset}`,
  });
  const { isOpen, close } = useComposerModal();

  return (
    <div>
      {isLoggedIn && isOpen && (
        <PostComposerModal
          categories={composerCategories}
          defaultCategoryId={categoryId}
          authorId={currentUserId ?? ''}
          authorUsername={currentUsername ?? ''}
          authorNickname={currentNickname ?? currentUsername ?? ''}
          authorAvatarUrl={currentAvatarUrl}
          onCreated={(post) => {
            prependPost(post);
            close();
          }}
          onClose={close}
        />
      )}

      {posts.length === 0 && !loading ? (
        <p className={styles.empty}>{`〈${categoryName}〉의 첫 글을 기다리고 있어요.`}</p>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            isLoggedIn={isLoggedIn}
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
