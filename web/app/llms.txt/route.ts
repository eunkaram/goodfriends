import { appBaseUrl } from '../../lib/app-url.ts';
import { fetchPublicCategoryTree } from '../../lib/categories.ts';

/**
 * 🔒 사용자 지시(2026-09-06, "검색이나 ai답변에 잘 노출") — llmstxt.org
 * 관행(아직 비공식, 우선순위 최하)을 따라 AI 크롤러에게 사이트 구조를
 * 요약해준다. robots.ts/sitemap.ts와 같은 이유로 카테고리 목록은 매 요청
 * 백엔드에서 받아와 최신 상태를 유지한다 — 정적 파일로 박아두면 카테고리가
 * 늘어날 때마다 여길 깜빡하고 안 고칠 위험이 있다.
 */
// 빌드 타임에 백엔드 원격호출로 prerender 실패하는 것을 막는다(로컬 빌드에 DB 미기동).
export const dynamic = 'force-dynamic';

export const revalidate = 3600;

export async function GET() {
  const base = appBaseUrl();
  const { tree } = await fetchPublicCategoryTree(0);
  const communityCategories = tree.flatMap((g) => g.children.filter((c) => c.type === 'community'));

  const lines = [
    '# AI Community',
    '',
    '> 배우고, 만들고, 나누는 AI 커뮤니티. 아래 게시판 카테고리는 로그인 없이 전체공개로 열람할 수 있습니다.',
    '',
    '## 게시판',
    ...communityCategories.map((c) => `- [${c.name}](${base}/${c.slug})`),
    '',
    '## Sitemap',
    `- [sitemap.xml](${base}/sitemap.xml)`,
  ];

  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
