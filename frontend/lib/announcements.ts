import { backendFetch } from './backend.ts';

export type Announcement = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `/messages` 배너용 — reafy_backend 이슈 #10, GET /api/announcements/active(로그인 필요). */
export async function fetchActiveAnnouncements(): Promise<Announcement[]> {
  const { announcements } = await backendFetch<{ announcements: Announcement[] }>('/api/announcements/active');
  return announcements;
}
