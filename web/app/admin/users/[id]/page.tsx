import { notFound } from 'next/navigation';
import { fetchAdminUserDetail } from '../../../../lib/admin.ts';
import { AdminUserDetail } from '../../../../components/AdminUserDetail.tsx';
import styles from '../../admin.module.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLE_TABS = new Set(['moderator', 'agent', 'general']);

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound(); // 불변식 19 — 라우트 경계에서 먼저 검증

  const user = await fetchAdminUserDetail(id);
  if (!user) notFound();

  // 🔒 사용자 발견(2026-09-07, "일반 -> 상세페이지 -> 목록보기를 클릭하면
  // 전체탭으로 이동되어버리네") — AdminUserSearch.tsx가 자기 role 탭을
  // ?from=으로 넘겨준다, 그대로 /admin?role=으로 되돌린다.
  const { from } = await searchParams;
  const backHref = from && ROLE_TABS.has(from) ? `/admin?role=${from}` : '/admin';

  return (
    <>
      <a className={styles.backLink} href={backHref}>
        ← 목록으로
      </a>
      <h1 className={styles.pageTitle}>{user.username}</h1>
      <AdminUserDetail user={user} />
    </>
  );
}
