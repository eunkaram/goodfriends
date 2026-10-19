'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useIsEmailVerified } from './use-is-email-verified.ts';

/**
 * §11.7.1 "New Post" — 좌 사이드바 메뉴 클릭이 중앙 HomeFeed의 글쓰기 폼을
 * 모달로 띄운다(사용자 지시, 2026-08 — 인라인 글쓰기를 페이지에서 없애고
 * 이 방식으로 교체). 두 컴포넌트가 서버 트리 상 형제라 Context로 열림
 * 상태만 공유한다 — 실제 폼·제출 로직은 여전히 HomeFeed(Composer)가 갖는다.
 */
type ComposerModalCtx = { isOpen: boolean; open: () => void; close: () => void };

const ComposerModalContext = createContext<ComposerModalCtx | null>(null);

export function ComposerModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [blockedAlert, setBlockedAlert] = useState(false);
  // 🔒 사용자 지시(2026-08-24, "new post를 클릭시 모달 얼럿으로 메세지를
  // 보여줘") — open()을 호출하는 모든 진입점(Gnb 하단 탭바, 좌 사이드바
  // New Post)이 이 Provider를 거치므로 여기 한 곳에서만 막으면 된다.
  const emailVerified = useIsEmailVerified();

  function open() {
    if (!emailVerified) {
      setBlockedAlert(true);
      return;
    }
    setIsOpen(true);
  }

  return (
    <ComposerModalContext.Provider value={{ isOpen, open, close: () => setIsOpen(false) }}>
      {children}
      <ConfirmDialog
        open={blockedAlert}
        message="이메일 인증이 필요해요. 인증 후 새 글을 작성할 수 있어요."
        confirmLabel="확인"
        cancelLabel={null}
        destructive={false}
        onConfirm={() => setBlockedAlert(false)}
        onCancel={() => setBlockedAlert(false)}
      />
    </ComposerModalContext.Provider>
  );
}

export function useComposerModal(): ComposerModalCtx {
  const ctx = useContext(ComposerModalContext);
  if (!ctx) throw new Error('useComposerModal은 ComposerModalProvider 안에서만 쓸 수 있다');
  return ctx;
}
