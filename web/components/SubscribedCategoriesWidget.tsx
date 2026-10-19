'use client';

import { useState } from 'react';
import type { GnbCategoryGroup } from './Gnb.tsx';
import { useSubscriptions } from './subscriptions-context.tsx';
import { CommunityPopupModal } from './CommunityPopup.tsx';
import styles from './HomeSidebars.module.css';

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/**
 * 좌 사이드바 "구독 중" 목록 — `SubscribeButton`이 구독/취소할 때마다
 * `SubscriptionsProvider`(형제 트리에서 같은 Context를 공유)를 통해
 * 새로고침 없이 즉시 갱신된다. `HomeSidebars.tsx`에서 이 부분만 떼어내
 * 클라이언트 컴포넌트로 만든 이유가 바로 이 반응성 때문 — 나머지
 * 사이드바(프로필 카드·나의 로그·팔로잉)는 여전히 서버 컴포넌트다.
 *
 * 🔒 사용자 지시(2026-08, "좌측 메뉴 디자인을 목업 좌측메뉴와 일치하게
 * 만들어") — artifact는 "Community" 라벨 바로 아래에 카테고리 항목들을
 * 같은 nav 그룹(gap:2px)의 일부로 이어 붙인다(디코딩 원본 line 287-298),
 * 별도 "구독 중" 헤딩·구분선을 가진 위젯이 아니다. `<h3>`/`.widget` 래퍼를
 * 없애고 항목들만 반환 — 부모(`HomeSidebars.tsx`)가 `<CommunityPopup>`과
 * 같은 `.navGroup` 안에 이어서 렌더링한다.
 *
 * 🔒 사용자 지시(2026-08-24, "즐겨찾기가 없을 경우, 여기서 구독하세요") —
 * 구독이 하나도 없으면 빈 자리 대신 안내 버튼을 두고, 클릭하면
 * `CommunityPopup.tsx`의 기존 `CommunityPopupModal`(Gnb.tsx의 phone 헤더
 * 트리거와 동일하게, 사이드바 트리거와 독립된 두 번째 인스턴스)을 그대로
 * 재사용해 카테고리 구독 팝업을 띄운다.
 */
export function SubscribedCategoriesWidget({
  activeCategorySlug,
  categoryTree,
}: {
  activeCategorySlug?: string;
  categoryTree: GnbCategoryGroup[];
}) {
  const { subscribed } = useSubscriptions();
  const [open, setOpen] = useState(false);

  if (subscribed.length === 0) {
    return (
      <>
        <button type="button" className={styles.iconItem} onClick={() => setOpen(true)}>
          <InfoIcon />
          여기서 구독하세요
        </button>
        <CommunityPopupModal open={open} onClose={() => setOpen(false)} categoryTree={categoryTree} isLoggedIn={true} />
      </>
    );
  }

  return (
    <>
      {subscribed.map((c) => (
        <a
          key={c.id}
          className={c.slug === activeCategorySlug ? `${styles.iconItem} ${styles.iconItemActive}` : styles.iconItem}
          href={`/${c.slug}`}
        >
          <FolderIcon />
          {c.name}
        </a>
      ))}
    </>
  );
}
