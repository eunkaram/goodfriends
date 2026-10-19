'use client';

import { useState } from 'react';
import type { ProfileLink } from '../lib/user-log.ts';
import { LinkIcon } from './LinkIcon.tsx';
import styles from './ProfileLinksEditor.module.css';

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * 사용자 지시(2026-08, "링크와 링크이름을 입력받고 저장하면 아래에 아이콘,
 * 이름이 보이고, 아이콘/링크이름을 클릭하면 수정할수 있게. 화면공간을
 * 절약하는게 목적이니까 UI를 잘 구성해야해") — 프로필 편집 모달의 옛 고정
 * 3필드(링크/인스타그램/트위터, 항상 펼쳐진 3개의 전체 너비 입력창)를
 * 대체한다. 평소엔 아이콘+이름 칩(pill) 한 줄만 차지해서 화면 공간을
 * 아끼고, 칩을 누르면(또는 "+ 링크 추가") 그 아래에 이름+URL 입력 폼이
 * 잠깐 펼쳐진다 — 한 번에 하나의 칩만 편집 가능하다(`editingId` 단일
 * 상태). 각 추가/수정/삭제는 즉시 서버에 반영된다(모달의 "저장" 버튼을
 * 기다리지 않는다) — "저장하면 아래에... 보이고"라는 지시가 링크 하나
 * 단위의 즉시 저장을 의미한다고 해석했다.
 */
export function ProfileLinksEditor({ links, onLinksChange }: { links: ProfileLink[]; onLinksChange: (next: ProfileLink[]) => void }) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔒 사용자 지시(2026-08, "프로필 편집에서 링크를 기본 링크 이름을 Reafy로
  // 변경해줘") — 새 링크를 추가할 때 이름 입력창의 기본값(placeholder가
  // 아니라 실제 채워진 값)을 "Reafy"로 미리 채운다. 사용자가 그대로 저장할
  // 수도, 다른 이름(예: Instagram)으로 덮어쓸 수도 있다.
  function openAdd() {
    setEditingId('new');
    setNameValue('Reafy');
    setUrlValue('');
    setError(null);
  }

  function openEdit(link: ProfileLink) {
    setEditingId(link.id);
    setNameValue(link.name);
    setUrlValue(link.url);
    setError(null);
  }

  function closeForm() {
    setEditingId(null);
    setError(null);
  }

  async function save() {
    if (saving || !nameValue.trim() || !urlValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId === 'new') {
        const res = await fetch('/api/profile-links', {
          method: 'POST',
          body: JSON.stringify({ name: nameValue.trim(), url: urlValue.trim() }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error === 'LIMIT_REACHED' ? '링크는 최대 8개까지 추가할 수 있어요.' : '입력값을 확인해주세요(URL은 http(s)://로 시작해야 해요).');
          return;
        }
        const { id } = (await res.json()) as { id: string };
        onLinksChange([...links, { id, name: nameValue.trim(), url: urlValue.trim() }]);
      } else if (editingId) {
        const res = await fetch(`/api/profile-links/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: nameValue.trim(), url: urlValue.trim() }),
        });
        if (!res.ok) {
          setError('입력값을 확인해주세요(URL은 http(s)://로 시작해야 해요).');
          return;
        }
        onLinksChange(links.map((l) => (l.id === editingId ? { ...l, name: nameValue.trim(), url: urlValue.trim() } : l)));
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving || editingId === 'new' || !editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/profile-links/${editingId}`, { method: 'DELETE' });
      if (res.ok) onLinksChange(links.filter((l) => l.id !== editingId));
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.chipRow}>
        {links.map((link) => (
          <button key={link.id} type="button" className={styles.chip} onClick={() => openEdit(link)}>
            <LinkIcon url={link.url} size={14} />
            {link.name}
          </button>
        ))}
        <button type="button" className={styles.addChip} onClick={openAdd}>
          <PlusIcon />
          링크 추가
        </button>
      </div>

      {editingId !== null && (
        <div className={styles.form}>
          <input
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder="이름 (예: Instagram)"
            maxLength={30}
            className={styles.nameInput}
            aria-label="링크 이름"
          />
          <input
            type="text"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="https://"
            maxLength={300}
            className={styles.urlInput}
            aria-label="링크 URL"
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.formActions}>
            {editingId !== 'new' && (
              <button type="button" className={styles.deleteBtn} onClick={remove} disabled={saving}>
                삭제
              </button>
            )}
            <button type="button" className={styles.cancelBtn} onClick={closeForm} disabled={saving}>
              취소
            </button>
            <button type="button" className={styles.saveBtn} onClick={save} disabled={saving || !nameValue.trim() || !urlValue.trim()}>
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
