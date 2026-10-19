'use client';

import { useEffect, useState } from 'react';
import styles from '../app/admin/admin.module.css';

type SourceRow = {
  id: string;
  userId: string;
  username: string;
  nickname: string | null;
  createdAt: string;
};

type DraftRow = {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
};

/**
 * 화제 다이제스트 제작 UI — M3 반수동 파이프라인(계정 리스트 관리 →
 * 초안 생성 → 확인/수정 → 발행). AdminAnnouncements.tsx와 같은 패턴 —
 * `/api/admin/digest/*`를 클라이언트에서 직접 fetch한다.
 */
export function AdminDigests() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [username, setUsername] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [sourcesRes, draftsRes] = await Promise.all([fetch('/api/admin/digest/sources'), fetch('/api/admin/digest/drafts')]);
    if (sourcesRes.ok) setSources(((await sourcesRes.json()) as { sources?: SourceRow[] }).sources ?? []);
    if (draftsRes.ok) setDrafts(((await draftsRes.json()) as { drafts?: DraftRow[] }).drafts ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  function selectDraft(draft: DraftRow) {
    setSelectedId(draft.id);
    setEditTitle(draft.title);
    setEditContent(draft.content);
    setStatus(null);
    setError(null);
  }

  async function addSource(e: React.FormEvent) {
    e.preventDefault();
    setBusy('addSource');
    setError(null);
    const res = await fetch('/api/admin/digest/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.status === 404 ? '그 핸들의 계정이 없어요.' : '추가에 실패했어요.');
      return;
    }
    setUsername('');
    await load();
  }

  async function removeSource(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/admin/digest/sources/${id}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) {
      setError('삭제에 실패했어요.');
      return;
    }
    await load();
  }

  async function generate() {
    setBusy('generate');
    setError(null);
    setStatus(null);
    const res = await fetch('/api/admin/digest/drafts/generate', { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(
        data.error === 'EMPTY_SOURCES_ACTIVITY'
          ? '최근 활동이 없어요 — 소재 계정이 활동했는지 확인하세요.'
          : data.error?.startsWith('LLM_FAILED')
            ? 'LLM 초안 생성에 실패했어요.'
            : '초안 생성에 실패했어요.',
      );
      return;
    }
    const data = (await res.json()) as { draft?: DraftRow };
    if (data.draft) selectDraft(data.draft);
    await load();
  }

  async function saveDraft() {
    if (!selectedId) return;
    setBusy('save');
    setError(null);
    const res = await fetch(`/api/admin/digest/drafts/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editTitle, content: editContent }),
    });
    setBusy(null);
    if (!res.ok) {
      setError('저장에 실패했어요.');
      return;
    }
    setStatus('저장했어요.');
    await load();
  }

  async function publish() {
    if (!selectedId) return;
    setBusy('publish');
    setError(null);
    const res = await fetch(`/api/admin/digest/drafts/${selectedId}/publish`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error === 'ALREADY_PUBLISHED' ? '이미 발행한 초안이에요.' : '발행에 실패했어요.');
      return;
    }
    const data = (await res.json()) as { postPublicId?: string };
    setStatus(`발행했어요 — /${data.postPublicId ?? ''}`);
    await load();
  }

  return (
    <div>
      {/* 1) 소재 계정 리스트 관리 */}
      <h2 className={styles.sectionTitle}>소재 계정</h2>
      <form className={styles.banForm} onSubmit={addSource}>
        <input
          type="text"
          placeholder="추가할 핸들(@ 제외)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label="소재 계정 핸들"
          required
        />
        <div className={styles.banFormActions}>
          <button type="submit" className={styles.toggleBtn} disabled={busy !== null}>
            추가
          </button>
        </div>
      </form>
      <div className={styles.list}>
        {sources.length === 0 && <p className={styles.empty}>소재 계정이 아직 없어요. 활동이 착실한 계정을 담으세요.</p>}
        {sources.map((s) => (
          <div key={s.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.username}>{s.username}</span>
              <span className={styles.meta}>{s.nickname ?? '(닉네임 없음)'}</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.unbanBtn} onClick={() => removeSource(s.id)} disabled={busy !== null}>
                제거
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 2) 초안 생성 */}
      <div style={{ marginTop: 'var(--space-lg)' }}>
        <button type="button" className={styles.toggleBtn} onClick={generate} disabled={busy !== null}>
          다이제스트 초안 생성
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {status && <p className={styles.meta}>{status}</p>}

      {/* 3) 초안 목록 + 편집기 */}
      <h2 className={styles.sectionTitle}>초안 목록</h2>
      <div className={styles.list}>
        {drafts.length === 0 && <p className={styles.empty}>생성된 초안이 없어요.</p>}
        {drafts.map((d) => (
          <div key={d.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.username}>{d.title}</span>
              <span className={styles.meta}>
                {d.status === 'published' ? '발행됨' : '초안'} · {new Date(d.createdAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={d.id === selectedId ? `${styles.toggleBtn} ${styles.toggleBtnActive}` : styles.toggleBtn}
                onClick={() => selectDraft(d)}
              >
                선택
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedId && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <h2 className={styles.sectionTitle}>초안 편집</h2>
          <form className={styles.banForm} onSubmit={(e) => e.preventDefault()}>
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="다이제스트 제목" />
            <textarea value={editContent} rows={14} onChange={(e) => setEditContent(e.target.value)} aria-label="다이제스트 본문" />
            <div className={styles.banFormActions}>
              <button type="button" className={styles.toggleBtn} onClick={saveDraft} disabled={busy !== null}>
                저장
              </button>
              <button type="button" className={`${styles.toggleBtn} ${styles.toggleBtnActive}`} onClick={publish} disabled={busy !== null}>
                ai-topics로 발행
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
