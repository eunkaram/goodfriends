import type { Category } from '../lib/categories.ts';
import type { FollowingUser } from '../lib/relationships.ts';
import type { PopularPost } from '../lib/popularity.ts';
import type { GnbCategoryGroup } from './Gnb.tsx';
import { NewPostButton } from './NewPostButton.tsx';
import { SubscribedCategoriesWidget } from './SubscribedCategoriesWidget.tsx';
import { CommunityPopup } from './CommunityPopup.tsx';
import styles from './HomeSidebars.module.css';

/**
 * 🔒 사용자 지시(2026-08) — GNB가 사라지면서 예전에 GNB 하단에 있던 5개
 * 링크+저작권 표기가 좌 사이드바 맨 아래로 옮겨왔다(artifact 실측 그대로).
 * `/about`·`/ads`는 "정적 페이지 신설" 라운드에서 아직 안 만들어졌다 —
 * 링크는 미리 걸어두고 페이지는 뒤이어 채운다.
 */
function SidebarFooter() {
  return (
    <div className={styles.footerBlock}>
      <nav className={styles.footerLinks}>
        <a href="/about">서비스소개</a>
        <a href="/terms">서비스약관</a>
        <a href="/privacy">개인정보취급방침</a>
        <a href="/help">HELP</a>
      </nav>
      <span className={styles.copyright}>© 2026 AI Community</span>
    </div>
  );
}

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

function PostsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h4" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/* 🔒 사용자 지시(2026-08) — GNB가 사라지면서 그 안에 있던 메시지 아이콘이
   좌 사이드바 nav 항목("Messages")으로 옮겨왔다(artifact 실측). */
function MessagesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.2L19.5 4.5l-5 15-2.6-6-6-1.3z" />
    </svg>
  );
}

function SavedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4.2L6 20V5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

// 🔒 사용자 지시(2026-08-22, "비로그인 좌측 메뉴의 카테고리도 로그인 좌측
// 메뉴의 카테고리처럼 아이콘과 들여쓰기를") — SubscribedCategoriesWidget.tsx
// 의 FolderIcon과 완전히 같은 SVG(로그인 사이드바 "구독 중" 항목 아이콘).
// 그 파일은 'use client'라 여기서 직접 import하지 않고, 이 파일의 다른
// 아이콘들(PostsIcon 등)과 같은 관례로 로컬에 복제한다.
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" />
    </svg>
  );
}

export interface LeftSidebarLoggedInProps {
  username: string;
  nickname: string;
  /** 🔒 사용자 지시(2026-08) — "좌측 사이드바 프로필 요약 카드"도 실제
   * 프로필 사진을 반영해야 한다. */
  avatarUrl: string;
  activeCategorySlug?: string;
  /** 🔒 사용자 지시(2026-08) — "마우스 클릭시 볼드처리 및 빨간색으로 고정
   * (페이지 이동시)". 어느 페이지에 있는지는 서버 컴포넌트라 pathname을
   * 직접 읽을 수 없어, `activeCategorySlug`와 같은 패턴으로 각 page.tsx가
   * 명시적으로 넘긴다. */
  activeNav?: 'posts' | 'profile' | 'messages' | 'saved';
  following: FollowingUser[];
  categoryTree: GnbCategoryGroup[];
}

/**
 * §11.7.1 좌 240 — "1.내 프로필 요약 2.나의 로그 4탭 3.구독 카테고리 4.팔로잉" +
 * New Post 진입점(사용자 지시, 2026-08). "나의 로그" 4탭은 전부 실제 페이지로
 * 연결된다 — Photo Albums(`/@{username}/albums`)·Friends(`/@{username}/friends`)도
 * 이번에 함께 만들었다(components/HomeSidebars.tsx 밖, app/@[username]/... 참고).
 * 🔒 "구독 중" 목록은 `SubscribedCategoriesWidget`(별도 클라이언트 컴포넌트)이
 * `SubscriptionsProvider` Context에서 직접 읽는다 — 구독 버튼과 새로고침 없이
 * 동기화하기 위해서다(사용자 발견, 2026-08). 그래서 이 컴포넌트는 더 이상
 * `subscribed` prop을 받지 않는다.
 *
 * 🔒 사용자 지시(2026-08, "좌측 메뉴 디자인을 목업 좌측메뉴와 일치하게
 * 만들어") — artifact 좌 사이드바(디코딩 원본 line 242-311)를 다시 정독해
 * 재구성했다. 이전 구조는 프로필 카드·"나의 로그"·Community·"구독 중"·
 * "팔로잉" 각각을 `.widget`(padding+border-bottom 구분선)으로 감쌌는데,
 * artifact는 이 구분선 자체가 없다 — 로고→프로필→nav→푸터를 `gap:30px`
 * 순수 간격만으로 나눈다. nav 안에서도 artifact는 "New Post~Saved"와
 * "Community+카테고리"를 각각 `gap:2px`인 두 그룹으로, 그 사이만 `gap:20px`로
 * 띄운다 — "나의 로그"·"구독 중" 같은 `<h3>` 헤딩 자체가 artifact엔 없다.
 * 🔒 후속(2026-08, "좌측 메뉴 리스트를 New Post/Posts/Profile/Messages/
 * Saved로 해줘. 커뮤니티 아래는 건들지마") — 위에서 "artifact엔 없지만
 * 실동작 기능이라 유지"했던 Photo Albums·Friends를 이번엔 명시적으로
 * 뺐다 — artifact의 5개 nav 항목과 정확히 일치시킨다. 두 페이지
 * (`/@{username}/albums`, `/@{username}/friends`) 자체는 그대로 남아있고
 * URL로 직접 접근하면 여전히 동작한다 — 이 nav 리스트에서만 링크를 뺐다.
 */
export function LeftSidebarLoggedIn({
  username,
  nickname,
  avatarUrl,
  activeCategorySlug,
  activeNav,
  following,
  categoryTree,
}: LeftSidebarLoggedInProps) {
  const navClass = (key: NonNullable<LeftSidebarLoggedInProps['activeNav']>) =>
    activeNav === key ? `${styles.iconItem} ${styles.iconItemActive}` : styles.iconItem;
  return (
    <div className={styles.sidebarStack}>
      <a className={styles.logoLink} href="/" aria-label="Reafy">
        Reafy
      </a>

      <a className={styles.profileLink} href={`/@${username}`}>
        {avatarUrl ? <img src={avatarUrl} alt="" className={styles.avatar} /> : <span className={styles.avatar}>{initial(nickname)}</span>}
        <span className={styles.profileMeta}>
          <span className={styles.profileName}>{nickname}</span>
          <span className={styles.profileLocation}>@{username}</span>
        </span>
      </a>

      <nav className={styles.navGroups}>
        {/* 🔒 사용자 지시(2026-08, 스크린샷 — "좌측메뉴에서 이부분도 빼줘",
            New Post/Posts/Profile/Messages/Saved를 가리킴) — phone 드로어에서만
            뺀다(사용자 확인, AskUserQuestion — PC·pad는 artifact 그대로
            유지). 이 컴포넌트 자체(PC·pad가 쓰는 것과 완전히 같은 인스턴스)는
            안 바꾸고, `primary-nav-group` 글로벌 마커 클래스만 얹어 Gnb.module.css
            의 `.drawer-sidebar` 안에서만 숨긴다(css module 해시를 건너뛰는
            `:global()` 다리 — 자세한 설명은 그쪽 참고). */}
        <div className={`${styles.navGroup} primary-nav-group`}>
          <NewPostButton />
          {/* 🔒 사용자 지시(2026-08) — "좌측 Posts메뉴는... 목업의 Saved 리스트
              페이지를 참고해서 똑같이 만들어줘". artifact는 `showMyPosts`를
              `showProfile`과 별개 화면으로 두고 있어(디코딩 원본 line 539)
              Posts를 Profile과 분리된 전용 경로로 옮겼다. 🔒 후속(2026-08,
              "메뉴 링크는 /posts야") — 처음엔 `/@{username}/posts`였는데,
              Saved·Messages와 같은 이유로("이 메뉴는 항상 내 글만 다룬다")
              username 없는 plain 경로로 옮겼다 — `app/posts/page.tsx`
              (components/LogPostsFeed.tsx). Profile은 그대로 `/@{username}`. */}
          <a className={navClass('posts')} href="/posts">
            <PostsIcon />
            Posts
          </a>
          <a className={navClass('profile')} href={`/@${username}`}>
            <ProfileIcon />
            Profile
          </a>
          {/* 🔒 사용자 지시(2026-08) — GNB가 사라지며 Messages/Saved가 artifact
              실측대로 1급 nav 항목으로 좌 사이드바에 들어왔다. */}
          <a className={navClass('messages')} href="/messages">
            <MessagesIcon />
            {/* 🔒 사용자 지시(2026-08-25, "왼쪽메뉴 message바로 옆에 아이콘을
                붙여줘") — .iconItem의 gap(아이콘↔이 그룹 간격)과 별개로,
                텍스트와 배지만 훨씬 좁은 간격으로 묶는다. */}
            <span className={styles.navLabelWithBadge}>
              Messages
            </span>
          </a>
          <a className={navClass('saved')} href="/saved">
            <SavedIcon />
            Saved
          </a>
        </div>

        <div className={styles.navGroup}>
          <CommunityPopup categoryTree={categoryTree} isLoggedIn={true} />
          <SubscribedCategoriesWidget activeCategorySlug={activeCategorySlug} categoryTree={categoryTree} />
        </div>
      </nav>

      {following.length > 0 && (
        <div>
          <span className={styles.sectionLabel}>Following</span>
          <nav className={styles.navGroup}>
            {following.map((f) => (
              <a key={f.id} className={styles.followItem} href={`/@${f.username}`}>
                <span className={styles.avatarSm}>{initial(f.nickname)}</span>
                {f.nickname}
              </a>
            ))}
          </nav>
        </div>
      )}

      <SidebarFooter />
    </div>
  );
}

/**
 * §11.7.2 — 3단 구성이 성립하지 않는다. 가입 유도 + 인기 카테고리 5개(전체
 * 목록 아님 — 메가메뉴 몫). 🔒 사용자 지시(2026-08, "좌측 메뉴 디자인을
 * 목업 좌측메뉴와 일치하게 만들어") — artifact `loggedOutMode` 실측
 * (디코딩 원본 line 255-263): 버튼 순서가 로그인이 먼저, 회원가입이
 * 나중이다(기존엔 반대) — 그대로 맞췄다. `.widget` 구분선도 로그인 사이드바와
 * 같은 이유로 걷어내고 `.sidebarStack`의 순수 gap 간격으로 교체.
 */
export function LeftSidebarLoggedOut({
  popularCategories,
  categoryTree = [],
}: {
  popularCategories: Category[];
  /** artifact는 로그인 여부와 무관하게 Community 트리거를 보여준다 — 카테고리 열람엔 로그인이 필요 없어서다. */
  categoryTree?: GnbCategoryGroup[];
}) {
  return (
    <div className={styles.sidebarStack}>
      <a className={styles.logoLink} href="/" aria-label="Reafy">
        Reafy
      </a>
      <div className={styles.loggedOutIntro}>
        <p className={styles.intro}>세상을 읽고, 나를 기록하는 커뮤니티</p>
        <div className={styles.authBtns}>
          <a className={styles.secondaryBtn} href="/signin">
            로그인
          </a>
          <a className={styles.primaryBtn} href="/signup">
            회원가입
          </a>
        </div>
      </div>
      {/* 🔒 사용자 지시(2026-08-22, "비로그인 화면에서 좌측메뉴의 community는
          제거해줘. 아래의 인기카테고리만 남겨줘") — Community 트리거(전체
          카테고리 메가메뉴)를 비로그인 사이드바에서만 제거했다. 로그인
          사이드바(LeftSidebarLoggedIn)는 그대로 유지, 모바일은 Gnb.tsx
          자체의 CommunityPopupModal 트리거로 여전히 접근 가능하다. */}
      <div>
        <span className={styles.sectionLabel}>인기 카테고리</span>
        {/* 🔒 사용자 지시(2026-08-22) — 로그인 사이드바의 "구독 중" 목록
            (SubscribedCategoriesWidget)과 같은 아이콘+들여쓰기(.iconItem)로 통일. */}
        <nav className={styles.navGroup}>
          {popularCategories.map((c) => (
            <a key={c.id} className={styles.iconItem} href={`/${c.slug}`}>
              <FolderIcon />
              {c.name}
            </a>
          ))}
        </nav>
      </div>
      <SidebarFooter />
    </div>
  );
}

export interface RightSidebarProps {
  popularPosts: PopularPost[];
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.8" cy="10.8" r="6.1" />
      <path d="M19 19l-3.8-3.8" />
    </svg>
  );
}

/**
 * §11.7.0 우 300 — 동시 노출 위젯 최대 3개(인기 글·신규 마켓·SPONSORED).
 * 🔒 사용자 지시(2026-08-24, "우측메뉴에서 추천 카테고리 제거하고 광고부분
 * 표시") — 예전엔 구독 3개 미만인 신규 사용자에게 콜드스타트 방어로 추천
 * 카테고리를 SPONSORED보다 우선 노출했다(§11.7.0 "확정된 결정"). 이제
 * 그 자리는 SPONSORED로 고정 — 콜드스타트 유도는 좌 사이드바의 "여기서
 * 구독하세요" 안내(`SubscribedCategoriesWidget.tsx`)로 옮겨졌다.
 * 🔒 이 앱엔 광고 서빙 인프라 자체가 없다(§17.3에도 언급 없음, ad 서버는
 * 아예 범위 밖) — 그래서 이 위젯은 실제 광고주 데이터를 붙이는 게 아니라
 * "광고 영역" 표시 + `/ads`(광고/제휴문의) 링크만 있는 회색 톤 자리표시자다
 * (사용자 지시, 2026-09-05 — "비활성화 처리(회색)... 광고문의/광고영역이라는
 * 표시"). "전체검색"도 백엔드 자체가 없어(§6.8은 PRD에 계획만 있고 미착수)
 * 자리만 잡아둔 disabled 입력창이다 — 다른 미구현 기능들(이미지 업로드
 * 등)과 같은 패턴.
 * 🔒 사용자 지시(2026-09-05, "오른쪽에 마켓 부분도 안보이게 처리") — "신규
 * 마켓" 위젯을 숨겼다. 데이터는 여전히 호출부(app/page.tsx 등)가
 * `newMarketPosts`로 넘겨주지만 여기서 안 그린다 — 나중에 다시 켜야 하면
 * 이 prop 자체는 그대로 있다.
 */
export function RightSidebar({ popularPosts }: RightSidebarProps) {
  return (
    <div>
      {/* M2 — 1차 공개 검색이 백엔드(/api/posts/search, §6.8 bigm 계약)로
          실렸다. disabled placeholder였던 입력창을 GET form으로 교체 — 비로그인
          서버 컴포넌트 기반이라 검색은 /search 페이지가 서버에서 처리한다. */}
      <form className={styles.searchBox} action="/search" role="search">
        <SearchIcon />
        <input type="text" name="q" placeholder="전체검색" title="글 제목·본문 접두어로 검색" />
      </form>

      <div className={styles.widget}>
        <h3 className={styles.rightWidgetTitle}>인기 글</h3>
        {popularPosts.length === 0 ? (
          <p className={styles.intro}>아직 인기 글이 없어요.</p>
        ) : (
          <ol className={styles.rankedList}>
            {popularPosts.map((p, i) => (
              <li key={p.id}>
                <span className={styles.rank}>{String(i + 1).padStart(2, '0')}</span>
                <a className={styles.item} href={p.categorySlug ? `/${p.categorySlug}/${p.publicId}` : `/post/${p.publicId}`} title={p.title}>
                  {p.title}
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
