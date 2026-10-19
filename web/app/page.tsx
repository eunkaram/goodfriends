import { Gnb, type GnbCategoryGroup } from '../components/Gnb.tsx';
import { HomeFeed } from '../components/HomeFeed.tsx';
import { LeftSidebarLoggedIn, LeftSidebarLoggedOut, RightSidebar } from '../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../components/composer-modal-context.tsx';
import { SubscriptionsProvider } from '../components/subscriptions-context.tsx';
import { UnreadMessagesProvider } from '../components/unread-messages-context.tsx';
import { getSessionUserId } from '../lib/session.ts';
import { fetchHomeFeed } from '../lib/feed.ts';
import { fetchCategoryTreeAndPopular, fetchSubscribedCategories, type Category } from '../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../lib/popularity.ts';
import { fetchFollowing, type FollowingUser } from '../lib/relationships.ts';
import { hasUnreadMessages } from '../lib/messages.ts';
import { fetchAccountSummary } from '../lib/account.ts';
import styles from './page.module.css';

/**
 * 홈 `/` — §11.7.1(로그인) · §11.7.2(비로그인). 로그인 여부에 따라 좌 사이드바와
 * 인라인 글쓰기 노출이 갈린다 — §4.3 "홈은 비로그인도 커뮤니티 글만 읽는다"의
 * 그 분기다. 3단 레이아웃은 page.module.css가 맡는다(1280px 미만은 사이드바 숨김).
 */
export default async function HomePage() {
  const userId = await getSessionUserId();

  // 🔒 성능 점검 발견(2026-08-22) — 아래 조회들은 서로 결과를 참조하지
  // 않는데 전부 순차 await였다. 실제 데이터 의존 관계가 없는 것들만
  // Promise.all로 묶는다 — 위젯 실패 격리(§11.5.0)는 각 프로미스 안의
  // try/catch로 그대로 유지한다.
  const [feed, categoryTreeAndPopular, subscribed, account, following, popularPosts, unreadMessages] = await Promise.all([
    fetchHomeFeed({ sort: 'latest', limit: 20, offset: 0 }),
    // 🔒 사용자 지시(2026-08-22) — 비로그인 좌 사이드바 전용 "인기 카테고리" 6개.
    // /api/categories/tree가 tree+popular를 한 응답에 묶어 주므로(로그인
    // 여부와 무관, 불변식 1) 로그인 여부와 무관하게 항상 같이 받는다.
    fetchCategoryTreeAndPopular(6),
    userId ? fetchSubscribedCategories() : Promise.resolve<Pick<Category, 'id' | 'name' | 'slug'>[]>([]),
    userId ? fetchAccountSummary() : Promise.resolve(null),
    // §11.7.1 좌 "팔로잉" 위젯 — 위젯 하나라 실패해도 홈 전체를 막을 이유가 없다(§11.5.0과 같은 원칙).
    userId
      ? fetchFollowing(5).catch((err) => {
          console.error('following widget failed', err);
          return [] as FollowingUser[];
        })
      : Promise.resolve<FollowingUser[]>([]),
    // §5.1.1 "인기 글 5건(24h)" — 사이드바 위젯은 부분 실패해도 홈 전체를 막지 않는다(§11.5.0).
    fetchPopularPosts({ window: '24h', limit: 5 }).catch((err) => {
      console.error('popular posts widget failed', err); // 위젯만 조용히 제거 — 에러 표시 없음(§11.5.0)
      return [] as PopularPost[];
    }),
    // §11.7.1 우 "신규 마켓 3건" — MarketPost가 이제 있으니(0017) 홈 피드와 분리된
    // market_posts를 그대로 재사용한다(§5 "마켓은 홈 피드에서 제외"와 무관 — 이건    // 🔒 사용자 지시(2026-08-25) — 좌측 메뉴 Messages 옆 안 읽음 표시.
    userId
      ? hasUnreadMessages().catch((err) => {
          console.error('unread messages check failed', err);
          return false;
        })
      : Promise.resolve(false),
  ]);

  // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
  // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
  // 그때는 로그인 안 한 것으로 취급한다(userId만 보고 판단하면 이 뒤로 전부
  // 깨진 상태로 렌더된다).
  const isLoggedIn = account !== null;
  const currentUserId = isLoggedIn ? userId : null;
  const { tree: categoryTree, popular: popularCategoriesForLoggedOut } = categoryTreeAndPopular;
  const currentUsername = account?.username;
  const currentNickname = account?.nickname;
  const currentAvatarUrl = account?.avatarUrl;

  const communityCategories = categoryTree.flatMap((g) => g.children.filter((c) => c.type === 'community'));

  const gnbCategoryTree: GnbCategoryGroup[] = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));
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
      {/* 🔒 카테고리 페이지의 SubscribeButton과 같은 Context를 쓰진 않지만(페이지
          이동 시 프로바이더가 새로 만들어진다 — 그게 맞다, 서버에서 막 가져온
          최신 구독 목록으로 다시 시작해야 하니까), SubscribedCategoriesWidget이
          어디서든 동작하려면 홈에도 Provider가 있어야 한다. */}
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
      <SubscriptionsProvider initialSubscribed={subscribed}>
        <Gnb
          sidebar={leftSidebar}
          activeTab="home"
          profileHref={isLoggedIn ? `/@${currentUsername}` : '/signin'}
          categoryTree={gnbCategoryTree}
          isLoggedIn={isLoggedIn}
        />
        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>
          <main className={styles.center}>
            {/* 🔒 사용자 지시(2026-08) — "모든 리스트 페이지의 헤더(타이틀)을
                동일한 스타일 적용해줘". 카테고리 피드의 `.listTitle`(artifact
                실측, 20px/600)과 같은 스타일로 통일 — 홈은 카테고리가 없어
                "Home" 하나뿐이라 "›" 구분자도, 링크도 필요 없다(자기 자신을
                가리키는 링크는 무의미). 예전 Breadcrumb(14px)가 갖고 있던
                sticky 동작(§ "스크롤은 모든 페이지에 동일하게 적용해야해")은
                그대로 유지한다. */}
            <h1 className={styles.pageTitle}>Home</h1>
            <HomeFeed
              initialPosts={feed}
              isLoggedIn={isLoggedIn}
              composerCategories={communityCategories}
              currentUsername={currentUsername}
              currentNickname={currentNickname}
              currentAvatarUrl={currentAvatarUrl}
              currentUserId={currentUserId}
            />
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
