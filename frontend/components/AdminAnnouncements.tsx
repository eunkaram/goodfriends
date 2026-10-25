'use client';

import { useEffect, useState } from 'react';
import styles from '../app/admin/admin.module.css';

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  createdAt: string;
};

/**
 * 공지사항 작성/토글 — reafy_frontend 이슈 #15, reafy_backend 이슈 #10.
 * AdminPostSearch.tsx와 같은 패턴 — `/api/admin/announcements`만 직접
 * fetch한다(서버 컴포넌트용 lib/announcements.ts는 유저 조회 전용, next/headers를
 * 쓰는 모듈이라 클라이언트 컴포넌트에서 import하면 안 된다).
 */
export function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadAnnouncements() {
    const res = await fetch('/api/admin/announcements');
    const data = (await res.json()) as { announcements?: AnnouncementRow[] };
    setAnnouncements(data.announcements ?? []);
  }

  useEffect(() => {
    loadAnnouncements();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch('/api/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError('등록에 실패했어요.');
      return;
    }
    setTitle('');
    setBody('');
    await loadAnnouncements();
  }

  async function toggleActive(id: string, nextActive: boolean) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/announcements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: nextActive }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError('상태 변경에 실패했어요.');
      return;
    }
    await loadAnnouncements();
  }

  return (
    <div>
      <form className={styles.banForm} onSubmit={submit}>
        <input
          type="text"
          placeholder="제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="공지 제목"
          required
        />
        <textarea placeholder="내용" value={body} onChange={(e) => setBody(e.target.value)} aria-label="공지 내용" required />
        <div className={styles.banFormActions}>
          <button type="submit" className={styles.toggleBtn} disabled={submitting}>
            등록
          </button>
        </div>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list} style={{ marginTop: 'var(--space-lg)' }}>
        {announcements.length === 0 && <p className={styles.empty}>등록된 공지가 없어요.</p>}
        {announcements.map((a) => (
          <div key={a.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.username}>{a.title}</span>
              <span className={styles.fieldValue}>{a.body}</span>
              <span className={styles.meta}>
                {a.isActive ? '노출중' : '비공개'} · {new Date(a.createdAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={a.isActive ? `${styles.toggleBtn} ${styles.toggleBtnActive}` : styles.toggleBtn}
                onClick={() => toggleActive(a.id, !a.isActive)}
                disabled={busyId !== null}
              >
                {a.isActive ? '비공개로' : '노출하기'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
