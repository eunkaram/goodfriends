import { backendFetch } from './backend.ts';

export type NotificationItem = {
  id: string;
  type: string;
  actorId: string | null;
  actorNickname: string | null;
  actorUsername: string | null;
  targetType: string;
  targetId: string;
  createdAt: string;
  isRead: boolean;
};

export async function listNotifications(): Promise<NotificationItem[]> {
  const { notifications } = await backendFetch<{ notifications: NotificationItem[] }>('/api/notifications');
  return notifications;
}
