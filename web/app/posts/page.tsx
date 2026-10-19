import { redirect } from 'next/navigation';
import { Gnb, type GnbCategoryGroup } from '../../components/Gnb.tsx';
import { LogPostsFeed } from '../../components/LogPostsFeed.tsx';
import { LeftSidebarLoggedIn, RightSidebar } from '../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { NewPostComposer } from '../../components/NewPostComposer.tsx';
import { SubscriptionsProvider } from '../../components/subscriptions-context.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchLogFeed } from '../../lib/feed.ts';
import { fetchFollowing, type FollowingUser } from '../../lib/relationships.ts';
import { fetchCategoryTreeAndPopular, fetchSubscribedCategories } from '../../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../../lib/popularity.ts';
import { hasUnreadMessages } from '../../lib/messages.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import styles from '../page.module.css';

/**
 * `/posts` — 좌 사이드바 "Posts" 메뉴 전용(사용자 지시, 2026-08 — "메뉴 링크는
 * /posts야"). 처음엔 `/@{username}/posts`(username 파라미터)로 만들었는데,
 * `/saved`·`/messages`처럼 이 메뉴 자체가 "항상 내 글"만 다뤄서 굳이 URL에
 * username을 실을 이유가 없다는 지적 — `/saved/page.tsx`와 완전히 같은 패턴
 * (로그인 안 하면 즉시 `/signin`으로, 세션의 userId를 그대로 로그 주인으로 쓴다).
 *
 * 데이터 버그 수정(`src/feed.ts` `fetchHomeFeedForLog` — author_id도 매칭)은
 * 그대로 유효하다 — 게시판 글(category_id만 있음)과 개인 로그 글이 구분 없이
 * 최신순으로 병합되는 것도 동일.
 */
export default async function PostsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect('/signin');

  // 🔒 GET /api/feed?username= 라우트는 username을 받는다 — 사이드바용으로
  // 어차피 필요한 account-summary를 먼저 받아서 그 username을 그대로 쓴다.
  const account = await fetchAccountSummary();
  // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
  // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
  // 위 게이트를 통과했어도 여기서 다시 로그인 필요로 취급한다.
  if (!account) redirect('/signin');

  // 🔒 성능 점검 발견(2026-08-22) — 서로 결과를 참조하지 않는 조회들을
  // Promise.all로 묶었다. 위젯 실패 격리(§11.5.0)는 각 프로미스 안의
  // try/catch로 그대로 유지한다.
  const [posts, categoryTreeAndPopular, subscribed, following, popularPosts, unreadMessages] = await Promise.all([
    fetchLogFeed(account.username, { limit: 20, offset: 0 }),
    fetchCategoryTreeAndPopular(6),
    fetchSubscribedCategories(),
    fetchFollowing(5).catch((err) => {
      console.error('following widget failed', err);
      return [] as FollowingUser[];
    }),
    fetchPopularPosts({ window: '24h', limit: 5 }).catch((err) => {
      console.error('popular posts widget failed', err);
      return [] as PopularPost[];
    }),
    hasUnreadMessages().catch((err) => {
      console.error('unread messages check failed', err);
      return false;
    }),
  ]);

  const { tree: categoryTree } = categoryTreeAndPopular;
  const currentUsername = account.username;
  const currentNickname = account.nickname;
  const currentAvatarUrl = account.avatarUrl;

  const gnbCategoryTree: GnbCategoryGroup[] = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));
  const communityCategories = categoryTree.flatMap((g) => g.children.filter((c) => c.type === 'community'));

  const leftSidebar = (
    <LeftSidebarLoggedIn
      username={currentUsername ?? ''}
      nickname={currentNickname ?? currentUsername ?? ''}
      avatarUrl={currentAvatarUrl ?? ''}
      activeNav="posts"
      following={following}
      categoryTree={gnbCategoryTree}
    />
  );

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
      <SubscriptionsProvider initialSubscribed={subscribed}>
        <Gnb sidebar={leftSidebar} profileHref={`/@${currentUsername}`} categoryTree={gnbCategoryTree} isLoggedIn={true} />
        {/* 🔒 사용자 지시(2026-08, "모든페이지에서 new post버튼이 활성화
            되어야해") — defaultCategoryId를 안 줘서 항상 My Post로 열린다. */}
        <NewPostComposer
          isLoggedIn={true}
          categories={communityCategories}
          authorId={userId}
          authorUsername={currentUsername ?? ''}
          authorNickname={currentNickname ?? currentUsername ?? ''}
          authorAvatarUrl={currentAvatarUrl}
        />
        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>

          <main className={styles.center}>
            <LogPostsFeed username={currentUsername ?? ''} currentUserId={userId} initialPosts={posts} />
          </main>

          <aside className={styles.right}>
            <RightSidebar popularPosts={popularPosts} />
          </aside>
        </div>
      </SubscriptionsProvider>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
