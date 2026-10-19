import type { MetadataRoute } from 'next';
import { publicBackendFetch } from '../lib/backend.ts';
import { appBaseUrl } from '../lib/app-url.ts';

/**
 * 🔒 사용자 지시(2026-08-21, "seo를 고려해야 할것 같아") — 여기 담을 수
 * 있는 글은 커뮤니티 글(category_id NOT NULL)뿐이다(불변식 10과 같은 이유,
 * GET /api/sitemap-data가 이미 그 필터를 걸어 내려준다). URL 조립과
 * changeFrequency는 프론트가 그대로 맡는다 — 백엔드는 원본 데이터만 준다.
 */
// 빌드 타임에 백엔드 원격호출로 prerender 실패하는 것을 막는다(로컬 빌드에 DB 미기동).
export const dynamic = 'force-dynamic';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl();
  const { entries } = await publicBackendFetch<{
    entries: { publicId: string; categorySlug: string; createdAt: string; updatedAt: string }[];
  }>('/api/sitemap-data', revalidate);
  return [
    { url: base, changeFrequency: 'always' },
    ...entries.map((entry) => ({
      url: `${base}/${entry.categorySlug}/${entry.publicId}`,
      lastModified: new Date(entry.updatedAt ?? entry.createdAt),
      changeFrequency: 'never' as const,
    })),
  ];
}
