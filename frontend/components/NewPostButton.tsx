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
 * 같은 `useComposerModal`을 연다(Gnb.tsx) — 이 버튼을 굳이 숨길 이유가 없어졌다.
 *
 * 🔒 사용자 지시(2026-10, "news일때는 new post 클릭이 안되게 막아줘") — News
 * 카테고리/글 상세를 보는 중인 일반 유저는 이 버튼을 눌러도 News가 기본
 * 선택된(defaultCategoryId) 글쓰기 모달이 열릴 뿐이라 제출 시 서버가 403으로
 * 막는다 — 열리기 전에 아예 막는다. 호출부([category]/page.tsx 등)가
 * `disabled`를 계산해서 넘긴다(writableCommunityCategories와 같은 판단 기준). */
export function NewPostButton({ disabled }: { disabled?: boolean }) {
  const { open } = useComposerModal();
  return (
    <button
      type="button"
      className={styles.iconItem}
      onClick={open}
      disabled={disabled}
      title={disabled ? 'News는 운영진·시스템 계정만 작성할 수 있어요' : undefined}
    >
      <PlusIcon />
      New Post
    </button>
  );
}
