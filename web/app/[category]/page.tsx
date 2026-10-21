import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Gnb } from '../../components/Gnb.tsx';
import { CategoryFeed } from '../../components/CategoryFeed.tsx';
import { SubscribeButton } from '../../components/SubscribeButton.tsx';
import { LeftSidebarLoggedIn, LeftSidebarLoggedOut, RightSidebar } from '../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { SubscriptionsProvider } from '../../components/subscriptions-context.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { UserLogView } from './UserLogView.tsx';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchCategoryFeed } from '../../lib/feed.ts';
import { fetchCategoryTreeAndPopular, fetchSubscribedCategories, findCategoryBySlug, type Category } from '../../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../../lib/popularity.ts';
import { fetchFollowing, type FollowingUser } from '../../lib/relationships.ts';
import { hasUnreadMessages } from '../../lib/messages.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import { SITE_NAME, SITE_TAGLINE } from '../../lib/site.ts';
import styles from './page.module.css';

/**
 * 🔒 M5 SEO(#6) — 카테고리 랜딩에 아예 metadata가 없어 레이아웃 기본값
 * ("AI Community" 제목·홈 설명)이 그대로 나갔다. 슬러그를 트리에서 조회해
 * 카테고리명을 title로, canonical(+OG)을 세운다. `/@{username}` 분기는
 * 프로필 페이지가 따로 로그인 게이트라 여기서 반환해야 할 메타가 없다.
 */
export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category: rawSlug } = await params;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return {};
  }
  if (slug.startsWith('@')) return {};
  const { tree } = await fetchCategoryTreeAndPopular(1);
  const category = findCategoryBySlug(tree, slug);
  if (!category || category.type !== 'community') return {};
  const title = `${category.name} 게시판`;
  const description = `${category.name} 게시판 — ${SITE_TAGLINE}`;
  return {
    title,
    description,
    alternates: { canonical: `/${category.slug}` },
    openGraph: { siteName: SITE_NAME, locale: 'ko_KR', type: 'website', title, description, url: `/${category.slug}` },
  };
}

/**
 * `/{category}`(§11.7.3) 와 `/@{username}`(§11.7.6, §3.3)이 같은 동적 세그먼트를
 * 공유한다 — Next.js는 폴더 이름이 `@`로 시작하면 병렬 라우트 슬롯으로 해석해서
 * `app/@[username]/`을 따로 만들 수 없다(URL의 `@`와는 무관한 별개 규칙). PRD
 * §3.3도 "@ 접두어로 파싱 단계에서 판별한다"고 이미 이렇게 설계해뒀다.
 */
export default async function CategoryOrUserLogPage({ params }: { params: Promise<{ category: string }> }) {
  const { category: rawSlug } = await params;
  // 🔒 실측 발견 — 커스텀 서버(server.ts)를 통과하면 Next가 동적 세그먼트를
  // 자동 디코딩하지 않는다. `/@user`가 `%40user`(원문 그대로)로 들어와
  // slug.startsWith('@') 분기가 절대 안 걸렸다. 여기서 직접 디코딩한다.
  // 🔒 /review 발견(red-team) — 깨진 퍼센트 인코딩(예: 끝에 홀로 남은 `%`)이면
  // decodeURIComponent가 URIError를 던진다 — 봇·크롤러의 기형 경로 요청 하나로
  // 이 공개(비로그인) 라우트가 500으로 죽는 대신 조용히 404로 처리한다.
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    notFound();
  }

  const userId = await getSessionUserId();

  if (slug.startsWith('@')) {
    return <UserLogView username={slug.slice(1)} viewerId={userId} />;
  }

  // 🔒 /api/categories/tree엔 slug 단건 조회 라우트가 없다 — 사이드바용으로
  // 어차피 받아오는 트리에서 그대로 찾는다(lib/categories.ts findCategoryBySlug).
  const { tree: categoryTree, popular: popularCategoriesForLoggedOut } = await fetchCategoryTreeAndPopular(6);
  const category = findCategoryBySlug(categoryTree, slug);
  if (!category || category.type !== 'community') notFound(); // 마켓 카테고리는 /market 몫(§5) — 별도 화면

  // 🔒 성능 점검 발견(2026-08-22) — app/page.tsx와 같은 이유로, 서로 결과를
  // 참조하지 않는 조회들을 Promise.all로 묶었다(recommendedCategories 없음 —
  // 이 페이지는 원래도 항상 subscribed 자체를 렌더에 쓴다). 위젯 실패 격리
  // (§11.5.0)는 각 프로미스 안의 try/catch로 그대로 유지한다.
  const [feed, subscribed, account, following, popularPosts, unreadMessages] = await Promise.all([
    fetchCategoryFeed(category.slug, { sort: 'latest', limit: 20, offset: 0 }),
    // 🔒 사용자 지시(2026-08) — "이게 홈, 커뮤니티에서 기본 메뉴야": 좌 사이드바를
    // 홈(§11.7.1)과 완전히 같은 컴포넌트로 통일한다. §11.7.3 원안의 "형제 카테고리"
    // 목록은 이걸로 대체됐다 — 메가메뉴(§11.8)가 이미 전체 카테고리 탐색을 담당하므로
    // 기능이 사라지는 게 아니라 발견 경로가 하나로 합쳐진 것.
    userId ? fetchSubscribedCategories() : Promise.resolve<Pick<Category, 'id' | 'name' | 'slug'>[]>([]),
    userId ? fetchAccountSummary() : Promise.resolve(null),
    userId
      ? fetchFollowing(5).catch((err) => {
          console.error('following widget failed', err);
          return [] as FollowingUser[];
        })
      : Promise.resolve<FollowingUser[]>([]),
    fetchPopularPosts({ categoryId: category.id, window: '24h', limit: 5 }).catch((err) => {
      console.error('popular posts widget failed', err); // 부분 실패 — 위젯만 조용히 제거(§11.5.0)
      return [] as PopularPost[];
    }),    userId
      ? hasUnreadMessages().catch((err) => {
          console.error('unread messages check failed', err);
          return false;
        })
      : Promise.resolve(false),
  ]);

  // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
  // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
  // 그때는 로그인 안 한 것으로 취급한다.
  const isLoggedIn = account !== null;
  const currentUserId = isLoggedIn ? userId : null;

  // 🔒 별도 isSubscribed() 호출 없이 이미 받아온 구독 목록에서 바로 찾는다 — 네트워크 왕복 하나 절약.
  const isSubscribedToThis = subscribed.some((c) => c.id === category.id);
  const currentUsername = account?.username;
  const currentNickname = account?.nickname;
  const currentAvatarUrl = account?.avatarUrl;

  const communityCategories = categoryTree.flatMap((g) => g.children.filter((c) => c.type === 'community'));

  const gnbCategoryTree = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));

  const leftSidebar = isLoggedIn ? (
    <LeftSidebarLoggedIn
      username={currentUsername ?? ''}
      nickname={currentNickname ?? currentUsername ?? ''}
      avatarUrl={currentAvatarUrl ?? ''}
      activeCategorySlug={category.slug}
      following={following}
      categoryTree={gnbCategoryTree}
    />
  ) : (
    <LeftSidebarLoggedOut popularCategories={popularCategoriesForLoggedOut} categoryTree={gnbCategoryTree} />
  );

  return (
    <ComposerModalProvider>
      {/* 🔒 사용자 발견(2026-08) — "구독/취소 하게 되면 왼쪽 메뉴에
          interaction이 발생하지 않아". SubscribeButton과 좌 사이드바의
          "구독 중" 목록이 이제 이 Context 하나를 공유해서 새로고침 없이
          같이 갱신된다. */}
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
      <SubscriptionsProvider initialSubscribed={subscribed}>
        <Gnb
          sidebar={leftSidebar}
          profileHref={isLoggedIn ? `/@${currentUsername}` : '/signin'}
          categoryTree={gnbCategoryTree}
          isLoggedIn={isLoggedIn}
        />
        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>

          <main className={styles.center}>
            {/* 🔒 사용자 지시(2026-08) — "리스트 컨텐츠 헤더(타이틀) - 목업과
                같게 수정". artifact `showList` 실측: "Home › 카테고리명" 한
                줄짜리 타이틀(20px/600, "›" 구분자만 --text-tertiary/400).
                기존 Breadcrumb(14px, sticky nav 스타일)과는 완전히 다른
                용도라 재사용하지 않고 이 화면 전용 마크업으로 바꿨다 — "Home"
                은 artifact엔 링크가 없지만, 이 앱은 실제 내비게이션이 필요해
                기존처럼 홈으로 가는 링크는 유지하고 시각적 스타일만 맞췄다. */}
            <div className={styles.topRow}>
              <div className={styles.listTitle}>
                <a href="/">Home</a>
                <span className={styles.listTitleSep}>›</span>
                {category.name}
              </div>
              <SubscribeButton category={category} initialSubscribed={isSubscribedToThis} isLoggedIn={isLoggedIn} />
            </div>
            <CategoryFeed
              categoryId={category.id}
              categorySlug={category.slug}
              categoryName={category.name}
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
