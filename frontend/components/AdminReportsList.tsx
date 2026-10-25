'use client';

import { useState } from 'react';
import type { ReportListRow } from '../lib/reports.ts';
import styles from '../app/admin/admin.module.css';

const TARGET_TYPE_LABEL: Record<string, string> = {
  post: '글',
  comment: '댓글',
};

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: '이미 지워졌거나 없는 대상이에요.',
  INVALID_INPUT: '요청이 올바르지 않아요.',
};

/** AdminPostSearch.tsx/AdminCommentSearch.tsx의 href 규칙과 동일 — 댓글 신고는 부모 글 + #comments. */
function reportTargetHref(r: ReportListRow): string | null {
  if (!r.targetPostPublicId) return null;
  const base = r.targetCategorySlug ? `/${r.targetCategorySlug}/${r.targetPostPublicId}` : `/post/${r.targetPostPublicId}`;
  return r.targetType === 'comment' ? `${base}#comments` : base;
}

/**
 * 신고 목록 — 미리보기 · 삭제(글/댓글) · 처리완료(resolve). 전부
 * admin-http.ts(/api/admin/reports/:id/resolve, /api/admin/posts|comments/:id/delete)
 * 만 호출한다. 새로고침은 기존 읽기 라우트(/api/reports)를 재사용한다 —
 * moderatorId는 쿠키로 서버가 이미 알고 있어 클라이언트가 안 넘겨도 된다.
 */
export function AdminReportsList({ initialReports }: { initialReports: ReportListRow[] }) {
  const [reports, setReports] = useState(initialReports);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/reports?limit=50&offset=0');
    if (!res.ok) return;
    const data = (await res.json()) as { reports?: ReportListRow[] };
    if (data.reports) setReports(data.reports);
  }

  async function runAction(busyKey: string, path: string) {
    setBusyId(busyKey);
    setError(null);
    const res = await fetch(path, { method: 'POST' });
    setBusyId(null);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError((data.error && ERROR_MESSAGES[data.error]) || '처리에 실패했어요.');
      return;
    }
    await refresh();
  }

  function deleteTarget(r: ReportListRow) {
    const path = r.targetType === 'post' ? `/api/admin/posts/${r.targetId}/delete` : `/api/admin/comments/${r.targetId}/delete`;
    runAction(`delete-${r.id}`, path);
  }

  function resolve(r: ReportListRow) {
    runAction(`resolve-${r.id}`, `/api/admin/reports/${r.id}/resolve`);
  }

  return (
    <div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.list}>
        {reports.length === 0 && <p className={styles.empty}>신고가 없어요.</p>}
        {reports.map((r) => (
          <div key={r.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.username}>
                {TARGET_TYPE_LABEL[r.targetType] ?? r.targetType} 신고 — {r.reason}
              </span>
              {r.targetDeleted ? (
                <span className={styles.meta}>이미 삭제된 대상이에요.</span>
              ) : (
                <span className={styles.fieldValue}>
                  {r.targetTitle && <strong>{r.targetTitle}</strong>}
                  {r.targetTitle && r.targetExcerpt && ' — '}
                  {r.targetExcerpt}
                  {(r.targetTitle || r.targetExcerpt) && r.targetAuthorUsername && ` (${r.targetAuthorUsername})`}
                </span>
              )}
              {reportTargetHref(r) && (
                <a
                  href={reportTargetHref(r)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)', width: 'fit-content' }}
                >
                  원문 보기 ↗
                </a>
              )}
              <span className={styles.meta}>
                신고자 {r.reporterUsername ?? '(삭제된 유저)'} · {new Date(r.createdAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <div className={styles.actions}>
              <span className={styles.badge}>{r.status === 'open' ? '미처리' : '처리됨'}</span>
              {/* 🔒 삭제는 DB 정책상(0035 — app_moderator_can_view) 신고가 open인
                  동안만 된다 — resolve 후엔 조용히 실패하니 버튼 자체를 숨긴다. */}
              {r.status === 'open' && !r.targetDeleted && (
                <button type="button" className={styles.banBtn} onClick={() => deleteTarget(r)} disabled={busyId !== null}>
                  삭제
                </button>
              )}
              {r.status === 'open' && (
                <button type="button" className={styles.unbanBtn} onClick={() => resolve(r)} disabled={busyId !== null}>
                  처리완료
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
