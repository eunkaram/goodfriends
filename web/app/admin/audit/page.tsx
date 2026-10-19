import { notFound } from 'next/navigation';
import { fetchAuditLog, type AuditLogRow } from '../../../lib/admin.ts';
import { BackendError } from '../../../lib/backend.ts';
import styles from '../admin.module.css';

const TARGET_TYPE_LABEL: Record<string, string> = {
  user_ban: '유저 밴',
  user_unban: '유저 해제',
  moderator_grant: '모더레이터 지정',
  moderator_revoke: '모더레이터 해제',
  nickname_edit: '닉네임 수정',
  report_resolve: '신고 처리',
  post_delete: '글 삭제',
  comment_delete: '댓글 삭제',
  thread: '메시지 스레드 열람',
  message: '메시지 열람',
};

/** AdminPostSearch.tsx/AdminCommentSearch.tsx의 postHref()와 같은 규칙. */
function contentHref(e: AuditLogRow): string | null {
  if (!e.linkPostPublicId) return null;
  const base = e.linkCategorySlug ? `/${e.linkCategorySlug}/${e.linkPostPublicId}` : `/post/${e.linkPostPublicId}`;
  return e.linkIsComment ? `${base}#comments` : base;
}

/**
 * GET /api/admin/audit가 요청마다 쿠키로 모더레이터 여부를 자체 재검증한다
 * (admin-http.ts requireModerator) — layout.tsx의 게이트와 별개로 여기서도
 * 재확인되는 셈이라, 예전처럼 moderatorId를 직접 다시 구할 필요가 없다.
 */
export default async function AdminAuditPage() {
  let entries: AuditLogRow[];
  try {
    entries = await fetchAuditLog({ limit: 50, offset: 0 });
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <h1 className={styles.pageTitle}>감사로그</h1>
      <div className={styles.list}>
        {entries.length === 0 && <p className={styles.empty}>기록이 없어요.</p>}
        {entries.map((e) => {
          const href = contentHref(e);
          return (
            <div key={e.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.username}>
                  {TARGET_TYPE_LABEL[e.targetType] ?? e.targetType}
                  {e.targetUsername && ` — ${e.targetUsername}`}
                </span>
                {(e.contentTitle || e.contentExcerpt) && (
                  <span className={styles.fieldValue}>
                    {e.contentTitle && <strong>{e.contentTitle}</strong>}
                    {e.contentTitle && e.contentExcerpt && ' — '}
                    {e.contentExcerpt}
                  </span>
                )}
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', width: 'fit-content' }}>
                    원문 보기 ↗
                  </a>
                )}
                <span className={styles.meta}>
                  {e.moderatorUsername ?? '(삭제된 유저)'} · {new Date(e.accessedAt).toLocaleString('ko-KR')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
