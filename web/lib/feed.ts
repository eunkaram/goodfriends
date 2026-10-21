import { backendFetch } from './backend.ts';

export type FeedSort = 'latest' | 'popular';

export type FeedPost = {
  id: string;
  publicId: string;
  title: string;
  bodyPreview: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  /** 🔒 M4 — 뉴스봇·다이제스트봇 글의 "AI 에디터" 배지(users.is_agent). */
  authorIsAgent: boolean;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  /**
   * 🔒 사용자 지시(2026-09-06, "글 리스트도 삭제된 글이라고 표시") — RLS가
   * 신고 열려있는 삭제 글을 모더레이터에게만 계속 보여줘서(reafy_backend
   * feed.ts) 목록에도 섞여 나올 수 있다. 일반 유저는 이 필드가 non-null인
   * 행 자체를 못 받는다 — post-detail.ts의 PostDetail.deletedAt과 같은 계약.
   */
  deletedAt: string | null;
};

export async function fetchHomeFeed(opts: { sort: FeedSort; limit: number; offset: number }): Promise<FeedPost[]> {
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(
    `/api/feed?sort=${opts.sort}&limit=${opts.limit}&offset=${opts.offset}`,
  );
  return posts;
}

/** M2 — 공개 검색(/search 페이지, §6.8 bigm prefix 계약). */
export async function fetchPostSearch(q: string, limit: number, offset: number, categorySlug?: string): Promise<FeedPost[]> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  if (categorySlug) params.set('category', categorySlug);
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(`/api/posts/search?${params.toString()}`);
  return posts;
}

export async function fetchCategoryFeed(categorySlug: string, opts: { sort: FeedSort; limit: number; offset: number }): Promise<FeedPost[]> {
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(
    `/api/feed?category=${encodeURIComponent(categorySlug)}&sort=${opts.sort}&limit=${opts.limit}&offset=${opts.offset}`,
  );
  return posts;
}

/** `/posts`(좌 사이드바 "Posts") 전용 — 항상 로그인한 본인 글(게시판+My Post 병합, 최신순). */
export async function fetchLogFeed(username: string, opts: { limit: number; offset: number }): Promise<FeedPost[]> {
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(
    `/api/feed?username=${encodeURIComponent(username)}&limit=${opts.limit}&offset=${opts.offset}`,
  );
  return posts;
}

export async function fetchSavedPosts(opts: { limit: number; offset: number }): Promise<FeedPost[]> {
  const { posts } = await backendFetch<{ posts: FeedPost[] }>(`/api/saved-posts?limit=${opts.limit}&offset=${opts.offset}`);
  return posts;
}
