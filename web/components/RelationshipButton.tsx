'use client';

import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useLoginRequiredDialog } from './LoginRequiredDialog.tsx';
import type { RelationshipStatus } from '../lib/user-log.ts';

export interface RelationshipButtonProps {
  targetUserId: string;
  initialStatus: RelationshipStatus;
  initialFollowing: boolean;
  isLoggedIn: boolean;
}

/* 🔒 Claude Design 확정안(artifact showOtherProfile) 실측 — 다른 프로필의
   액션 버튼은 height:38px, padding:0 20px, radius:9999px(pill)다. display:flex
   중앙정렬은 이 프로젝트에서 반복돼온 "pill 버튼 세로 중앙정렬 누락" 버그를
   처음부터 예방하려고 넣었다. */
const btnStyle = (filled: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 38,
  fontSize: 15,
  fontWeight: 600,
  color: filled ? 'var(--on-accent)' : 'var(--text-primary)',
  background: filled ? 'var(--accent)' : 'var(--raised)',
  border: filled ? 'none' : '1px solid var(--border)',
  borderRadius: 'var(--radius-full)',
  padding: '0 20px',
  cursor: 'pointer',
  marginRight: 'var(--space-sm)',
});

/**
 * §11.7.6 2번 원래는 "친구 / 팔로우 버튼"이었다 — §6.5 상태 머신을 그대로
 * 반영해 친구 신청/수락/상태 표시까지 전부 있었다.
 *
 * 🔒 사용자 지시(2026-08-26, "프로필 페이지에서 친구신청 버튼을 제거해줘"
 * → 후속 "신청 수락·이미 보낸 신청 표시·이미 성립된 친구 관계 표시는 이거
 * 다 무시하고 안보이게 해줘") — 친구 관련 UI를 이 컴포넌트에서 전부 뺐다
 * (친구 기능 전반을 차후로 미루는 결정과 같은 선). `initialStatus` prop과
 * `RelationshipStatus` 타입은 "self"(본인 프로필엔 버튼 자체를 안 보여줌)
 * 판정에만 쓰고, 나머지 친구 관련 상태값('none'/'pending_sent'/
 * 'pending_received'/'friends')은 이 컴포넌트에서 더 이상 아무것도
 * 렌더하지 않는다 — 이제 팔로우 버튼만 남았다.
 *
 * 팔로우 "보내기"는 P4(§11.9.2)의 /api/intent/execute를 그대로 쓴다 —
 * 로그인 사용자가 직접 눌러도 같은 재검증 경로를 탄다(별도 엔드포인트를 만들지 않는다).
 * "확인 후 실행"(§11.9.2)이라 버튼을 누르면 바로 실행되지 않고 확인 팝업이 뜬다.
 *
 * 🔒 후속(2026-08, "모든 버튼에서 두번 누르기 기능을 팝업으로 대체하고
 * 싶어" → "공용컴포넌트로 뽑아내줘") — 원래는 "같은 버튼을 두 번 눌러
 * 라벨이 바뀌는" 2클릭 패턴이었다. 공용 `ConfirmDialog`로 옮기면서
 * `destructive={false}`를 썼다 — 이 확인은 파괴적 액션이 아니라 상대에게
 * 알림이 가는 액션이라(§11.9.2 근거), 확인 버튼 쪽이 accent로 채워지고
 * autoFocus를 받는다(이미 한 번 누른 의도를 존중해 진행이 기본 경로).
 * "팔로우 취소"(언팔로우)는 상대에게 알림이 안 가는 되돌리기라 원래부터
 * 확인 없이 바로 실행됐다 — 그 동작은 그대로 유지했다.
 */
export function RelationshipButton({ targetUserId, initialStatus, initialFollowing, isLoggedIn }: RelationshipButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [confirmFollowOpen, setConfirmFollowOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { openLoginDialog, loginDialog } = useLoginRequiredDialog();

  function requireLogin(): boolean {
    if (!isLoggedIn) {
      // 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을... 로그인으로
      // 이동") — 즉시 리다이렉트 대신 로그인 확인 모달로 통일.
      openLoginDialog();
      return false;
    }
    return true;
  }

  async function onFollowClick() {
    if (!requireLogin() || pending) return;
    if (following) {
      setPending(true);
      try {
        await fetch('/api/follows', { method: 'DELETE', body: JSON.stringify({ followeeId: targetUserId }) });
        setFollowing(false);
      } finally {
        setPending(false);
      }
      return;
    }
    setConfirmFollowOpen(true);
  }

  async function onConfirmFollow() {
    setPending(true);
    try {
      const res = await fetch('/api/intent/execute', {
        method: 'POST',
        body: JSON.stringify({
          intent: { action: 'follow', targetId: targetUserId, returnTo: window.location.pathname },
          confirmed: true,
        }),
      });
      const result = await res.json();
      if (result.status === 'executed') setFollowing(true);
    } finally {
      setPending(false);
      setConfirmFollowOpen(false);
    }
  }

  if (initialStatus === 'self') return null;

  return (
    <div>
      <button type="button" style={btnStyle(false)} onClick={onFollowClick} disabled={pending}>
        {following ? '팔로우 중' : '팔로우'}
      </button>

      <ConfirmDialog
        open={confirmFollowOpen}
        message="이 사람을 팔로우할까요? 상대에게 알림이 가요."
        confirmLabel="팔로우"
        pendingLabel="처리 중…"
        pending={pending}
        destructive={false}
        onConfirm={onConfirmFollow}
        onCancel={() => setConfirmFollowOpen(false)}
      />
      {loginDialog}
    </div>
  );
}
