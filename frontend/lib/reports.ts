import { backendFetch } from './backend.ts';

export type ReportTargetType = 'post' | 'comment';

export type ReportListRow = {
  id: string;
  reporterUsername: string | null;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: 'open' | 'resolved';
  createdAt: string;
  targetTitle: string | null;
  targetExcerpt: string | null;
  targetAuthorUsername: string | null;
  targetDeleted: boolean;
  targetPostId: string | null;
  targetPostPublicId: string | null;
  targetCategorySlug: string | null;
};

/** 비모더레이터는 404(존재 자체를 숨긴다, reports-http.ts) — 호출부가 notFound()로 그대로 옮긴다. */
export async function fetchReports(opts: { limit: number; offset: number }): Promise<ReportListRow[]> {
  const { reports } = await backendFetch<{ reports: ReportListRow[] }>(`/api/reports?limit=${opts.limit}&offset=${opts.offset}`);
  return reports;
}
