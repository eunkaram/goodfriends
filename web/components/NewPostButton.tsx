'use client';

import { useComposerModal } from './composer-modal-context.tsx';
import styles from './HomeSidebars.module.css';

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 🔒 사용자 발견 — 크림슨 채움 버튼이라 Profile 등 다른 메뉴 항목과 튀어 보였다. 나머지와 같은 .iconItem 스타일로 통일.
 * 🔒 사용자 지시(2026-08, "PC용 레프트 메뉴를 수정없이 그대로 사용해") — pad(768~1279px)는
 * 이 좌 사이드바를 그대로 노출하고, phone(<768px)은 하단 탭바 중앙의 "+" 버튼이
 * 같은 `useComposerModal`을 연다(Gnb.tsx) — 이 버튼을 굳이 숨길 이유가 없어졌다. */
export function NewPostButton() {
  const { open } = useComposerModal();
  return (
    <button type="button" className={styles.iconItem} onClick={open}>
      <PlusIcon />
      New Post
    </button>
  );
}
