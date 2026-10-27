import { notFound } from 'next/navigation';
import { Gnb } from '../../components/Gnb.tsx';
import { ProfileHeader } from '../../components/ProfileHeader.tsx';
import { ProfileTabs } from '../../components/ProfileTabs.tsx';
import { LeftSidebarLoggedIn } from '../../components/HomeSidebars.tsx';
import { ProfileRightSidebar } from '../../components/ProfileRightSidebar.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { LoginRequiredGate } from '../../components/LoginRequiredGate.tsx';
import { NewPostComposer } from '../../components/NewPostComposer.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { fetchProfileByUsername, fetchLogPosts, fetchRepliedPosts, fetchFollowers } from '../../lib/user-log.ts';
import { fetchSavedPosts } from '../../lib/feed.ts';
import { fetchCategoryTreeAndPopular, writableCommunityCategories } from '../../lib/categories.ts';
import { fetchFollowing, type FollowingUser } from '../../lib/relationships.ts';
import { hasUnreadMessages } from '../../lib/messages.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import styles from './UserLogViewLayout.module.css';

/**
 * 개인 로그 `/@{username}` — §11.7.6.
 *
 * §4.3 "로그 홈 ❌ (비로그인)" — user_logs RLS(app_can_view_tier)가 이미
 * app_current_user_id() IS NOT NULL을 요구해서 비로그인은 어떤 로그도 못 본다.
 * 여기서 그 결과(항상 null)를 "존재 안 함" 404로 보여주면 로그인 장벽과
 * "글쎄 이 아이디가 있긴 한가"를 구분 못 하게 되므로, 비로그인은 로그인
 * 게이트 화면을 먼저 보여주고 존재 여부 판단 자체를 하지 않는다.
 *
 * 🔒 사용자 발견(2026-08, 스크린샷 제시 — "디자인이 안맞잖아. left, right,
 * center모두 스크린샷을 분석해서 제대로 해줘") — 이 화면의 좌 사이드바가
 * 지금까지 "@{username}"만 표시하는 최소 placeholder였고(이전 프로필
 * 재스타일링 라운드가 "이번 라운드 범위 밖"으로 명시적으로 미뤄뒀던 지점),
 * 우 사이드바는 아예 없었다(§11.7.6 원안 "남의 개인 공간엔 서비스 위젯을
 * 넣지 않는다"). 새로 제시된 목업 스크린샷은 이 페이지도 Home·카테고리
 * 피드와 같은 3단 레이아웃(좌: 로고+프로필+nav+Community+구독+팔로잉)임을
 * 보여준다 — §11.7.6의 "우 사이드바 없음" 결정을 이 라운드에서 뒤집는다
 * (artifact 실측이 이전 PRD 원안을 우선한다는 이 프로젝트의 기존 관례와
 * 일관, styles/tokens.css 헤더 주석 참고). `LeftSidebarLoggedIn`은 Home·
 * 카테고리 피드와 그대로 재사용하지만, 우 사이드바는 재사용하지 않는다 —
 * 🔒 후속 정정(2026-10, "오른쪽영역을 디자인 시안대로") — 디코딩 원본을
 * 다시 실측하니 `showProfile`(이 화면) 분기는 `notProfile`(Home·카테고리
 * 피드) 분기의 검색+인기글과 완전히 다른 위젯(통계 카드+관심 분야+스택+
 * 활동 히트맵, line 858-927)이었다 — `ProfileRightSidebar`로 새로 분리했다.
 * 좌 사이드바 데이터(로그인한 뷰어 자신의 프로필·구독·팔로잉)는 "지금 보고
 * 있는 남의 프로필"과 완전히 별개다 — `viewerId` 기준으로 따로 조회한다
 * (위 두 페이지의 패턴 그대로). 우 사이드바(ProfileRightSidebar)는 반대로
 * "지금 보고 있는 프로필"(log) 기준이다.
 */
export async function UserLogView({ username, viewerId }: { username: string; viewerId: string | null }) {
  const categoryTreePromise = fetchCategoryTreeAndPopular(6);

  if (!viewerId) {
    const { tree: categoryTree } = await categoryTreePromise;
    const gnbCategoryTree = categoryTree.map((g) => ({
      name: g.name,
      children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    }));
    // 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을 띄우고 로그인이
    // 필요한 서비스입니다...") — 인라인 안내 카드 대신 공용 게이트로 통일.
    return <LoginRequiredGate categoryTree={gnbCategoryTree} />;
  }

  // 🔒 relationshipStatus/isFollowing이 이제 프로필 응답 자체에 들어있다
  // (reafy_backend GET /api/profile/:username) — 예전처럼 별도 호출 2개가
  // 더 필요 없다.
  const log = await fetchProfileByUsername(username);
  if (!log) notFound();

  const isSelf = log.relationshipStatus === 'self';
  // 🔒 goodfriends 리브랜딩(2026-10) — 저장한 글 탭(기존 Media 탭 교체).
  // fetchSavedPosts는 항상 세션 본인 기준이라 본인 프로필에서만 조회한다.
  const savedPostsPromise = isSelf ? fetchSavedPosts({ limit: 20, offset: 0 }) : Promise.resolve([]);

  // 🔒 좌 사이드바는 "지금 보고 있는 프로필"이 아니라 "로그인한 뷰어 자신"
  // 기준이다 — Home·카테고리 피드와 완전히 같은 조회 패턴(app/page.tsx,
  // app/[category]/page.tsx 참고). 우 사이드바(ProfileRightSidebar)는 반대로
  // "지금 보고 있는 프로필"(log) 기준이라 별도 조회가 필요 없다 — popularPosts는
  // 이 화면이 더 이상 안 써서(디코딩 원본 line 861 notProfile 분기, 2026-10)
  // 뺐다.
  // 🔒 성능 점검 발견(2026-08-22) — 서로 결과를 참조하지 않는 조회들을
  // Promise.all로 묶었다. 위젯 실패 격리(§11.5.0)는 각 프로미스 안의
  // try/catch로 그대로 유지한다.
  const [categoryTreeAndPopular, posts, followers, repliedPosts, savedPosts, account, following, unreadMessages] = await Promise.all([
    categoryTreePromise,
    fetchLogPosts(username, { limit: 20, offset: 0 }),
    fetchFollowers(username),
    // 🔒 사용자 지시(2026-08, "replies탭의 리스트는 내가 작성한 댓글의
    // 글리스트를 보여줘야해(원글 + 내 댓글 그룹만 노출)") — 댓글 탭 전용 데이터.
    fetchRepliedPosts(username, { limit: 20, offset: 0 }),
    savedPostsPromise,
    fetchAccountSummary(),
    fetchFollowing(5).catch((err) => {
      console.error('following widget failed', err);
      return [] as FollowingUser[];
    }),
    hasUnreadMessages().catch((err) => {
      console.error('unread messages check failed', err);
      return false;
    }),
  ]);

  const { tree: categoryTree } = categoryTreeAndPopular;
  const gnbCategoryTree = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));

  // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
  // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
  // 위 게이트를 통과했어도 여기서 다시 로그인 필요 화면으로 보낸다.
  if (!account) return <LoginRequiredGate categoryTree={gnbCategoryTree} />;

  // 🔒 이메일/비밀번호 여부는 auth_credentials 쪽 데이터(account-summary)라
  // user_logs 기반 profile 응답엔 없다 — 뷰어 자신 계정 조회는 사이드바용으로
  // 어차피 하니(account), isSelf일 때 그 값을 그대로 재사용한다(추가 호출 없음).
  const initialEmail = isSelf ? account.email : null;
  const initialHasPassword = isSelf ? account.hasPassword : false;

  const viewerUsername = account.username;
  const viewerNickname = account.nickname;
  const viewerAvatarUrl = account.avatarUrl;

  const communityCategories = writableCommunityCategories(categoryTree, account.isModerator || account.isAgent);

  const leftSidebar = (
    <LeftSidebarLoggedIn
      username={viewerUsername ?? ''}
      nickname={viewerNickname ?? viewerUsername ?? ''}
      avatarUrl={viewerAvatarUrl ?? ''}
      activeNav="profile"
      following={following}
      categoryTree={gnbCategoryTree}
    />
  );

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
        <Gnb
          sidebar={leftSidebar}
          activeTab={isSelf ? 'profile' : undefined}
          profileHref={`/@${viewerUsername}`}
          categoryTree={gnbCategoryTree}
          isLoggedIn={true}
        />
        {/* 🔒 사용자 지시(2026-08, "모든페이지에서 new post버튼이 활성화
            되어야해") — 남의 프로필을 보고 있어도 글쓰기는 항상 뷰어 본인
            기준(viewerId)이다. defaultCategoryId를 안 줘서 My Post로 열린다. */}
        <NewPostComposer
          isLoggedIn={true}
          categories={communityCategories}
          authorId={viewerId}
          authorUsername={viewerUsername ?? ''}
          authorNickname={viewerNickname ?? viewerUsername ?? ''}
          authorAvatarUrl={viewerAvatarUrl}
        />

        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>

          <main className={styles.center}>
            <ProfileHeader
              log={log}
              relationshipStatus={log.relationshipStatus}
              isFollowing={log.isFollowing}
              initialEmail={initialEmail}
              initialHasPassword={initialHasPassword}
              categoryTree={gnbCategoryTree}
            />

            <ProfileTabs
              posts={posts}
              repliedPosts={repliedPosts}
              savedPosts={savedPosts}
              followers={followers}
              isSelf={isSelf}
              // 🔒 사용자 지시(2026-08-26, "팔로워 공개여부는 프로필 공개여부에
              // 따라 가게") — 이전엔 본인만 고정이었다. 이제 user_logs RLS의
              // app_can_view_tier()와 같은 식(0031_profile_follower_visibility.sql)을
              // 앱 레이어에서 그대로 반복한다 — 이 페이지에 도달했다는 것
              // 자체가 이미 이 tier를 통과했다는 뜻이라(RLS가 안 통과하면
              // fetchUserLogByUsername이 null → notFound) 사실상 항상 true지만,
              // "팔로워 목록 공개도 프로필 공개 설정을 따른다"는 규칙을 코드로
              // 명시해 둔다(§10.2 사유 비공개 원칙과 같은 재검증 관례).
              followersVisible={
                isSelf ||
                log.visibility === 'public' ||
                (log.visibility === 'followers' && log.isFollowing) ||
                (log.visibility === 'friends' && log.relationshipStatus === 'friends')
              }
              isLoggedIn={true}
              currentUserId={viewerId}
              emptyPostsLabel={isSelf ? '이 공간은 아직 비어 있어요. 첫 기록을 남겨보세요.' : '아직 공개된 글이 없어요.'}
              profileUsername={log.username}
              profileNickname={log.nickname}
              profileAvatarUrl={log.avatarUrl}
            />
          </main>

          <aside className={styles.right}>
            <ProfileRightSidebar log={log} categoryTree={gnbCategoryTree} />
          </aside>
        </div>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
