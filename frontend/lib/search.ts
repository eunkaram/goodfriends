import { backendFetch } from './backend.ts';

export type SearchPostHit = {
  id: string;
  publicId: string;
  title: string;
  authorId: string;
  snippet: string;
  categoryName: string;
  categorySlug: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
};

export type SearchGroup<T> = {
  items: T[];
  hasMore: boolean;
  nextOffset: number | null;
};

export type SearchResults = {
  query: string;
  posts: SearchGroup<SearchPostHit>;
};

/** 전체검색 — `/api/search`의 제목/본문 통합 글 목록 응답. */
export async function fetchSearch(q: string, limit = 20, offset = 0, categorySlug?: string): Promise<SearchResults> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  if (categorySlug) params.set('category', categorySlug);
  return backendFetch<SearchResults>(`/api/search?${params.toString()}`);
}
