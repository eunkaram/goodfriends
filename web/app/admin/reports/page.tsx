import { notFound } from 'next/navigation';
import { fetchReports } from '../../../lib/reports.ts';
import { BackendError } from '../../../lib/backend.ts';
import { AdminReportsList } from '../../../components/AdminReportsList.tsx';
import styles from '../admin.module.css';

/**
 * GET /api/reports가 요청마다 쿠키로 모더레이터 여부를 자체 재검증한다
 * (reports-http.ts) — layout.tsx 게이트와 별개로 여기서도 재확인되는
 * 셈이라, 예전처럼 moderatorId를 직접 다시 구할 필요가 없다.
 */
export default async function AdminReportsPage() {
  let reports;
  try {
    reports = await fetchReports({ limit: 50, offset: 0 });
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <h1 className={styles.pageTitle}>신고</h1>
      <AdminReportsList initialReports={reports} />
    </>
  );
}
