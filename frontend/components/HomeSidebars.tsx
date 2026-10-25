import type { FollowingUser } from '../lib/relationships.ts';
import type { PopularPost } from '../lib/popularity.ts';
import type { GnbCategoryGroup } from './Gnb.tsx';
import { NewPostButton } from './NewPostButton.tsx';
import { GlobalSearch } from './GlobalSearch.tsx';
import { MessagesNavBadge } from './MessagesNavBadge.tsx';
import { SITE_NAME, SITE_TAGLINE } from '../lib/site.ts';
import styles from './HomeSidebars.module.css';

/** goodfriends-ui/source/Main.dc.html NAV_ICONS 그대로 이식(CLAUDE.md 2. 디자인 기준).
 * 표시명이 아니라 slug로 찾는다 — 메뉴명이 바뀌어도(i18n 한 곳만 수정) 아이콘이
 * 사라지지 않게 하기 위해서다. */
type IconPart = [tag: 'path' | 'circle' | 'rect', props: Record<string, unknown>];
const CATEGORY_ICONS: Record<string, IconPart[]> = {
  news: [
    ['path', { d: 'M5 5h11v14H6.2A1.2 1.2 0 0 1 5 17.8z' }],
    ['path', { d: 'M16 9h3v8.8a1.2 1.2 0 0 1-2.4 0V9' }],
    ['path', { d: 'M8 9h5M8 12h5M8 15h3' }],
  ],
  qna: [
    ['circle', { cx: 12, cy: 12, r: 8.2 }],
    ['path', { d: 'M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4' }],
    ['circle', { cx: 12, cy: 16.6, r: 0.7, fill: 'currentColor' }],
  ],
  idea: [
    ['path', { d: 'M12 3.8a5.6 5.6 0 0 0-3.4 10.1c.6.5.9 1.1.9 1.8V17h5v-1.3c0-.7.3-1.3.9-1.8A5.6 5.6 0 0 0 12 3.8z' }],
    ['path', { d: 'M10 20.2h4' }],
  ],
  free: [
    ['path', { d: 'M4.5 5.5h10.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H9.5l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 12.5V7a1.5 1.5 0 0 1 1.5-1.5z' }],
    ['path', { d: 'M16.5 9.5h2.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H18v2.5l-3-2.5h-2.5a1.5 1.5 0 0 1-1.5-1.5' }],
  ],
  frontier: [
    ['path', { d: 'M11 4.5l1.7 4.6 4.6 1.7-4.6 1.7L11 17.1l-1.7-4.6-4.6-1.7 4.6-1.7z' }],
    ['path', { d: 'M18 14.5v4M16 16.5h4' }],
  ],
  local: [
    ['rect', { x: 4, y: 5, width: 16, height: 11, rx: 1.8 }],
    ['path', { d: 'M9 19.5h6M12 16v3.5' }],
    ['path', { d: 'M8 9.5l2 1.5-2 1.5M12 12.5h3' }],
  ],
  agents: [
    ['rect', { x: 5.5, y: 8, width: 13, height: 10.5, rx: 3 }],
    ['path', { d: 'M12 8V5.5' }],
    ['circle', { cx: 12, cy: 4.6, r: 1.1 }],
    ['circle', { cx: 9.6, cy: 12.6, r: 0.9, fill: 'currentColor' }],
    ['circle', { cx: 14.4, cy: 12.6, r: 0.9, fill: 'currentColor' }],
    ['path', { d: 'M10.2 15.4h3.6' }],
  ],
  aiservice: [
    ['rect', { x: 4.5, y: 4.5, width: 6, height: 6, rx: 1.6 }],
    ['rect', { x: 13.5, y: 4.5, width: 6, height: 6, rx: 1.6 }],
    ['rect', { x: 4.5, y: 13.5, width: 6, height: 6, rx: 1.6 }],
    ['rect', { x: 13.5, y: 13.5, width: 6, height: 6, rx: 1.6 }],
  ],
  coding: [['path', { d: 'M8.5 8l-4 4 4 4M15.5 8l4 4-4 4M13.4 5.5l-2.8 13' }]],
  automation: [['path', { d: 'M13 3.5L5.5 13.5H12l-1 7 7.5-10H12z' }]],
  creative: [
    ['path', { d: 'M12 4a8 8 0 1 0 0 16c1.1 0 1.6-.8 1.4-1.7-.2-1 .5-1.9 1.6-1.9h1.6a3.4 3.4 0 0 0 3.4-3.4C20 7.3 16.4 4 12 4z' }],
    ['circle', { cx: 8.3, cy: 11.2, r: 1, fill: 'currentColor' }],
    ['circle', { cx: 11, cy: 7.8, r: 1, fill: 'currentColor' }],
    ['circle', { cx: 15.2, cy: 8.4, r: 1, fill: 'currentColor' }],
  ],
};

function CategoryIcon({ slug, className }: { slug: string; className?: string }) {
  const parts = CATEGORY_ICONS[slug] ?? [];
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {parts.map(([Tag, props], i) => (
        <Tag key={i} {...props} />
      ))}
    </svg>
  );
}

/** CLAUDE.md 2. 좌측 메뉴 아이콘 색(그룹별 고정색) — styles/tokens.css --icon-*. */
const GROUP_COLOR_CLASS: Record<string, string> = {
  커뮤니티: 'catCommunity',
  '모델·도구': 'catTools',
  '활용 분야': 'catUsecase',
};

/**
 * CLAUDE.md 4. 메뉴 구조 — 좌측 메뉴는 백엔드 카테고리 트리(0053 — goodfriends
 * 3그룹·11카테고리) 단일 소스를 그대로 그룹 라벨+아이콘으로 나열한다. 이전
 * "Community" 팝업 트리거(CommunityPopup)·"구독 중" 토글(SubscribedCategoriesWidget)은
 * goodfriends 시안에 없다 — 전부 상시 펼쳐진 평면 목록이고(원본 디코딩
 * line 113-122), "게시판 구독" 자체가 CLAUDE.md 3. "넣지 않기로 한 기능"에
 * 명시돼 있다. */
function CategoryNav({ categoryTree, activeCategorySlug }: { categoryTree: GnbCategoryGroup[]; activeCategorySlug?: string }) {
  return (
    <div className={styles.navGroup}>
      {categoryTree.map((group) => (
        <div key={group.name} className={styles.navSubGroup}>
          <span className={styles.sectionLabel}>{group.name}</span>
          {group.children.map((cat) => {
            const groupColorClass = GROUP_COLOR_CLASS[group.name];
            const classNames = [styles.iconItem, activeCategorySlug === cat.slug ? styles.iconItemActive : ''].filter(Boolean).join(' ');
            return (
              <a key={cat.id} href={`/${cat.slug}`} className={classNames}>
                <CategoryIcon slug={cat.slug} className={groupColorClass ? styles[groupColorClass] : undefined} />
                {cat.name}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * 🔒 사용자 지시(2026-08) — GNB가 사라지면서 예전에 GNB 하단에 있던 링크+
 * 저작권 표기가 좌 사이드바 맨 아래로 옮겨왔다. 🔒 goodfriends 리브랜딩(2026-10,
 * CLAUDE.md 4) — "광고/제휴문의" 링크 추가(시안 실측, 디코딩 원본 line 128).
 * `/ads` 페이지는 아직 없다 — 링크는 미리 걸어두고 페이지는 뒤이어 채운다.
 */
function SidebarFooter() {
  return (
    <div className={styles.footerBlock}>
      <nav className={styles.footerLinks}>
        <a href="/about">서비스소개</a>
        <a href="/ads">광고/제휴문의</a>
        <a href="/terms">서비스약관</a>
        <a href="/privacy">개인정보취급방침</a>
        <a href="/help">HELP</a>
      </nav>
      <span className={styles.copyright}>© 2026 GoodFriends</span>
    </div>
  );
}

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
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

/* 🔒 버그 수정(2026-10) — /lounge(실시간 그룹 채팅)가 어디서도 링크되지
   않아 URL을 직접 치지 않으면 발견할 길이 없었다. */
function LoungeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5h16v11H9l-3.5 3.5V16.5H4z" />
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
  activeNav?: 'posts' | 'profile' | 'messages' | 'saved' | 'lounge';
  /** 🔒 사용자 지시(2026-10, "news일때는 new post 클릭이 안되게... 비활성화") —
   * News 카테고리/글 상세 페이지가 News를 작성 못 하는 유저에게 넘긴다. */
  newPostDisabled?: boolean;
  following: FollowingUser[];
  categoryTree: GnbCategoryGroup[];
}

/**
 * goodfriends 좌 사이드바(CLAUDE.md 2·3·4, 디코딩 원본 line 78-135) —
 * 로고 → 프로필 요약(닉네임만, @아이디 없음) → nav(New Post/Profile/
 * Messages + 커뮤니티/모델·도구/활용 분야 카테고리) → 팔로잉(있으면) → 푸터,
 * 전부 `gap:30px` 순수 간격이고 구분선이 없다. "구독 중" 토글·Community
 * 팝업·Posts·Saved 좌측 메뉴 항목은 CLAUDE.md 3. "넣지 않기로 한 기능"이라
 * 뺐다 — `/posts`·`/saved` 페이지 자체는 그대로 있고 URL로 접근 가능하다.
 */
export function LeftSidebarLoggedIn({
  username,
  nickname,
  avatarUrl,
  activeCategorySlug,
  activeNav,
  newPostDisabled,
  following,
  categoryTree,
}: LeftSidebarLoggedInProps) {
  const navClass = (key: NonNullable<LeftSidebarLoggedInProps['activeNav']>) =>
    activeNav === key ? `${styles.iconItem} ${styles.iconItemActive}` : styles.iconItem;
  return (
    <div className={styles.sidebarStack}>
      <a className={styles.logoLink} href="/" aria-label={SITE_NAME}>
        <img src="/gf/images/logo-mark.png" alt="" className={styles.logoMark} />
        <span className={styles.logoWordmark}>goodfriends</span>
      </a>

      {/* 🔒 CLAUDE.md 3. 정해진 제품 규칙 — "실명과 @아이디는 어떤 화면에도
          노출하지 않는다(아이디는 프로필 편집 화면에서만)". goodfriends 시안
          좌측 프로필 카드도 닉네임 아래 고정 문구("Community Member")만
          보여주고 @아이디는 없다(디코딩 원본 line 83-89) — @{username} 제거. */}
      <a className={styles.profileLink} href={`/@${username}`}>
        {avatarUrl ? <img src={avatarUrl} alt="" className={styles.avatar} /> : <span className={styles.avatar}>{initial(nickname)}</span>}
        <span className={styles.profileMeta}>
          <span className={styles.profileName}>{nickname}</span>
          <span className={styles.profileLocation}>Community Member</span>
        </span>
      </a>

      <nav className={styles.navGroups}>
        {/* 🔒 CLAUDE.md 3. "넣지 않기로 한 기능" — 좌측 메뉴 Posts·Saved 제거.
            New Post/Profile/Messages/Lounge만 남는다(디코딩 원본 line 103-111,
            Lounge는 버그 수정으로 2026-10 추가 — /lounge가 아무 데서도
            링크되지 않던 문제). */}
        <div className={`${styles.navGroup} primary-nav-group`}>
          <NewPostButton disabled={newPostDisabled} />
          <a className={navClass('profile')} href={`/@${username}`}>
            <ProfileIcon />
            Profile
          </a>
          <a className={navClass('messages')} href="/messages">
            <MessagesIcon />
            <span className={styles.navLabelWithBadge}>
              Messages
              <MessagesNavBadge />
            </span>
          </a>
          <a className={navClass('lounge')} href="/lounge">
            <LoungeIcon />
            Lounge
          </a>
        </div>

        <CategoryNav categoryTree={categoryTree} activeCategorySlug={activeCategorySlug} />
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
 * 3단 구성이 성립하지 않는다 — 가입 유도(태그라인+로그인/회원가입 버튼) +
 * 로그인 사이드바와 동일한 전체 카테고리 목록(CategoryNav). 버튼 순서는
 * 로그인이 먼저, 회원가입이 나중(goodfriends 시안 실측).
 */
export function LeftSidebarLoggedOut({
  categoryTree = [],
  activeCategorySlug,
}: {
  /** 🔒 goodfriends 리브랜딩(2026-10) 이후 미사용 — CategoryNav로 교체되며
   * "인기 카테고리" 섹션 자체가 없어졌다. 호출부(app/page.tsx 등)가 여전히
   * 넘기므로 타입만 유지하고 받지 않는다(breaking change 아님). */
  popularCategories?: { id: string; name: string; slug: string }[];
  categoryTree?: GnbCategoryGroup[];
  activeCategorySlug?: string;
}) {
  return (
    <div className={styles.sidebarStack}>
      <a className={styles.logoLink} href="/" aria-label={SITE_NAME}>
        <img src="/gf/images/logo-mark.png" alt="" className={styles.logoMark} />
        <span className={styles.logoWordmark}>goodfriends</span>
      </a>
      <div className={styles.loggedOutIntro}>
        <p className={styles.intro}>{SITE_TAGLINE}</p>
        <div className={styles.authBtns}>
          <a className={styles.secondaryBtn} href="/signin">
            로그인
          </a>
          <a className={styles.primaryBtn} href="/signup">
            회원가입
          </a>
        </div>
      </div>
      {/* 🔒 goodfriends 리브랜딩(2026-10) — 시안은 로그인 여부와 무관하게
          같은 카테고리 목록을 보여준다(디코딩 원본 line 101-123에 loggedOutMode
          분기가 없다) — "인기 카테고리 5개"였던 이전 버전을 로그인 사이드바와
          동일한 CategoryNav(커뮤니티/모델·도구/활용 분야 전체)로 교체. */}
      <CategoryNav categoryTree={categoryTree} activeCategorySlug={activeCategorySlug} />
      <SidebarFooter />
    </div>
  );
}

export interface RightSidebarProps {
  popularPosts: PopularPost[];
}

/**
 * §11.7.0 우 300 — 동시 노출 위젯 최대 3개(TRENDING NOW·신규 마켓·SPONSORED).
 * 🔒 사용자 지시(2026-08-24, "우측메뉴에서 추천 카테고리 제거하고 광고부분
 * 표시") — 예전엔 구독 3개 미만인 신규 사용자에게 콜드스타트 방어로 추천
 * 카테고리를 SPONSORED보다 우선 노출했다(§11.7.0 "확정된 결정"). 이제
 * 그 자리는 SPONSORED로 고정 — 콜드스타트 유도는 좌 사이드바의 "여기서
 * 구독하세요" 안내(`SubscribedCategoriesWidget.tsx`)로 옮겨졌다.
 * 🔒 이 앱엔 광고 서빙 인프라 자체가 없다(§17.3에도 언급 없음, ad 서버는
 * 아예 범위 밖) — 그래서 SPONSORED 위젯은 실제 광고주 데이터를 붙이는 게
 * 아니라 "광고 영역" 표시 + `/ads`(광고/제휴문의) 링크만 있는 회색 톤
 * 자리표시자다(사용자 지시, 2026-09-05 — "비활성화 처리(회색)...
 * 광고문의/광고영역이라는 표시"). 🔒 사용자 발견(2026-10, "오른쪽 섹션도
 * 디자인 시안처럼... 광고영역을 넣어줘") — CSS는 이미 그 결정대로 만들어져
 * 있었는데 JSX에서 빠져 있었다 — 아래에서 다시 연결한다.
 * 🔒 사용자 지시(2026-09-05, "오른쪽에 마켓 부분도 안보이게 처리") — "신규
 * 마켓" 위젯을 숨겼다. 데이터는 여전히 호출부(app/page.tsx 등)가
 * `newMarketPosts`로 넘겨주지만 여기서 안 그린다 — 나중에 다시 켜야 하면
 * 이 prop 자체는 그대로 있다.
 * 🔒 "TRENDING NOW" — artifact 원본(Main.dc.html)은 이 자리에 트렌딩
 * "카테고리"+지어낸 한 줄 설명을 보여주지만, 그 설명 문구는 실제 집계가
 * 아니라 mock 카피다(이 프로젝트 전반의 "실제로 없는 사실은 지어내지
 * 않는다" 원칙과 충돌 — lib/static-pages.ts와 같은 기준). 대신 이미 실제
 * 데이터로 집계되는 "인기 글"(popularPosts, §5.1)을 같은 라벨로만 바꿔
 * 보여준다 — 순위·링크 구조는 artifact의 TRENDING NOW와 동일(1~3위 +
 * 제목), 내용은 지어내지 않고 실데이터 그대로.
 */
export function RightSidebar({ popularPosts }: RightSidebarProps) {
  return (
    <div>
      {/* 🔒 사용자 요청(2026-10, "오른쪽 영역의 전체 검색") — 입력 즉시
          제목/본문을 합친 결과를 보여주는 클라이언트 검색으로 교체. Enter는
          기존처럼 /search 전체 결과 페이지로 이동한다. */}
      <GlobalSearch />

      <div className={styles.widget}>
        <h3 className={styles.rightWidgetTitle}>TRENDING NOW</h3>
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

      <div className={styles.widget}>
        <div className={styles.sponsoredHead}>
          <h3 className={styles.rightWidgetTitle} style={{ margin: 0 }}>
            SPONSORED
          </h3>
        </div>
        <a className={styles.sponsoredCard} href="/ads">
          <div className={styles.sponsoredImage} aria-hidden="true" />
          <div className={styles.sponsoredBody}>
            <span className={styles.sponsoredTitle}>광고 영역</span>
            <span className={styles.sponsoredDesc}>이 자리에 광고를 실을 수 있어요.</span>
            <span className={styles.sponsoredCta}>광고 문의</span>
          </div>
        </a>
      </div>
    </div>
  );
}
