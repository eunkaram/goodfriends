import { Gnb, type GnbCategoryGroup } from '../../components/Gnb.tsx';
import { SavedFeed } from '../../components/SavedFeed.tsx';
import { LeftSidebarLoggedIn, RightSidebar } from '../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { NewPostComposer } from '../../components/NewPostComposer.tsx';
import { SubscriptionsProvider } from '../../components/subscriptions-context.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { LoginRequiredGate } from '../../components/LoginRequiredGate.tsx';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchSavedPosts } from '../../lib/feed.ts';
import { fetchCategoryTreeAndPopular, fetchSubscribedCategories } from '../../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../../lib/popularity.ts';
import { fetchFollowing, type FollowingUser } from '../../lib/relationships.ts';
import { hasUnreadMessages } from '../../lib/messages.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import styles from '../page.module.css';

/**
 * `/saved` — §11.7.7. Claude Design 확정안(artifact `showSaved`) 신규 화면.
 * saved_posts는 §4.3 대상이 아니다(§13 원안에 로그인 게이트 표시가 없다) —
 * "내가 저장한 글 목록" 자체가 전적으로 개인적인 데이터라 로그인 필수로
 * 막는다. 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을 띄우고
 * 로그인이 필요한 서비스입니다...") — 예전엔 소프트 게이트 UI 없이 바로
 * `redirect('/signin')`했지만, 이제 §4.3 로그인 게이트 화면들과 같은
 * `LoginRequiredGate`로 통일한다.
 */
export default async function SavedPage() {
  const userId = await getSessionUserId();
  if (!userId) return <LoginRequiredGate />;

  // 🔒 성능 점검 발견(2026-08-22) — 서로 결과를 참조하지 않는 조회들을
  // Promise.all로 묶었다. 위젯 실패 격리(§11.5.0)는 각 프로미스 안의
  // try/catch로 그대로 유지한다.
  const [posts, categoryTreeAndPopular, subscribed, account, following, popularPosts, unreadMessages] = await Promise.all([
    fetchSavedPosts({ limit: 20, offset: 0 }),
    fetchCategoryTreeAndPopular(6),
    fetchSubscribedCategories(),
    fetchAccountSummary(),
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

  // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
  // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
  // 위 게이트를 통과했어도 여기서 다시 로그인 필요 화면으로 보낸다.
  if (!account) return <LoginRequiredGate />;

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
      activeNav="saved"
      following={following}
      categoryTree={gnbCategoryTree}
    />
  );

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
      <SubscriptionsProvider initialSubscribed={subscribed}>
        <Gnb
          sidebar={leftSidebar}
          activeTab="saved"
          profileHref={`/@${currentUsername}`}
          categoryTree={gnbCategoryTree}
          isLoggedIn={true}
        />
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
            <SavedFeed currentUserId={userId} initialPosts={posts} />
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
