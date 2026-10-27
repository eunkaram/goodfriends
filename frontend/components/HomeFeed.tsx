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

export interface HomeFeedProps {
  initialPosts: FeedPost[];
  isLoggedIn: boolean;
  /** New Post 모달의 카테고리 선택지 — 로그인 시에만 쓰인다(§11.7.2 "비로그인엔 숨김") */
  composerCategories: Category[];
  /** 낙관적 삽입 카드에 표시할 작성자명(§11.5.2) — 서버 재조회 없이 카드가 바로 정확해진다 */
  currentUsername?: string;
  /** 글쓰기 모달 아바타 이니셜용 */
  currentNickname?: string;
  /** 🔒 사용자 발견(2026-08, "글쓰기, 글 수정 팝업에 내 아바타가 표시가
   * 안돼") — 글쓰기 모달 아바타 실제 사진용, 없으면 이니셜로 폴백. */
  currentAvatarUrl?: string | null;
  /** 낙관적 삽입 카드의 authorId + PostCard "···" 메뉴의 본인 글 판별(삭제하기 노출)용 */
  currentUserId?: string | null;
}

/**
 * 🔒 사용자 지시(2026-08) — "최신/인기 탭도 모든 리스트에서 삭제해줘".
 * CategoryFeed와 같은 이유로 sort 전환 기능(`changeSort`)도 같이 걷어냈다
 * — 정렬은 항상 최신순 하나뿐이다. `computePopularity`/`getPopularity`
 * 기반 인기순 로직 자체는 안 죽는다 — 우 사이드바 "인기 글" 위젯이 여전히
 * 그 경로를 쓴다(app/page.tsx), 이 피드의 탭에서만 빠지는 것.
 */
export function HomeFeed({
  initialPosts,
  isLoggedIn,
  composerCategories,
  currentUsername,
  currentNickname,
  currentAvatarUrl,
  currentUserId,
}: HomeFeedProps) {
  const { posts, prependPost, removePost, loading, hasMore, loadMore } = usePaginatedFeed<FeedPost, 'latest'>({
    initialPosts,
    initialSort: 'latest',
    buildUrl: (_sort, offset) => `/api/feed?sort=latest&limit=${FEED_PAGE_SIZE}&offset=${offset}`,
  });
  const { isOpen, close } = useComposerModal();

  return (
    <div>
      {isLoggedIn && isOpen && (
        <PostComposerModal
          categories={composerCategories}
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
        <p className={styles.empty}>
          {isLoggedIn ? '아직 첫 글이 없어요. 여기 처음 쓰는 사람이 되어보세요.' : '아직 첫 글이 없어요.'}
        </p>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            isLoggedIn={isLoggedIn}
            // 🔒 사용자 발견(2026-09-06, "홈화면의 글 리스트에서 각 글의
            // 카테고리부분이 보이질 않네") — 홈도 Saved·Posts(내 글)와 똑같이
            // 여러 카테고리가 섞인 목록이다(breadcrumb가 "Home" 하나뿐이라
            // 카테고리 맥락이 아예 없음) — showCategoryBadge를 안 넘기던 게
            // 원래 빠뜨린 것.
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
