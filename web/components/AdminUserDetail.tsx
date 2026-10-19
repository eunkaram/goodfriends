'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UserDetailWithAuth } from '../lib/admin.ts';
import { AdminPostSearch } from './AdminPostSearch.tsx';
import { AdminCommentSearch } from './AdminCommentSearch.tsx';
import styles from '../app/admin/admin.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  SELF_LOCKOUT: '유일하게 활성 상태인 모더레이터예요 — 권한을 뺏거나 밴할 수 없어요.',
  ALREADY_BANNED: '이미 밴된 유저예요.',
  INVALID_INPUT: '입력값을 확인해주세요.',
  NOT_FOUND: '유저를 찾을 수 없어요.',
};

/** /admin/users/[id] 상세 — 닉네임 수정 · 모더레이터 권한 부여/해제 · 밴/해제. 전부 admin-http.ts만 호출한다. */
export function AdminUserDetail({ user: initialUser }: { user: UserDetailWithAuth }) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [nickname, setNickname] = useState(initialUser.nickname);
  const [banReason, setBanReason] = useState('');
  const [showBanForm, setShowBanForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/admin/users/${user.id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { user?: UserDetailWithAuth };
    if (data.user) setUser(data.user);
  }

  async function runAction(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError((data.error && ERROR_MESSAGES[data.error]) || '처리에 실패했어요.');
      return false;
    }
    await refresh();
    return true;
  }

  async function submitNickname(e: React.FormEvent) {
    e.preventDefault();
    await runAction(`/api/admin/users/${user.id}/nickname`, { nickname });
  }

  async function toggleModerator() {
    const ok = await runAction(`/api/admin/users/${user.id}/moderator`, { isModerator: !user.isModerator });
    if (ok) router.refresh(); // /admin/audit 등 다른 페이지의 서버 렌더 캐시도 갱신
  }

  async function toggleAgent() {
    const ok = await runAction(`/api/admin/users/${user.id}/agent`, { isAgent: !user.isAgent });
    if (ok) router.refresh();
  }

  async function submitBan(e: React.FormEvent) {
    e.preventDefault();
    if (!banReason.trim()) {
      setError(ERROR_MESSAGES.INVALID_INPUT);
      return;
    }
    const ok = await runAction(`/api/admin/users/${user.id}/ban`, { reason: banReason });
    if (ok) {
      setShowBanForm(false);
      setBanReason('');
    }
  }

  async function submitUnban() {
    await runAction(`/api/admin/users/${user.id}/unban`);
  }

  return (
    <>
    <div className={styles.detailCard}>
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.detailHead}>
        <span className={styles.detailUsername}>
          {user.username}
          {user.isModerator && <span className={styles.badge}> 모더레이터</span>}
          {user.isAgent && <span className={styles.badge}> 에이전트</span>}
          {user.isBanned && <span className={`${styles.badge} ${styles.badgeDanger}`}> 밴됨</span>}
        </span>
        <div className={styles.inlineForm}>
          <button
            type="button"
            className={user.isModerator ? `${styles.toggleBtn} ${styles.toggleBtnActive}` : styles.toggleBtn}
            onClick={toggleModerator}
            disabled={busy}
          >
            {user.isModerator ? '모더레이터 해제' : '모더레이터로 지정'}
          </button>
          <button
            type="button"
            className={user.isAgent ? `${styles.toggleBtn} ${styles.toggleBtnActive}` : styles.toggleBtn}
            onClick={toggleAgent}
            disabled={busy}
          >
            {user.isAgent ? '에이전트 해제' : '에이전트로 지정'}
          </button>
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>가입일</span>
        <span className={styles.fieldValue}>{new Date(user.createdAt).toLocaleString('ko-KR')}</span>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>이메일</span>
        <span className={styles.fieldValue}>
          {user.email ?? '(소셜 로그인 전용 계정)'}
          {user.email && (user.emailVerified ? ' — 인증됨' : ' — 미인증')}
        </span>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>아바타</span>
        <span className={styles.fieldValue}>{user.avatarUrl || '(없음)'}</span>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>생년월일</span>
        <span className={styles.fieldValue}>{user.birthdate ? new Date(user.birthdate).toLocaleDateString('ko-KR') : '(없음)'}</span>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>국가 / 우편번호</span>
        <span className={styles.fieldValue}>
          {user.country ?? '(없음)'} / {user.postalCode ?? '(없음)'}
        </span>
      </div>

      {user.isBanned && (
        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>밴 정보</span>
          <span className={styles.fieldValue}>
            {user.bannedReason} — {user.bannedByUsername ?? '(삭제된 유저)'}
            {user.bannedAt && ` · ${new Date(user.bannedAt).toLocaleString('ko-KR')}`}
          </span>
        </div>
      )}

      <form className={styles.fieldGroup} onSubmit={submitNickname}>
        <span className={styles.fieldLabel}>닉네임</span>
        <div className={styles.inlineForm}>
          <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} aria-label="닉네임" />
          <button type="submit" className={styles.banBtn} disabled={busy || !nickname.trim() || nickname === user.nickname}>
            저장
          </button>
        </div>
      </form>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>계정 상태</span>
        {user.isBanned ? (
          <button type="button" className={styles.unbanBtn} onClick={submitUnban} disabled={busy}>
            밴 해제
          </button>
        ) : showBanForm ? (
          <form className={styles.banForm} onSubmit={submitBan}>
            <textarea placeholder="밴 사유(필수)" value={banReason} onChange={(e) => setBanReason(e.target.value)} aria-label="밴 사유" />
            <div className={styles.banFormActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowBanForm(false)} disabled={busy}>
                취소
              </button>
              <button type="submit" className={styles.banBtn} disabled={busy}>
                밴 확정
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={styles.banBtn}
            style={{ width: 'fit-content' }}
            onClick={() => {
              setShowBanForm(true);
              setBanReason('');
              setError(null);
            }}
            disabled={busy}
          >
            밴
          </button>
        )}
      </div>
    </div>

    {/* 🔒 사용자 지시(2026-09-08, "유저로 글/댓글/공감등을 트래킹할 필요가
        있어") — 검색 화면과 같은 컴포넌트를 authorId로 좁혀 재사용한다.
        스코프는 검색 화면과 동일(전체공개 글/댓글만, comments.ts/posts.ts
        주석 참고) — 이 유저를 지목했다고 비공개 콘텐츠까지 열어주지 않는다. */}
    <div className={styles.detailCard}>
      <h2 className={styles.sectionTitle}>작성한 글</h2>
      <AdminPostSearch authorId={user.id} />
    </div>

    <div className={styles.detailCard}>
      <h2 className={styles.sectionTitle}>작성한 댓글</h2>
      <AdminCommentSearch authorId={user.id} />
    </div>
    </>
  );
}
