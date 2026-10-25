/**
 * /search — 우측 "전체검색"에서 오는 전체 결과 페이지.
 * `/api/search`가 제목/본문을 합친 글 목록을 돌려주므로, 이 페이지는
 * 하나의 리스트로 나열한다(정확한 총개수 COUNT 없이 상위 N건 + hasMore).
 */
import { Gnb } from '../../components/Gnb.tsx';
import { LeftSidebarLoggedIn, LeftSidebarLoggedOut, RightSidebar } from '../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { PostCard } from '../../components/PostCard.tsx';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchSearch, type SearchPostHit, type SearchResults } from '../../lib/search.ts';
import type { FeedPost } from '../../lib/feed.ts';
import { fetchCategoryTreeAndPopular } from '../../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../../lib/popularity.ts';
import { fetchFollowing, type FollowingUser } from '../../lib/relationships.ts';
import { hasUnreadMessages } from '../../lib/messages.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const SEARCH_PAGE_LIMIT = 20;

function toFeedPost(post: SearchPostHit): FeedPost {
  return {
    id: post.id,
    publicId: post.publicId,
    title: post.title,
    bodyPreview: post.snippet,
    authorId: post.authorId,
    authorUsername: post.authorUsername,
    authorNickname: post.authorNickname,
    authorAvatarUrl: post.authorAvatarUrl,
    authorIsAgent: false,
    categoryName: post.categoryName,
    categorySlug: post.categorySlug,
    createdAt: post.createdAt,
    reactionCount: post.reactionCount,
    commentCount: post.commentCount,
    deletedAt: null,
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const userId = await getSessionUserId();

  const [search, treeAndPopular, popularPosts, account, following, unreadMessages] = await Promise.all([
    query.length >= 2
      ? fetchSearch(query, SEARCH_PAGE_LIMIT, 0).catch((err) => {
          console.error('search failed', err);
          return null;
        })
      : Promise.resolve<SearchResults | null>(null),
    fetchCategoryTreeAndPopular(6).catch(() => ({ tree: [], popular: [] })),
    fetchPopularPosts({ window: '24h', limit: 5 }).catch(() => [] as PopularPost[]),
    userId ? fetchAccountSummary() : Promise.resolve(null),
    userId
      ? fetchFollowing(5).catch((err) => {
          console.error('following widget failed', err);
          return [] as FollowingUser[];
        })
      : Promise.resolve<FollowingUser[]>([]),
    userId
      ? hasUnreadMessages().catch((err) => {
          console.error('unread messages check failed', err);
          return false;
        })
      : Promise.resolve(false),
  ]);

  const isLoggedIn = account !== null;
  const currentUsername = account?.username;
  const { tree: categoryTree } = treeAndPopular;
  const gnbCategoryTree = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));

  const leftSidebar = isLoggedIn ? (
    <LeftSidebarLoggedIn
      username={currentUsername ?? ''}
      nickname={account?.nickname ?? currentUsername ?? ''}
      avatarUrl={account?.avatarUrl ?? ''}
      following={following}
      categoryTree={gnbCategoryTree}
    />
  ) : (
    <LeftSidebarLoggedOut categoryTree={gnbCategoryTree} />
  );

  const hasAnyResult = !!search && search.posts.items.length > 0;

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
        <Gnb
          sidebar={leftSidebar}
          profileHref={isLoggedIn ? `/@${currentUsername}` : '/signin'}
          categoryTree={gnbCategoryTree}
          isLoggedIn={isLoggedIn}
        />
        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>
          <main className={styles.center}>
            <h1 className={styles.heading}>{query ? `“${query}” 검색 결과` : '전체검색'}</h1>
            {!query ? (
              <p className={styles.guidance}>제목·본문에서 두 글자 이상 입력해 검색해 보세요.</p>
            ) : query.length < 2 ? (
              <p className={styles.guidance}>검색어를 두 글자 이상 입력해 주세요.</p>
            ) : search === null ? (
              <p className={styles.empty}>검색 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.</p>
            ) : !hasAnyResult ? (
              <p className={styles.empty}>일치하는 공개 글이 없어요.</p>
            ) : (
              search.posts.items.map((post) => (
                <PostCard
                  key={post.id}
                  post={toFeedPost(post)}
                  isLoggedIn={isLoggedIn}
                  showCategoryBadge
                  currentUserId={isLoggedIn ? userId : null}
                  highlightQuery={query}
                />
              ))
            )}
          </main>
          <aside className={styles.right}>
            <RightSidebar popularPosts={popularPosts} />
          </aside>
        </div>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
