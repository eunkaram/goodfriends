import { backendFetch } from './backend.ts';

export async function hasUnreadMessages(): Promise<boolean> {
  const { hasUnread } = await backendFetch<{ hasUnread: boolean }>('/api/messages/unread');
  return hasUnread;
}

export type MessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type ThreadSummary = {
  id: string;
  otherUser: { id: string; username: string; nickname: string };
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
  isRequest: boolean;
  isUnread: boolean;
};

/** 🔒 이 라우트만 다른 목록 라우트들과 달리 {inbox,requests}를 감싸지 않고 그대로 준다 — 백엔드 관례. */
export async function fetchThreads(): Promise<{ inbox: ThreadSummary[]; requests: ThreadSummary[] }> {
  return backendFetch('/api/messages/threads');
}
