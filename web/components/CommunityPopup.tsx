'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GnbCategory, GnbCategoryGroup } from './Gnb.tsx';
import { useModalOpenEffect } from './use-modal-open-effect.ts';
import { useSubscriptions } from './subscriptions-context.tsx';
import { useSubscribeToggle } from './use-subscribe-toggle.ts';
import styles from './Gnb.module.css';

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6L18 18 M18 6L6 18" />
    </svg>
  );
}

/** 🔒 artifact 실측(디코딩 원본, showCommunityPopup) — 카테고리 행 왼쪽 아이콘.
 * `PostsIcon`(HomeSidebars.tsx)과 정확히 같은 path — "문서 목록" 아이콘이
 * Posts 메뉴와 커뮤니티 팝업 카테고리 둘 다에 재사용된다. */
function CategoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4.5" width="16" height="15" rx="1.6" />
      <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h6" />
    </svg>
  );
}

/** 🔒 사용자 발견(2026-08, "구독하기 버튼이 누락되어있어") — artifact는 카테고리
 * 행마다 오른쪽에 구독 토글("+ 구독"/"구독중")을 둔다(디코딩 원본 실측). 링크
 * 클릭(카테고리 이동)과 토글 클릭(구독)이 같은 행에 같이 있어 이벤트가 서로
 * 안 겹치게 토글 쪽에 `stopPropagation`을 건다 — `<a>`가 아니라 `<button>`으로
 * 만들어 "탐색"과 "액션"의 시맨틱을 분리했다(artifact는 둘 다 `<a>`를 쓰지만
 * 토글은 페이지 이동이 없는 액션이라 이 앱의 다른 곳(SubscribeButton 등)과
 * 마찬가지로 button이 더 정확하다). */
function CategoryRow({ category, isLoggedIn, onNavigate }: { category: GnbCategory; isLoggedIn: boolean; onNavigate: () => void }) {
  const { subscribed: subscribedList } = useSubscriptions();
  const initialSubscribed = subscribedList.some((c) => c.id === category.id);
  const { subscribed, pending, limitReached, toggle, loginDialog } = useSubscribeToggle(category, initialSubscribed, isLoggedIn);

  return (
    <div className={styles.megaMenuRow}>
      <a href={`/${category.slug}`} role="menuitem" onClick={onNavigate} className={styles.megaMenuRowLink}>
        <CategoryIcon />
        {category.name}
      </a>
      <button
        type="button"
        disabled={pending}
        className={subscribed ? styles.megaMenuSubscribed : styles.megaMenuSubscribe}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {limitReached ? '최대 10개까지' : subscribed ? '구독중' : '+ 구독'}
      </button>
      {loginDialog}
    </div>
  );
}

/**
 * 🔒 사용자 지시(2026-08) — "목업에는 gnb, 메가메뉴가 없어졌어. 모든 UI는
 * 목업디자인을 절대적으로 따라가야해". Claude Design 확정안은 GNB(상단
 * 고정바) 자체가 없다 — "Community" 진입점과 그 팝업이 좌 사이드바
 * 안에 있다. 이전엔 Gnb.tsx 안에서 트리거+모달을 함께 관리했는데, GNB를
 * 없애면서 좌 사이드바(HomeSidebars.tsx)가 이 트리거를 가져야 해서
 * 독립 컴포넌트로 뽑았다. 모달 자체(오버레이+680px 카드+2열 그리드)는
 * 그대로 유지 — Gnb.module.css의 기존 .megaMenu* 클래스를 그대로 재사용한다
 * (CSS Modules는 파일 스코프일 뿐 여러 컴포넌트가 import해서 같이 쓸 수 있다).
 *
 * 🔒 실전 발견(2026-08, 사용자 리포트 — "Community 버튼을 눌러서 게시판
 * 리스트를 불러왔어. UI가 깨져버려") — 이 트리거(`<button>`)가 좌
 * 사이드바(`.left`, `position:sticky`) 안에 있는데, sticky는 z-index와
 * 무관하게 항상 새 스태킹 컨텍스트를 만든다 — 오버레이·모달을 원래처럼
 * 같은 컴포넌트 안에서 인라인으로 렌더링하면 그 모달도 `.left`의 로컬
 * 컨텍스트에 갇힌다. `.left`(사이드바 전체)와 `.center`(본문)는 둘 다
 * z-index를 안 쓰는 형제라 DOM 순서로 페인트 순서가 정해지는데, `.left`
 * 통째로 `.center`보다 먼저 그려져서 — 안에 아무리 z-index를 높여도
 * `.center` 쪽 스티키 타이틀 줄(`.topRow`, `--z-sticky`)이 계속 그
 * 위(더 나중)에 그려졌다. `createPortal`로 오버레이+모달을
 * `document.body`(사이드바 트리 완전히 밖)에 직접 렌더링해 이 트랩
 * 자체를 피한다 — PostComposerModal·ProfileEditModal은 애초에 `.center`
 * 트리 안에 있어(사이드바처럼 sticky 조상에 갇히지 않음) 이 문제가 없다.
 *
 * 🔒 사용자 발견(2026-08, "목업의 커뮤니티 팝업코드를 잘 확인하고 수정해줘 —
 * 구독하기 버튼이 누락되어있어. 카테고리와 메뉴사이의 구분선도 없고, 아이콘도
 * 빠져있고") — 이전 라운드가 헤더+2열 그리드까지만 artifact를 맞추고 각
 * 카테고리 행 자체(아이콘·구독 토글·그룹 헤더 구분선)는 임시 텍스트 링크로
 * 남겨뒀던 걸 이번에 실측대로 채웠다. 헤더 타이틀도 "커뮤니티"(한글)에서
 * artifact 리터럴 "Community"(영문)로, 그룹 헤더 스타일도 uppercase+
 * letter-spacing+구분선으로 재실측했다 — 아래 Gnb.module.css 참고.
 */
export function CommunityPopup({ categoryTree, isLoggedIn }: { categoryTree: GnbCategoryGroup[]; isLoggedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.sidebarCommunityBtn}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Community
      </button>
      <CommunityPopupModal open={open} onClose={() => setOpen(false)} categoryTree={categoryTree} isLoggedIn={isLoggedIn} />
    </>
  );
}

/**
 * 🔒 사용자 지시(2026-08 — "phone 화면에서 오른쪽 상단 메뉴버튼 클릭하면
 * community categories 팝업을 띄워주고, 좌측메뉴의 community 클릭은
 * 막아줘") — 모달(오버레이+680px 카드) 부분을 트리거 버튼에서 분리했다.
 * `CommunityPopup`(위)은 그대로 좌 사이드바용 트리거+모달 패키지로 남고,
 * `Gnb.tsx`의 phone 헤더 격자 아이콘은 이 `CommunityPopupModal`을 직접
 * 자기 로컬 state로 열어(드로어를 거치지 않고) 같은 모달을 띄운다 —
 * 사이드바 트리거와 완전히 독립된 두 번째 인스턴스라 서로 상태를 안
 * 공유해도 된다(어차피 한 번에 하나만 사용자가 연다). 좌측 드로어 안
 * 트리거는 지우는 대신 `Gnb.module.css`의 `:global(.drawer-sidebar)
 * .sidebarCommunityBtn { pointer-events:none }`로 클릭만 막았다.
 */
export function CommunityPopupModal({
  open,
  onClose,
  categoryTree,
  isLoggedIn,
}: {
  open: boolean;
  onClose: () => void;
  categoryTree: GnbCategoryGroup[];
  isLoggedIn: boolean;
}) {
  useModalOpenEffect(open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className={styles.megaMenuOverlay} onClick={onClose} />
      <div className={styles.megaMenu} role="dialog" aria-label="전체 카테고리">
        <div className={styles.megaMenuHead}>
          <span>Community</span>
          <button type="button" className={styles.megaMenuClose} onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </div>
        <div className={styles.megaMenuInner}>
          {categoryTree.map((group) => (
            <div key={group.name} className={styles.megaMenuGroup}>
              <h4>{group.name}</h4>
              {group.children.map((c) => (
                <CategoryRow key={c.slug} category={c} isLoggedIn={isLoggedIn} onNavigate={onClose} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
