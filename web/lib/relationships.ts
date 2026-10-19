import { backendFetch } from './backend.ts';

export type FollowingUser = { id: string; username: string; nickname: string; avatarUrl: string };

export type FollowerListItem = FollowingUser & { isFollowedByViewer: boolean };

export async function fetchFollowing(limit = 5): Promise<FollowingUser[]> {
  const { following } = await backendFetch<{ following: FollowingUser[] }>(`/api/relationships/following?limit=${limit}`);
  return following;
}

/** 메시지 작성 "받는 사람" 후보 — 팔로우 방향 무관 팔로잉+팔로워 합집합. */
export async function fetchConnectedUsers(limit = 100): Promise<FollowingUser[]> {
  const { connected } = await backendFetch<{ connected: FollowingUser[] }>(`/api/relationships/connected?limit=${limit}`);
  return connected;
}
