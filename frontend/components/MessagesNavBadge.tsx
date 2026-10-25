'use client';

import { useUnreadMessages } from './unread-messages-context.tsx';
import { UnreadBadge } from './UnreadBadge.tsx';

/** 좌 사이드바 Messages 옆 배지 — UnreadMessagesProvider에서 직접 읽는다(별도 클라이언트 컴포넌트). */
export function MessagesNavBadge() {
  const { hasUnread } = useUnreadMessages();
  return hasUnread ? <UnreadBadge /> : null;
}
