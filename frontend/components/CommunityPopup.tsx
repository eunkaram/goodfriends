'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GnbCategory, GnbCategoryGroup } from './Gnb.tsx';
import { useModalOpenEffect } from './use-modal-open-effect.ts';
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

/** 🔒 goodfriends CLAUDE.md 3. "넣지 않기로 한 기능: 게시판 구독" — 이전엔
 * 카테고리 행마다 구독 토글("+ 구독"/"구독중")이 있었으나 제거했다. 순수
 * 탐색 링크만 남는다. */
function CategoryRow({ category, onNavigate }: { category: GnbCategory; onNavigate: () => void }) {
  return (
    <div className={styles.megaMenuRow}>
      <a href={`/${category.slug}`} role="menuitem" onClick={onNavigate} className={styles.megaMenuRowLink}>
        <CategoryIcon />
        {category.name}
      </a>
    </div>
  );
}

/**
 * 🔒 사용자 지시(2026-08 — "phone 화면에서 오른쪽 상단 메뉴버튼 클릭하면
 * community categories 팝업을 띄워주고") — `Gnb.tsx`의 phone 헤더 격자
 * 아이콘이 이 모달을 자기 로컬 state로 연다(드로어를 거치지 않음). 데스크톱
 * 좌 사이드바는 goodfriends 시안대로 카테고리를 상시 펼쳐서 보여주므로
 * (HomeSidebars.tsx CategoryNav) 이 모달을 쓰지 않는다 — phone 전용.
 * `createPortal`로 `document.body`에 직접 렌더링한다(사이드바의 sticky
 * 스태킹 컨텍스트에 갇히지 않기 위해).
 */
export function CommunityPopupModal({
  open,
  onClose,
  categoryTree,
}: {
  open: boolean;
  onClose: () => void;
  categoryTree: GnbCategoryGroup[];
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
                <CategoryRow key={c.slug} category={c} onNavigate={onClose} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
