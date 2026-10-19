import { backendFetch, publicBackendFetch } from './backend.ts';

export type Category = {
  id: string;
  parentId: string | null;
  nameKey: string;
  name: string;
  slug: string;
  type: 'community' | 'market';
  sort: number;
};

export type CategoryGroup = Category & { children: Category[] };

export async function fetchCategoryTreeAndPopular(popularLimit = 5): Promise<{ tree: CategoryGroup[]; popular: Category[] }> {
  return backendFetch(`/api/categories/tree?popularLimit=${popularLimit}`);
}

/** fetchCategoryTreeAndPopular의 쿠키 없는 버전 — llms.txt처럼 로그인 여부와 무관하게 캐시해도 되는 호출부용. */
export async function fetchPublicCategoryTree(popularLimit = 5): Promise<{ tree: CategoryGroup[]; popular: Category[] }> {
  return publicBackendFetch(`/api/categories/tree?popularLimit=${popularLimit}`, 3600);
}

export async function fetchSubscribedCategories(): Promise<Pick<Category, 'id' | 'name' | 'slug'>[]> {
  const { categories } = await backendFetch<{
    categories: (Pick<Category, 'id' | 'name' | 'slug'> & { isSubscribed?: boolean })[];
  }>('/api/categories');
  return categories.filter((c) => c.isSubscribed).map(({ id, name, slug }) => ({ id, name, slug }));
}

/**
 * /api/categories/tree엔 slug 하나로 바로 찾는 라우트가 없다 — 사이드바용으로
 * 어차피 매 요청 받아오는 트리(top-level 그룹 + children)를 그대로 훑는다.
 * 마켓 카테고리도 그룹 children에 섞여 있어(is_public 조건만 적용) type까지
 * 그대로 돌려준다 — 호출부가 community 여부를 직접 판단해야 한다.
 */
export function findCategoryBySlug(tree: CategoryGroup[], slug: string): Category | undefined {
  for (const group of tree) {
    if (group.slug === slug) return group;
    const child = group.children.find((c) => c.slug === slug);
    if (child) return child;
  }
  return undefined;
}
