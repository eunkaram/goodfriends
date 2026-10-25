'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * 좌 사이드바의 Messages 배지와 `/messages` 화면이 서버 트리 상 형제라,
 * 스레드를 읽었을 때 새로고침 없이 서로 갱신하려면 Context로 공유해야
 * 한다 — `ComposerModalProvider`와 같은 패턴.
 */
type UnreadMessagesCtx = {
  hasUnread: boolean;
  setHasUnread: (value: boolean) => void;
};

const UnreadMessagesContext = createContext<UnreadMessagesCtx | null>(null);

export function UnreadMessagesProvider({ initialHasUnread = false, children }: { initialHasUnread?: boolean; children: ReactNode }) {
  const [hasUnread, setHasUnread] = useState(initialHasUnread);
  return <UnreadMessagesContext.Provider value={{ hasUnread, setHasUnread }}>{children}</UnreadMessagesContext.Provider>;
}

export function useUnreadMessages(): UnreadMessagesCtx {
  const ctx = useContext(UnreadMessagesContext);
  if (!ctx) throw new Error('useUnreadMessages는 UnreadMessagesProvider 안에서만 쓸 수 있다');
  return ctx;
}
