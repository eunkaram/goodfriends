'use client';

import { useEffect, useState } from 'react';

/**
 * 로그인 + 이메일 미인증 상태일 때만 보인다. §6.1 "재발송 UI 필수"의
 * 그 UI. 인증 여부가 로그인·열람 자체는 막지 않는다(§11.9.3과 같은 원칙) —
 * 다만 사용자 지시(2026-08-24)로 글쓰기/댓글쓰기/공감하기는 서버가 막고
 * 그 자리에서 인라인 안내를 보여준다(`EmailVerifyNotice.tsx`). 이 배너는
 * 모든 페이지에서 보이도록 `app/layout.tsx`에 전역으로 둔다.
 */
export function EmailVerificationBanner() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVisible(Boolean(data && data.emailVerified === false)))
      .catch(() => {});
  }, []);

  if (!visible) return null;

  async function resend() {
    setStatus('sending');
    try {
      await fetch('/api/auth/verify-email/resend', { method: 'POST' });
      setStatus('sent');
    } catch {
      setStatus('idle');
    }
  }

  return (
    <div
      style={{
        background: 'var(--chip-bg)',
        borderBottom: '1px solid var(--border)',
        padding: 'var(--space-sm) var(--space-xl)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-md)',
        font: 'var(--text-body-sm)',
        color: 'var(--text-secondary)',
      }}
    >
      <span>이메일 인증이 필요해요.</span>
      {status === 'sent' ? (
        <span style={{ color: 'var(--logo)', fontWeight: 600 }}>인증 메일을 다시 보냈어요.</span>
      ) : (
        <button
          onClick={resend}
          disabled={status === 'sending'}
          style={{ background: 'none', border: 'none', color: 'var(--logo)', fontWeight: 600, cursor: 'pointer', padding: 0 }}
        >
          {status === 'sending' ? '보내는 중…' : '인증 메일 다시 받기'}
        </button>
      )}
    </div>
  );
}
