import { Gnb, type GnbCategoryGroup } from '../../components/Gnb.tsx';
import { MessagesView } from '../../components/MessagesView.tsx';
import { LeftSidebarLoggedIn } from '../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { NewPostComposer } from '../../components/NewPostComposer.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { LoginRequiredGate } from '../../components/LoginRequiredGate.tsx';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchThreads, hasUnreadMessages } from '../../lib/messages.ts';
import { fetchCategoryTreeAndPopular, writableCommunityCategories } from '../../lib/categories.ts';
import { fetchFollowing, fetchConnectedUsers, type FollowingUser } from '../../lib/relationships.ts';
import { listNotifications } from '../../lib/notifications.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import { fetchActiveAnnouncements, type Announcement } from '../../lib/announcements.ts';
import styles from './page.module.css';

/**
 * `/messages` — goodfriends-ui 메시지 화면(디코딩 원본 line 473-600). /saved와
 * 같은 이유로 로그인 필수, 다른 §4.3 화면들과 같은 LoginRequiredGate로 통일한다.
 */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return <LoginRequiredGate />;

  const { thread: initialActiveThreadId } = await searchParams;

  // 서로 결과를 참조하지 않는 조회들을 Promise.all로 묶는다. 위젯 실패 격리는
  // 각 프로미스 안의 try/catch로 유지한다.
  const [threads, categoryTreeAndPopular, connectedUsers, account, following, unreadMessages, notifications, announcements] = await Promise.all([
    fetchThreads(),
    fetchCategoryTreeAndPopular(6),
    fetchConnectedUsers(),
    fetchAccountSummary(),
    fetchFollowing(5).catch((err) => {
      console.error('following widget failed', err);
      return [] as FollowingUser[];
    }),
    hasUnreadMessages().catch((err) => {
      console.error('unread messages check failed', err);
      return false;
    }),
    listNotifications().catch((err) => {
      console.error('notifications fetch failed', err);
      return [];
    }),
    fetchActiveAnnouncements().catch((err) => {
      console.error('announcements fetch failed', err);
      return [] as Announcement[];
    }),
  ]);

  // 세션(Redis)은 유효한데 계정이 DB에서 지워진 비정상 상태가 있을 수 있다
  // (fetchAccountSummary가 그 경우 null을 준다) — 위 게이트를 통과했어도
  // 여기서 다시 로그인 필요 화면으로 보낸다.
  if (!account) return <LoginRequiredGate />;

  const { tree: categoryTree } = categoryTreeAndPopular;
  const currentUsername = account.username;
  const currentNickname = account.nickname;
  const currentAvatarUrl = account.avatarUrl;

  const gnbCategoryTree: GnbCategoryGroup[] = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));
  const communityCategories = writableCommunityCategories(categoryTree, account.isModerator || account.isAgent);

  const leftSidebar = (
    <LeftSidebarLoggedIn
      username={currentUsername ?? ''}
      nickname={currentNickname ?? currentUsername ?? ''}
      avatarUrl={currentAvatarUrl ?? ''}
      activeNav="messages"
      following={following}
      categoryTree={gnbCategoryTree}
    />
  );

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
        <Gnb
          sidebar={leftSidebar}
          activeTab="messages"
          profileHref={`/@${currentUsername}`}
          categoryTree={gnbCategoryTree}
          isLoggedIn={true}
        />
        {/* defaultCategoryId를 안 줘서 항상 My Post로 열린다(다른 페이지와 같은 패턴). */}
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
            <MessagesView
              initialThreads={threads}
              connectedUsers={connectedUsers}
              currentUserId={userId}
              initialActiveThreadId={initialActiveThreadId}
              initialNotifications={notifications}
              announcements={announcements}
            />
          </main>
        </div>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
