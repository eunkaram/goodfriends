import { backendFetch } from './backend.ts';

export type PopularPost = { id: string; publicId: string; title: string; categorySlug: string | null };

export async function fetchPopularPosts(opts: { categoryId?: string; window?: '24h' | '7d'; limit?: number } = {}): Promise<PopularPost[]> {
  const params = new URLSearchParams();
  if (opts.categoryId) params.set('categoryId', opts.categoryId);
  if (opts.window) params.set('window', opts.window);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const { posts } = await backendFetch<{ posts: PopularPost[] }>(`/api/popularity${qs ? `?${qs}` : ''}`);
  return posts;
}
