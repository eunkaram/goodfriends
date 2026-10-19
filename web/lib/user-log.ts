import { backendFetch, BackendError } from './backend.ts';
import type { FeedPost } from './feed.ts';
import type { FollowerListItem } from './relationships.ts';

export type ProfileLink = { id: string; name: string; url: string };

export type UserLogProfile = {
  userId: string;
  username: string;
  nickname: string;
  title: string;
  intro: string;
  visibility: 'public' | 'friends' | 'private' | 'followers';
  joinedAt: string;
  postCount: number;
  location: string | null;
  profileLinks: ProfileLink[];
  avatarUrl: string;
  followerCount: number;
  likeCount: number;
  commentCount: number;
};

export type RelationshipStatus = 'self' | 'none' | 'pending_sent' | 'pending_received' | 'friends';

export type ProfileWithStatus = UserLogProfile & { relationshipStatus: RelationshipStatus; isFollowing: boolean };

export type OwnProfile = UserLogProfile & { country: string | null; postalCode: string | null };

async function fetchOrNull<T>(path: string): Promise<T | null> {
  try {
    return await backendFetch<T>(path);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return null;
    throw err;
  }
}

/** §4.3 로그인 게이트가 RLS 안에 있어 — 비로그인이면 존재하는 유저여도 항상 404(null)다. */
export async function fetchProfileByUsername(username: string): Promise<ProfileWithStatus | null> {
  return fetchOrNull<ProfileWithStatus>(`/api/profile/${encodeURIComponent(username)}`);
}

export async function fetchOwnProfile(): Promise<OwnProfile | null> {
  return fetchOrNull<OwnProfile>('/api/profile');
}

export type UserComment = { id: string; body: string; createdAt: string; parentCommentId: string | null; reactionCount: number; myReaction: boolean };
export type PostWithUserComments = { post: FeedPost; comments: UserComment[] };

export async function fetchLogPosts(username: string, opts: { limit: number; offset: number }): Promise<FeedPost[]> {
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(
    `/api/profile/${encodeURIComponent(username)}/posts?limit=${opts.limit}&offset=${opts.offset}`,
  );
  return posts;
}

export async function fetchRepliedPosts(username: string, opts: { limit: number; offset: number }): Promise<PostWithUserComments[]> {
  const { items } = await backendFetch<{ items: PostWithUserComments[] }>(
    `/api/profile/${encodeURIComponent(username)}/replies?limit=${opts.limit}&offset=${opts.offset}`,
  );
  return items;
}

export async function fetchMediaPosts(username: string, opts: { limit: number; offset: number }): Promise<FeedPost[]> {
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(
    `/api/profile/${encodeURIComponent(username)}/media?limit=${opts.limit}&offset=${opts.offset}`,
  );
  return posts;
}

export async function fetchFollowers(username: string, limit = 50): Promise<FollowerListItem[]> {
  const { followers } = await backendFetch<{ followers: FollowerListItem[] }>(
    `/api/profile/${encodeURIComponent(username)}/followers?limit=${limit}`,
  );
  return followers;
}
