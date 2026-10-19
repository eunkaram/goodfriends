'use client';

import { useState, type ReactNode } from 'react';
import { useModalOpenEffect } from './use-modal-open-effect.ts';
import { useComposerModal } from './composer-modal-context.tsx';
import { CommunityPopupModal } from './CommunityPopup.tsx';
import styles from './Gnb.module.css';

/**
 * 🔒 사용자 지시(2026-08) — "목업에는 gnb, 메가메뉴가 없어졌어. 모든 UI는
 * 목업디자인을 절대적으로 따라가야해". Claude Design 확정안엔 데스크톱
 * GNB가 없다 — 그 역할은 좌 사이드바(HomeSidebars.tsx)와 그 안의
 * `CommunityPopup`이 흡수했다. 이 파일은 이제 **모바일 폴백 전용**이다.
 *
 * 🔒 후속(2026-08, 새 interactive 목업 — pc/pad/phone 3단 반응형) — 이전엔
 * "사이드바가 숨는 지점(1280px)부터 햄버거+드로어" 딱 하나의 폴백만 있었다.
 * 새 목업은 pad(768~1279px)에서 사이드바를 숨기지 않고 208px로 좁혀서
 * 그대로 보여준다(app/*.module.css 쪽 그리드가 담당) — 그래서 이 햄버거
 * 폴백은 이제 phone(<768px)에서만 나타난다(`.mobileOnly`를 768px로 낮춤,
 * Gnb.module.css). 드로어 안은 각 페이지의 좌 사이드바(`sidebar` prop)를
 * PC와 완전히 동일하게 그대로 보여준다(사용자 지시, 2026-08 — "PC용 레프트
 * 메뉴를 수정없이 그대로 사용해") — 아바타·New Post를 숨기던 CSS도 걷어냈다
 * (HomeSidebars.module.css 참고).
 *
 * 🔒 새로 생긴 phone 하단 고정 탭바(Home/Saved/글쓰기/Messages/Profile) —
 * artifact 실측(디코딩 원본 line 51-67) 그대로. **CLAUDE.md/PRD.md §11.3.1의
 * "모바일 하단 탭바 없음" 확정 결정을 이 라운드에서 뒤집었다**(사용자 확인,
 * AskUserQuestion) — 문서도 같이 정정했다. 이전엔 메시지·알림 진입점을
 * "GNB 상시 고정"으로 확보하는 게 §6.6 성립 조건이었는데, 그 GNB 자체가
 * 데스크톱에서 이미 사라진 지 오래고(위 문단) 실제 메시지 진입점은 좌
 * 사이드바 nav 항목이 맡고 있었다 — 탭바의 Messages 탭이 그 역할을 이제
 * phone에서도 1탭으로 대신한다. 상단 헤더의 message/bell/avatar 아이콘은
 * 그래서 뺐다 — 애초에 onClick이 없어 눌러도 아무 일도 안 일어나던
 * 죽은 코드였고(unreadMessages/unreadNotifications/avatarInitial 모두
 * 아무 호출부도 값을 넘긴 적이 없다), artifact 상단 헤더에도 없다(햄버거·
 * 로고·Community 격자 아이콘 3개뿐). 🔒 후속(2026-08, "오른쪽 상단
 * 메뉴버튼 클릭하면 community categories 팝업을 띄워주고") — 격자
 * 아이콘은 이제 드로어를 거치지 않고 `CommunityPopupModal`을 자기 로컬
 * state로 직접 연다(드로어 안 "Community" 트리거는 반대로 CSS로 클릭을
 * 막았다 — `Gnb.module.css` `.sidebarCommunityBtn` 규칙 참고).
 *
 * 새 글쓰기 진입점은 이제 pad(사이드바의 New Post 항목)·phone(탭바 중앙
 * "+") 각 티어가 자기 자리에서 커버해서, 화면 우하단 플로팅 버튼
 * (FloatingNewPostButton.tsx)은 더 이상 어느 폭에서도 필요하지 않아 이번에
 * 완전히 걷어냈다(사용자 확인).
 *
 * 🔒 후속(2026-08 — "애니메이션 효과가 있으면 더 좋을것 같아") — 드로어를
 * 조건부 렌더(`{drawerOpen && (...)}`)에서 항상 마운트로 바꿨다:
 * `transform`에 CSS transition을 걸어야 슬라이드 애니메이션이 나오는데,
 * 마운트 자체가 열고 닫힐 때마다 반복되면 트랜지션이 걸릴 새 없이
 * 순간이동해버린다(마운트 직후 첫 렌더는 트랜지션이 안 먹는다 — 브라우저가
 * "새로 생긴 요소"의 시작 상태를 transition 없이 그대로 페인트하기
 * 때문). 대신 `data-open` 어트리뷰트 + `Gnb.module.css`의 `transform`/
 * `transition`으로 열림·닫힘을 표현한다(햄버거·오버레이 클릭 둘 다
 * 이 트랜지션 하나로 애니메이션된다).
 * 🔒 후속(2026-08, "드래그 기능 제거 해줘") — 화면 왼쪽 끝에서 드래그로
 * 여닫는 제스처(window 레벨 touch 리스너, 엣지 판정, 축 잠금, 스냅
 * 임계값)를 한 라운드 먼저 넣었다가 이번에 통째로 걷어냈다 — 항상 마운트
 * 구조 자체는 애니메이션에 여전히 필요해서 남겨뒀고, 여닫기는 다시
 * 햄버거/격자 아이콘 클릭·오버레이 클릭 탭 전용이다.
 * 🔒 **알려진 트레이드오프** — 항상 마운트라 드로어가 닫혀 있어도(화면
 * 밖으로 `translateX`만 된 상태) `sidebar`의 링크들이 여전히 DOM에
 * 있다. `aria-hidden`은 걸어뒀지만 키보드 Tab 포커스까지는 막지 못한다
 * (`inert` 어트리뷰트가 정석이나 이 프로젝트 React 버전의 JSX 타입
 * 지원이 불확실해 안 썼다).
 */

export type GnbCategory = { id: string; name: string; slug: string };
export type GnbCategoryGroup = { name: string; children: GnbCategory[] };

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** artifact 실측 — 상단 헤더 오른쪽 "Community" 격자 아이콘(디코딩 원본 line 46-48). */
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

/** artifact 실측 — 하단 탭바(디코딩 원본 line 53-66). */
/* 🔒 사용자 지시(2026-08, "모바일 앱의 하단 메뉴... 아이콘들을 사용해줘") —
   reafy_mobile(RN 앱, `app/(tabs)/_layout.tsx`)이 쓰는 Ionicons 글리프
   (home-outline/bookmark-outline/chatbubbles-outline/person-circle-outline/add)
   그대로. Ionicons는 512 유닛 em 폰트라 좌표가 SVG와 반대(Y가 위로
   증가, 베이스라인=0)라서 `translate(0,480) scale(1,-1)`로 뒤집는다
   (font의 ascent=480, descent=-32 — 폰트 파일에서 실측). 웹엔 이 폰트
   패키지(@expo/vector-icons)를 새로 안 넣고, 그 폰트에서 뽑은 path만
   고정 SVG로 박아 넣었다 — 아이콘 4개 때문에 무거운 아이콘 폰트
   전체를 의존성으로 들일 이유가 없다. */
function IonIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 512 512">
      <g transform="translate(0,480) scale(1,-1)">
        <path d={d} fill="currentColor" />
      </g>
    </svg>
  );
}

function HomeIcon() {
  return (
    <IonIcon d="M244 414Q261 420 275 410Q277 408 307 380L336 352V371Q337 390 338 391Q341 397 347 399Q349 400 377 400H404L408 398Q412 395 414 392L416 388V331L417 275L454 239Q492 203 493 200Q497 196 495 188Q495 184 490.0 180.0Q485 176 480 176Q473 176 459 190L448 200V96Q448 -7 446 -11Q441 -24 427 -30L422 -32H369H316L312 -30Q308 -27 306 -24L304 -21V51L303 124L301 126L299 128H256H213L211 126L209 124L208 51V-21L206 -24Q204 -27 200 -30L196 -32H143H90L85 -30Q70 -24 66 -10Q64 -5 64.0 97.5Q64 200 63.5 200.0Q63 200 52 189Q36 173 26 177Q11 184 17 198Q19 201 31 213Q48 230 141.5 319.0Q235 408 237 410Q239 412 244 414ZM336 308Q257 384 256.5 384.0Q256 384 176 308L96 232V116V0H136H176V64V128L178 134Q185 149 200 157L205 159H256H307L312 157Q327 149 334 134L336 128V64V0H376H416V116V232ZM384 337V368H376H368V345V321L376 314L384 306Z" />
  );
}

function SavedIcon() {
  return (
    <IonIcon d="M145 414Q151 416 255.5 416.0Q360 416 366 414Q382 411 395.0 399.5Q408 388 412 373Q415 366 415.5 357.5Q416 349 416.0 164.5Q416 -20 415 -22Q412 -28 407 -30Q400 -34 393 -30Q390 -29 323 31L256 91L189 31Q122 -29 119 -30Q112 -34 105 -30Q100 -28 97 -22Q96 -20 96.0 164.5Q96 349 96.5 357.5Q97 366 100 373Q104 388 117.0 399.5Q130 411 145 414ZM365 381Q365 381 365 381L360 384H258Q157 384 153 383Q138 380 131 365Q131 365 128 360V190V20L187 72Q246 125 249.5 126.5Q253 128 256.0 128.0Q259 128 262.5 126.5Q266 125 325 72Q325 72 384 20V190V360L381 365Q376 376 365 381Z" />
  );
}

function MessagesIcon() {
  return (
    <IonIcon d="M265 414Q274 415 293.5 415.0Q313 415 322 413Q350 409 376 396Q413 378 439.0 346.5Q465 315 475 276Q493 202 453 138L447 130L455 100Q462 75 463.0 68.5Q464 62 461 56Q456 46 447 44Q439 41 403 54L370 66L355 61Q297 42 249 52Q205 61 170 89Q154 101 141 117Q115 149 106 189Q95 234 106 276Q119 327 158 363Q202 405 265 414ZM315 382Q287 386 260 381Q213 372 179.0 340.0Q145 308 136 264Q123 205 154 154Q176 120 210.5 100.0Q245 80 285 80Q310 80 345 92Q361 97 370 97H379L403 88Q427 80 427.5 80.0Q428 80 421.5 101.5Q415 123 415 128Q414 137 424 153Q444 184 447 220Q453 278 414.5 325.5Q376 373 315 382ZM61 231Q61 231 61 231Q69 234 75.5 229.0Q82 224 82 216Q82 212 78 203Q57 160 68 113Q73 94 85 74Q90 66 91 61Q91 61 92 56L88 31Q83 6 83.0 5.5Q83 5 105.0 13.5Q127 22 132 23Q139 24 155 19Q181 11 205 11Q239 11 271 27Q283 33 290.0 30.0Q297 27 300 20Q302 11 295 4Q289 -1 271.5 -8.0Q254 -15 240 -18Q194 -27 146 -11Q146 -11 137 -8L108 -20Q80 -31 76 -31Q63 -34 54 -23Q48 -16 48 -8Q48 -6 54 24Q54 24 60 54L56 60Q38 89 33 124Q30 146 34 168Q38 197 50 220Q55 229 61 231Z" />
  );
}

function ProfileIcon() {
  return (
    <IonIcon d="M241 399Q262 401 283 398Q332 392 373 364Q423 329 447 274Q484 187 444 102Q412 36 345 4Q275 -29 201 -9Q148 6 109.5 44.5Q71 83 56 135Q34 210 68 281Q83 313 108 338Q124 354 143 366Q188 396 241 399ZM284 366Q277 367 260.0 367.5Q243 368 236 367Q194 362 159 338Q90 292 81 209Q79 186 82 164Q90 116 122 78Q129 69 134 74Q147 91 162 101Q196 123 239 127Q301 133 350 101Q365 91 378 74Q383 69 390 78Q421 114 429 162Q431 172 431.5 191.0Q432 210 430 220Q420 277 380.5 316.5Q341 356 284 366ZM245 303Q245 303 245 303Q260 306 275 301Q310 291 321 258Q329 232 317.0 204.5Q305 177 280 166Q242 148 211 180Q194 198 189.5 222.5Q185 247 196 268Q210 298 245 303Z" />
  );
}

function PlusIcon() {
  return (
    <IonIcon d="M248 349Q248 349 248 349Q253 353 259.5 351.5Q266 350 270 344Q270 344 272 341V275V208H338H404L408 206Q416 201 416.0 192.0Q416 183 408 178Q408 178 405 176H339H272V109V43L270 40Q265 32 256.0 32.0Q247 32 242 40Q242 40 240 43V109V176H173H107L104 178Q96 183 96.0 192.0Q96 201 103 205Q103 205 107 208H173H240V275V341L242 344Q244 347 248 349Z" />
  );
}

export interface GnbProps {
  /** 각 페이지가 이미 만들어 둔 좌 사이드바(`LeftSidebarLoggedIn`/`LeftSidebarLoggedOut`
   * 또는 페이지 전용 위젯)를 그대로 받아 phone 드로어 안에 렌더링한다 — PC와
   * 100% 같은 구성을 보장한다(사용자 지시, 2026-08 — "PC용 레프트 메뉴를
   * 수정없이 그대로 사용해"). */
  sidebar?: ReactNode;
  /** phone 하단 탭바의 활성 탭 — artifact `tabHomeColor`/`tabSavedColor`/
   * `tabMessagesColor`/`tabProfileColor`와 같은 규칙(현재 페이지에 맞는 탭만
   * 액센트, 나머지는 뮤트). 5개 탭 중 "Posts"에 대응하는 항목이 artifact에
   * 없어(하단 탭바는 Home/Saved/글쓰기/Messages/Profile 5개뿐) `/posts`
   * 페이지는 이 prop을 안 넘긴다 — 다른 4탭과 마찬가지로 자기 자리가 없으면
   * 전부 비활성 상태로 둔다. */
  activeTab?: 'home' | 'saved' | 'messages' | 'profile';
  /** 하단 탭바 "Profile" 탭의 목적지 — 로그인 상태면 `/@{username}`, 아니면
   * `/signin`(saved·messages 페이지가 비로그인을 처리하는 것과 같은 패턴:
   * app/saved/page.tsx 참고). */
  profileHref?: string;
  /**
   * 🔒 사용자 지시(2026-08 — "phone 화면에서 오른쪽 상단 메뉴버튼 클릭하면
   * community categories 팝업을 띄워주고") — phone 헤더의 격자 아이콘이
   * 드로어를 거치지 않고 바로 여는 Community 모달용 데이터. 좌 사이드바가
   * 없는 페이지(albums/friends 게이트 화면 등)는 안 넘겨도 되고, 그때는
   * 빈 모달이 뜬다 — 이 페이지들은 애초에 좌 사이드바 자체가 없는 별도
   * 갭이라(Gnb.tsx 다른 주석 참고) 이번에도 범위 밖으로 남겨둔다.
   */
  categoryTree?: GnbCategoryGroup[];
  isLoggedIn?: boolean;
}

function TabBar({ activeTab, profileHref, isLoggedIn }: { activeTab?: GnbProps['activeTab']; profileHref: string; isLoggedIn: boolean }) {
  const { open } = useComposerModal();
  const cls = (key: NonNullable<GnbProps['activeTab']>) => (activeTab === key ? `${styles.tabItem} ${styles.tabItemActive}` : styles.tabItem);
  return (
    <nav className={styles.tabBar} aria-label="하단 메뉴">
      <a className={cls('home')} href="/">
        <HomeIcon />
        Home
      </a>
      <a className={cls('saved')} href="/saved">
        <SavedIcon />
        Saved
      </a>
      {/* 🔒 사용자 지시(2026-08-24, "new post를 안보이게 해서 진입점을 없애야")
          — PostComposerModal은 어차피 isLoggedIn && 안에서만 마운트돼 클릭해도
          아무 일도 안 났지만, 버튼 자체가 보이는 게 진입점이었다. */}
      {isLoggedIn && (
        <button type="button" className={styles.tabPlus} onClick={open} aria-label="새 글쓰기">
          <PlusIcon />
        </button>
      )}
      <a className={cls('messages')} href="/messages">
        <MessagesIcon />
        Messages
      </a>
      <a className={cls('profile')} href={profileHref}>
        <ProfileIcon />
        Profile
      </a>
    </nav>
  );
}

/** 유일하게 남은 렌더 함수 — phone 폴백(햄버거+드로어+하단 탭바). 위 `Gnb` export의 설명 참고. */
function MobileGnb({ sidebar, activeTab, profileHref = '/signin', categoryTree = [], isLoggedIn = false }: GnbProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  useModalOpenEffect(drawerOpen);

  return (
    <>
      <header className={styles.gnbMobile}>
        <button className={styles.iconBtn} onClick={() => setDrawerOpen(true)} aria-label="메뉴 열기">
          <HamburgerIcon />
        </button>
        <a className={styles.logo} href="/" aria-label="Reafy">
          <span className={styles.wordmark}>Reafy</span>
        </a>
        {/* 🔒 사용자 지시(2026-08 — "오른쪽 상단 메뉴버튼 클릭하면 community
            categories 팝업을 띄워주고") — 드로어를 거치지 않고 이 버튼
            자신의 state로 바로 CommunityPopupModal을 연다. */}
        <button
          className={styles.iconBtn}
          onClick={() => setCommunityOpen(true)}
          aria-haspopup="true"
          aria-expanded={communityOpen}
          aria-label="커뮤니티 카테고리 열기"
        >
          <GridIcon />
        </button>
      </header>

      <CommunityPopupModal open={communityOpen} onClose={() => setCommunityOpen(false)} categoryTree={categoryTree} isLoggedIn={isLoggedIn} />

      {/* 🔒 사용자 지시(2026-08, 스크린샷 — "왼쪽메뉴에서 이부분은 제거 해줘",
          "메뉴"+X 닫기 바를 가리킴) — artifact 드로어 사이드바는 로고부터
          바로 시작하고 이런 헤더 바 자체가 없다(디코딩 원본 line 77 참고,
          Gnb.tsx 위쪽 설명). 닫기는 배경(`.drawerOverlay`) 클릭으로 가능하다.
          🔒 후속(2026-08, "애니메이션 효과가 있으면 더 좋을것 같아") —
          조건부 렌더를 걷어내고 항상 마운트 + `data-open`/`transform`
          으로 바꿨다(자세한 이유는 파일 위쪽 export Gnb 설명 참고) — 햄버거·
          격자 아이콘·오버레이 클릭 전부 같은 0.25s 트랜지션으로 애니메이션
          된다. 🔒 후속(2026-08, "드래그 기능 제거 해줘") — 한 라운드
          있었던 스와이프 드래그(손가락을 따라가는 인라인 transform)는
          걷어냈다 — 항상-마운트 구조는 이 탭 애니메이션에 여전히
          필요해서 남겨뒀다. */}
      <div className={styles.drawerOverlay} data-open={drawerOpen} onClick={() => setDrawerOpen(false)} />
      <div className={styles.drawer} data-open={drawerOpen} role="dialog" aria-label="메뉴" aria-hidden={!drawerOpen}>
        {/* 🔒 `drawer-sidebar` 글로벌 마커 — HomeSidebars.tsx의 `primary-nav-group`과
            짝을 이룬다(Gnb.module.css `:global()` 규칙 참고). `sidebar`가
            받는 건 이미 완성된 ReactNode(페이지가 만든 것, 컴포넌트 종류가
            제각각 — LeftSidebarLoggedIn일 수도, market의 커스텀 위젯일
            수도 있다)라 여기서 props를 주입할 방법이 없다 — CSS로만
            phone 드로어라는 "위치"를 표시한다. */}
        <div className={`${styles.drawerSidebar} drawer-sidebar`}>{sidebar}</div>
      </div>

      <TabBar activeTab={activeTab} profileHref={profileHref} isLoggedIn={isLoggedIn} />
    </>
  );
}

/**
 * 🔒 사용자 지시(2026-08) — "목업에는 gnb, 메가메뉴가 없어졌어. 모든 UI는
 * 목업디자인을 절대적으로 따라가야해". Claude Design 확정안엔 상단 고정
 * GNB 자체가 없다 — 그 역할(로고·프로필·nav·Community·푸터)은 좌 사이드바가
 * 흡수했다(HomeSidebars.tsx, CommunityPopup.tsx). `DesktopGnb`는
 * 완전히 삭제했다.
 *
 * pad(768~1279px)는 이제 좌 사이드바를 208px로 좁혀 그대로 보여준다(각
 * page.module.css) — 그래서 이 컴포넌트는 phone(<768px)에서만 나타나도록
 * 브레이크포인트를 맞췄다(`Gnb.module.css` `.mobileOnly`). 데스크톱·pad
 * 모두에서 완전히 안 보여서 artifact와 시각적으로 100% 일치하고, 사이드바가
 * 드로어로 바뀌는 phone에서만 대체 진입점(햄버거+격자 아이콘 → 드로어,
 * 하단 탭바)으로 나타난다.
 */
export function Gnb(props: GnbProps) {
  return (
    <div className={styles.mobileOnly}>
      <MobileGnb {...props} />
    </div>
  );
}
