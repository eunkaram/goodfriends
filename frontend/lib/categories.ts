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

/** backend/src/categories.ts와 같은 값 — News는 운영진·시스템 계정만 쓸 수 있다(posts.ts가 실제 경계). */
export const NEWS_CATEGORY_SLUG = 'news';

/**
 * 글쓰기 모달(PostComposerModal)의 카테고리 선택지 — 모든 페이지가 쓰던
 * `categoryTree.flatMap((g) => g.children.filter((c) => c.type === 'community'))`를
 * 여기 한 곳으로 모으고, News는 운영진(isModerator)·시스템 계정(isAgent)이
 * 아니면 선택지에서 뺀다. 🔒 사용자 지시(2026-10, "news메뉴는 시스템또는
 * 어드민만 올릴수 있게... 일반 유저는 읽기/댓글만") — 실제 작성 권한은
 * backend posts.ts가 다시 막으므로 여기는 UX(안 보이게)일 뿐이다.
 */
export function writableCommunityCategories(tree: CategoryGroup[], canPostNews: boolean): Category[] {
  return tree.flatMap((g) => g.children.filter((c) => c.type === 'community' && (canPostNews || c.slug !== NEWS_CATEGORY_SLUG)));
}
