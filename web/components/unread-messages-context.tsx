'use client';

/**
 * 쪽지(1:1 메시지)는 1차 스코프에서 제외됐다 — 레이아웃 트리가
 * UnreadMessagesProvider(initialHasUnread=...)를 그대로 마운트할 수 있게
 * 값을 그대로 흘려보내는 스텁을 둔다. 2차에서 실제 구현으로 교체한다.
 */
import { createContext, type ReactNode, useContext } from 'react';

const UnreadMessagesContext = createContext({ hasUnread: false });

type ProviderProps = {
  initialHasUnread?: boolean;
  children: ReactNode;
};

export function UnreadMessagesProvider({ initialHasUnread = false, children }: ProviderProps) {
  return <UnreadMessagesContext.Provider value={{ hasUnread: initialHasUnread }}>{children}</UnreadMessagesContext.Provider>;
}

export function useUnreadMessages() {
  return useContext(UnreadMessagesContext);
}
