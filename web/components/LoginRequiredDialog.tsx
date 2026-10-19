'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from './ConfirmDialog.tsx';

/**
 * §11.9.2 소프트 게이트 통합(사용자 지시, 2026-08-24, "관련된 페이지 모두
 * 모달을 띄우고 로그인이 필요한 서비스입니다. 취소/로그인 버튼을 보여주는거는
 * 어때? 비로그인시 모든 부분에 대해서 동일하게 적용") — 반응·댓글·구독·팔로우·
 * 친구신청을 비로그인 상태로 누르면 예전처럼 즉시 리다이렉트하지 않고 이
 * 확인 모달을 먼저 띄운다. "로그인" 확인 시 /signin으로 이동(과거 /signup
 * 통일 결정을 뒤집는 것도 같은 지시 — RelationshipButton.tsx 등 참고).
 * beforeRedirect는 §11.9.2 의도 보존(P4)이 필요한 호출부(ReactionBar의
 * 포스트 반응)만 넘긴다 — 확인을 누른 뒤에만 실행해 예전처럼 클릭 즉시
 * 저장되지 않는다.
 */
export function useLoginRequiredDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [beforeRedirect, setBeforeRedirect] = useState<(() => void | Promise<void>) | null>(null);

  function openLoginDialog(action?: () => void | Promise<void>) {
    setBeforeRedirect(() => action ?? null);
    setOpen(true);
  }

  async function onConfirm() {
    if (beforeRedirect) {
      setPending(true);
      try {
        await beforeRedirect();
      } finally {
        setPending(false);
      }
    }
    router.push('/signin');
  }

  const loginDialog = (
    <ConfirmDialog
      open={open}
      message="로그인이 필요한 서비스입니다."
      confirmLabel="로그인"
      pendingLabel="이동 중…"
      pending={pending}
      destructive={false}
      onConfirm={onConfirm}
      onCancel={() => setOpen(false)}
    />
  );

  return { openLoginDialog, loginDialog };
}
