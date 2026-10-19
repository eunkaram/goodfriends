import { Gnb, type GnbCategoryGroup } from './Gnb.tsx';
import { LeftSidebarLoggedIn, LeftSidebarLoggedOut } from './HomeSidebars.tsx';
import { ComposerModalProvider } from './composer-modal-context.tsx';
import { NewPostComposer } from './NewPostComposer.tsx';
import { SubscriptionsProvider } from './subscriptions-context.tsx';
import { UnreadMessagesProvider } from './unread-messages-context.tsx';
import { getSessionUserId } from '../lib/session.ts';
import { fetchCategoryTreeAndPopular, fetchSubscribedCategories, type Category } from '../lib/categories.ts';
import { fetchFollowing, type FollowingUser } from '../lib/relationships.ts';
import { fetchAccountSummary } from '../lib/account.ts';
import { hasUnreadMessages } from '../lib/messages.ts';
import { STATIC_PAGES, type StaticPageKey } from '../lib/static-pages.ts';
import styles from '../app/[category]/UserLogView.module.css';
import staticStyles from './StaticPageLayout.module.css';

/**
 * `/about` `/ads` `/terms` `/privacy` `/help` 공용 셸 — Claude Design
 * 확정안(artifact `showStaticPage`)이 이 5개를 전부 같은 레이아웃(제목+
 * 본문만)으로 렌더링하듯, 이 컴포넌트 하나를 5개 얇은 라우트가 공유한다.
 * 로그인 여부와 무관하게 누구나 보는 공개 정보 페이지라(§4.3 대상 아님)
 * 로그인 게이트가 없다 — UserLogView.module.css의 `.left`/`.layout`을
 * 재사용해 §11.7.6류 화면(우 사이드바 없음)과 같은 레이아웃 언어를 쓴다.
 */
export async function StaticPageLayout({ pageKey }: { pageKey: StaticPageKey }) {
  const page = STATIC_PAGES[pageKey];

  const userId = await getSessionUserId();

  // 🔒 사용자 지시(2026-08-22) — 비로그인 좌 사이드바 6개. /api/categories/tree가
  // tree+popular를 한 응답에 묶어 주므로(로그인 여부와 무관, 불변식 1) 항상 같이 받는다.
  const { tree: categoryTree, popular: popularCategoriesForLoggedOut } = await fetchCategoryTreeAndPopular(6);
  const gnbCategoryTree: GnbCategoryGroup[] = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));
  const communityCategories = categoryTree.flatMap((g) => g.children.filter((c) => c.type === 'community'));

  let isLoggedIn = false;
  let currentUserId: string | null = null;
  let currentUsername: string | undefined;
  let currentNickname: string | undefined;
  let currentAvatarUrl: string | undefined;
  let subscribed: Pick<Category, 'id' | 'name' | 'slug'>[] = [];
  let following: FollowingUser[] = [];
  let unreadMessages = false;

  if (userId) {
    // 🔒 성능 점검 발견(2026-08-22) — 서로 결과를 참조하지 않는 조회들을
    // Promise.all로 묶었다.
    const [account, subscribedResult, followingResult, unreadMessagesResult] = await Promise.all([
      fetchAccountSummary(),
      fetchSubscribedCategories(),
      fetchFollowing(5).catch((err) => {
        console.error('following widget failed', err);
        return [] as FollowingUser[];
      }),
      hasUnreadMessages().catch((err) => {
        console.error('unread messages check failed', err);
        return false;
      }),
    ]);
    // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
    // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
    // 그때는 로그인 안 한 것으로 취급한다.
    if (account) {
      isLoggedIn = true;
      currentUserId = userId;
      currentUsername = account.username;
      currentNickname = account.nickname;
      currentAvatarUrl = account.avatarUrl;
      subscribed = subscribedResult;
      following = followingResult;
      unreadMessages = unreadMessagesResult;
    }
  }

  const leftSidebar = isLoggedIn ? (
    <LeftSidebarLoggedIn
      username={currentUsername ?? ''}
      nickname={currentNickname ?? currentUsername ?? ''}
      avatarUrl={currentAvatarUrl ?? ''}
      following={following}
      categoryTree={gnbCategoryTree}
    />
  ) : (
    <LeftSidebarLoggedOut popularCategories={popularCategoriesForLoggedOut} categoryTree={gnbCategoryTree} />
  );

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
      <SubscriptionsProvider initialSubscribed={subscribed}>
        {/* 🔒 실전 발견(2026-08, 새 interactive 목업) — 이 호출은 그동안 `sidebar`
            prop 없이 `<Gnb isLoggedIn categoryTree />`를 넘기고 있었다 — 둘 다
            그 시점 Gnb.tsx가 이미 안 받는 프롭이라(사이드바를 그대로 전달받는
            방식으로 바뀐 지 오래) 5개 정적 페이지의 phone 드로어가 계속 빈
            채로 열렸었다. `sidebar={leftSidebar}`로 맞췄다 — `categoryTree`/
            `isLoggedIn`은 이번에 phone 헤더 격자 아이콘용으로 다시 필요해져
            (Community 팝업 직접 열기) 정당하게 되살아난 것이다. */}
        <Gnb
          sidebar={leftSidebar}
          profileHref={isLoggedIn ? `/@${currentUsername}` : '/signin'}
          categoryTree={gnbCategoryTree}
          isLoggedIn={isLoggedIn}
        />
        {/* 🔒 사용자 지시(2026-08, "모든페이지에서 new post버튼이 활성화
            되어야해") — 소개/광고/약관/개인정보/HELP 5개 정적 페이지 전부
            이 컴포넌트 하나를 공유한다. defaultCategoryId를 안 줘서 My
            Post로 열린다(로그인 안 했으면 NewPostComposer 자체가 null). */}
        {isLoggedIn && (
          <NewPostComposer
            isLoggedIn={true}
            categories={communityCategories}
            authorId={currentUserId ?? ''}
            authorUsername={currentUsername ?? ''}
            authorNickname={currentNickname ?? currentUsername ?? ''}
            authorAvatarUrl={currentAvatarUrl}
          />
        )}
        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>

          <main className={styles.center}>
            <div className={staticStyles.page}>
              <h1 className={staticStyles.title}>{page.title}</h1>
              <p className={staticStyles.body}>{page.body}</p>
            </div>
          </main>
        </div>
      </SubscriptionsProvider>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
