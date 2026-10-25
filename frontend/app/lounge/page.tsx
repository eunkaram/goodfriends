/**
 * /lounge — 라운지 채팅(M4, 전체방 1개). 로그인 게이트가 있는 화면 관례
 * (개인 로그·메시지 등과 동일): 서버에서 세션을 확인해 로그인이 아니면
 * LoginRequiredGate로 소프트 게이트, 연결은 Lounge(클라이언트)가 /ws/lounge로.
 *
 * 🔒 버그 수정(2026-10) — 이 페이지가 Gnb·좌 사이드바 없이 <main> 하나만
 * 그려서 사이트 전체 어디에도 /lounge로 가는 링크가 없는 것과 맞물려
 * 완전히 발견 불가능한 화면이었다(실전 발견 — "developed 서비스를 모두
 * 파악... 버그 다 수정해줘"). messages/page.tsx와 같은 2단(좌 사이드바+본문)
 * 전체 chrome 패턴으로 맞춘다 — 라운지는 피드가 아니라 채팅이라 우측
 * 사이드바(인기글)는 의미가 없어 messages 쪽을 따른다.
 */
import { Gnb, type GnbCategoryGroup } from '../../components/Gnb.tsx';
import { Lounge } from '../../components/Lounge.tsx';
import { LeftSidebarLoggedIn } from '../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../components/composer-modal-context.tsx';
import { NewPostComposer } from '../../components/NewPostComposer.tsx';
import { UnreadMessagesProvider } from '../../components/unread-messages-context.tsx';
import { LoginRequiredGate } from '../../components/LoginRequiredGate.tsx';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchCategoryTreeAndPopular, fetchPublicCategoryTree, writableCommunityCategories } from '../../lib/categories.ts';
import { fetchFollowing, type FollowingUser } from '../../lib/relationships.ts';
import { hasUnreadMessages } from '../../lib/messages.ts';
import { fetchAccountSummary } from '../../lib/account.ts';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function LoungePage() {
  const userId = await getSessionUserId();
  if (!userId) {
    const { tree } = await fetchPublicCategoryTree().catch(() => ({ tree: [], popular: [] }));
    return <LoginRequiredGate categoryTree={tree} />;
  }

  const [categoryTreeAndPopular, account, following, unreadMessages] = await Promise.all([
    fetchCategoryTreeAndPopular(6),
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
      activeNav="lounge"
      following={following}
      categoryTree={gnbCategoryTree}
    />
  );

  return (
    <ComposerModalProvider>
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
        <Gnb sidebar={leftSidebar} profileHref={`/@${currentUsername}`} categoryTree={gnbCategoryTree} isLoggedIn={true} />
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

          {/* 🔒 사용자 지시(2026-10, "오른쪽 영역에 접속된 사용자 리스트도") —
              Lounge가 웹소켓 하나로 채팅(main)과 접속자 목록(aside)을 같이
              들고 있다가 Fragment로 나란히 내보낸다(Lounge.tsx 헤더 주석
              참고) — 이 grid(`.layout`)는 DOM 순서대로 칸을 채우므로 여기
              하나만 놓으면 center·right 칸에 각각 들어간다. */}
          <Lounge currentUsername={currentUsername ?? ''} />
        </div>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
