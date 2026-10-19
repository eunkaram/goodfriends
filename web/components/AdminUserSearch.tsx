'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '../app/admin/admin.module.css';

type UserRow = {
  id: string;
  username: string;
  nickname: string;
  isModerator: boolean;
  isAgent: boolean;
  isBanned: boolean;
};

const PAGE_SIZE = 20;

type RoleTab = 'all' | 'moderator' | 'agent' | 'general';

const ROLE_TABS: { key: RoleTab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'moderator', label: '모더레이터' },
  { key: 'agent', label: '에이전트' },
  { key: 'general', label: '일반' },
];

const ROLE_TAB_KEYS = new Set<string>(ROLE_TABS.map((t) => t.key));

type RoleCounts = { all: number; moderator: number; agent: number; general: number };

const BAN_ERROR_MESSAGES: Record<string, string> = {
  SELF_LOCKOUT: '유일하게 활성 상태인 모더레이터는 밴할 수 없어요.',
  ALREADY_BANNED: '이미 밴된 유저예요.',
  INVALID_INPUT: '밴 사유를 입력해주세요.',
  NOT_FOUND: '유저를 찾을 수 없어요.',
};

/**
 * 유저 목록(검색어 없으면 가입 최신순 전체) + 밴/해제. admin-http.ts의
 * /api/admin/users* 라우트만 호출한다 — SQL은 이 컴포넌트에 없다. 상세/
 * 닉네임 수정/모더레이터 권한은 /admin/users/[id](AdminUserDetail.tsx) 몫.
 */
export function AdminUserSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRole = searchParams.get('role') ?? '';
  const [query, setQuery] = useState('');
  // 🔒 사용자 발견(2026-09-07, "일반 -> 상세페이지 -> 목록보기를 클릭하면
  // 전체탭으로 이동되어버리네") — role이 컴포넌트 로컬 state뿐이라 상세
  // 페이지로 이동했다 돌아오면(이 컴포넌트가 리마운트) 항상 'all'로
  // 리셋됐다. URL 쿼리(?role=)를 진실의 원천으로 삼아 selectRole()이 URL도
  // 같이 바꾸고, 초기 state도 여기서 그 값을 읽어온다.
  const [role, setRole] = useState<RoleTab>(ROLE_TAB_KEYS.has(initialRole) ? (initialRole as RoleTab) : 'all');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [counts, setCounts] = useState<RoleCounts | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [banTargetId, setBanTargetId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSearch(nextOffset: number, append: boolean, roleOverride?: RoleTab) {
    setError(null);
    const roleParam = (roleOverride ?? role) === 'all' ? '' : `&role=${roleOverride ?? role}`;
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${nextOffset}${roleParam}`);
    const data = (await res.json()) as { users?: UserRow[]; counts?: RoleCounts };
    const rows = data.users ?? [];
    setUsers((prev) => (append ? [...prev, ...rows] : rows));
    setOffset(nextOffset);
    setHasMore(rows.length === PAGE_SIZE);
    if (data.counts) setCounts(data.counts);
  }

  // 검색어 없이 들어오면 바로 목록이 보이게 — "검색만 되고 리스트가 없다"는 문제 해결.
  useEffect(() => {
    runSearch(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔒 사용자 지시(2026-09-06, "유저 리스트를 모더레이터, 에이전트, 일반으로
  // 나눠서... 탭 메뉴") — 탭 전환은 검색어를 그대로 둔 채 role만 바꿔서
  // 페이지 0부터 다시 부른다(offset이 다른 탭 것이면 "더 보기" 계산이 꼬인다).
  function selectRole(next: RoleTab) {
    if (next === role) return;
    setRole(next);
    runSearch(0, false, next);
    router.replace(next === 'all' ? '/admin' : `/admin?role=${next}`, { scroll: false });
  }

  async function submitBan(targetId: string) {
    if (!banReason.trim()) {
      setError(BAN_ERROR_MESSAGES.INVALID_INPUT);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${targetId}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: banReason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError((data.error && BAN_ERROR_MESSAGES[data.error]) || '밴 처리에 실패했어요.');
      return;
    }
    setBanTargetId(null);
    setBanReason('');
    await runSearch(0, false);
  }

  async function submitUnban(targetId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${targetId}/unban`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError((data.error && BAN_ERROR_MESSAGES[data.error]) || '해제 처리에 실패했어요.');
      return;
    }
    await runSearch(0, false);
  }

  return (
    <div>
      <div className={styles.roleTabs} role="tablist">
        {ROLE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={role === tab.key}
            className={role === tab.key ? `${styles.roleTab} ${styles.roleTabActive}` : styles.roleTab}
            onClick={() => selectRole(tab.key)}
          >
            {tab.label}
            {counts && <span className={styles.roleTabCount}> ({counts[tab.key]})</span>}
          </button>
        ))}
      </div>

      <form
        className={styles.searchRow}
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(0, false);
        }}
      >
        <input
          type="text"
          placeholder="username으로 검색 (비워두면 전체 목록)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="유저 검색"
        />
        <button type="submit">검색</button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list} style={{ marginTop: 'var(--space-lg)' }}>
        {users.length === 0 && <p className={styles.empty}>유저가 없어요.</p>}
        {users.map((u) => (
          <div key={u.id} className={styles.row}>
            <div className={styles.rowMain}>
              <a className={styles.username} href={role === 'all' ? `/admin/users/${u.id}` : `/admin/users/${u.id}?from=${role}`}>
                {u.username}
                {u.isModerator && <span className={styles.badge}> 모더레이터</span>}
                {u.isAgent && <span className={styles.badge}> 에이전트</span>}
                {u.isBanned && <span className={`${styles.badge} ${styles.badgeDanger}`}> 밴됨</span>}
              </a>
              <span className={styles.meta}>{u.nickname}</span>
              {banTargetId === u.id && (
                <div className={styles.banForm}>
                  <textarea
                    placeholder="밴 사유(필수)"
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                    aria-label="밴 사유"
                  />
                  <div className={styles.banFormActions}>
                    <button type="button" className={styles.cancelBtn} onClick={() => setBanTargetId(null)} disabled={busy}>
                      취소
                    </button>
                    <button type="button" className={styles.banBtn} onClick={() => submitBan(u.id)} disabled={busy}>
                      밴 확정
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className={styles.actions}>
              {u.isBanned ? (
                <button type="button" className={styles.unbanBtn} onClick={() => submitUnban(u.id)} disabled={busy}>
                  해제
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.banBtn}
                  onClick={() => {
                    setBanTargetId(u.id);
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
        ))}
      </div>

      {hasMore && (
        <button type="button" className={styles.cancelBtn} onClick={() => runSearch(offset + PAGE_SIZE, true)} disabled={busy}>
          더 보기
        </button>
      )}
    </div>
  );
}
