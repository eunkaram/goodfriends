'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '../../components/AuthForm.module.css';
import { stripNonAscii } from '../../components/input-filters.ts';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_OR_EXPIRED_TOKEN: '링크가 만료됐거나 이미 사용됐어요. 다시 요청해주세요.',
  INVALID_INPUT: '비밀번호는 8자 이상이어야 해요.',
};

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError(ERROR_MESSAGES.INVALID_OR_EXPIRED_TOKEN);
      return;
    }
    setSubmitting(true);
    const newPassword = new FormData(e.currentTarget).get('newPassword');
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const { error: code } = await res.json();
        setError(ERROR_MESSAGES[code] ?? '재설정에 실패했어요.');
        return;
      }
      router.push('/signin');
    } catch {
      setError('네트워크 연결을 확인해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <a className={styles.logo} href="/">
        Reafy
      </a>
      <div className={styles.card}>
        <h1 className={styles.title}>새 비밀번호 설정</h1>
        <p className={styles.subtitle}>새로 쓰실 비밀번호를 입력해주세요.</p>

        {error && <p className={styles.error}>{error}</p>}

        {/* 🔒 /qa 발견 — app/signup/page.tsx와 같은 이유·같은 방어(네이티브
            폴백이 GET이면 새 비밀번호가 URL에 남는다). */}
        <form onSubmit={onSubmit} method="post">
          <div className={styles.field}>
            <label htmlFor="newPassword">새 비밀번호</label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              minLength={8}
              value={newPasswordValue}
              onChange={(e) => setNewPasswordValue(stripNonAscii(e.target.value))}
              required
            />
          </div>
          <button className={styles.submit} type="submit" disabled={submitting}>
            {submitting ? '변경 중…' : '비밀번호 변경'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}
