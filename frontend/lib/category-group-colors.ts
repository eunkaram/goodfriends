/**
 * CLAUDE.md 4. 메뉴 구조 — 고정 3그룹(커뮤니티/모델·도구/활용 분야)·11카테고리.
 * components/HomeSidebars.tsx의 CATEGORY_ICONS와 같은 고정 목록(좌측 메뉴
 * 아이콘 색 배정에 쓰는 것과 동일 소스) — 홈 리스트 카테고리 배지도 같은
 * 그룹색을 쓰기 위해 slug → 그룹 키만 별도로 추출했다. 표시명이 아니라
 * slug 기준이라 메뉴명이 바뀌어도 배지 색이 깨지지 않는다.
 */
const GROUPS: Record<'community' | 'tools' | 'usecase', string[]> = {
  community: ['news', 'qna', 'idea', 'free'],
  tools: ['frontier', 'local', 'agents', 'aiservice'],
  usecase: ['coding', 'automation', 'creative'],
};

const CATEGORY_TO_GROUP: Record<string, 'community' | 'tools' | 'usecase'> = Object.fromEntries(
  Object.entries(GROUPS).flatMap(([group, names]) => names.map((name) => [name, group as 'community' | 'tools' | 'usecase'])),
);

export function categoryGroupKey(categorySlug: string | null | undefined): 'community' | 'tools' | 'usecase' | undefined {
  return categorySlug ? CATEGORY_TO_GROUP[categorySlug] : undefined;
}

/**
 * 프로필 편집 "관심 분야" 선택지 — 디코딩 원본 line 1697 `allCats`와 같은
 * 범위(News·Q&A·자유게시판만 제외, 나머지 8개). backend/src/user-log.ts의
 * PROFILE_INTEREST_CATEGORIES와 slug가 같아야 저장이 통과한다(서버가 최종
 * 검증) — 이미 내려받은 categoryTree에서 같은 제외 목록만 적용해 하나의
 * 소스(백엔드 카테고리 트리)만 따르게 했다. 위 GROUPS와 마찬가지로 slug
 * 기준(이름은 i18n이 바뀌면 같이 바뀐다 — 실측: "AI Coding"→"Vibe Coding").
 */
const INTEREST_EXCLUDED_SLUGS = new Set(['news', 'qna', 'free']);

export function interestEligibleCategories<T extends { slug: string }>(categoryTree: { children: T[] }[]): T[] {
  return categoryTree.flatMap((g) => g.children).filter((c) => !INTEREST_EXCLUDED_SLUGS.has(c.slug));
}
