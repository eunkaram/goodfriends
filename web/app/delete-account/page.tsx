'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../components/AuthForm.module.css';
import { stripNonAscii } from '../../components/input-filters.ts';

type Step = 'notice' | 'confirm' | 'done';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIAL: '비밀번호가 올바르지 않아요.',
  NOT_AUTHENTICATED: '로그인이 필요해요.',
};

/**
 * §6.1 "탈퇴: 안내 → 확인 → 완료 3단계". 파괴적 동작이라 버튼은 외곽선만
 * (§11.2.4) — 채워진 "탈퇴하기" 버튼을 만들지 말 것.
 */
export default function DeleteAccountPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('notice');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');

  async function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const password = new FormData(e.currentTarget).get('password');
    try {
      const res = await fetch('/api/auth/delete-account', { method: 'POST', body: JSON.stringify({ password }) });
      if (!res.ok) {
        const { error: code } = await res.json();
        setError(ERROR_MESSAGES[code] ?? '탈퇴에 실패했어요.');
        return;
      }
      setStep('done');
      setTimeout(() => router.push('/'), 2000);
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
        {step === 'notice' && (
          <>
            <h1 className={styles.title}>탈퇴하기</h1>
            <p className={styles.subtitle}>
              탈퇴하면 작성하신 글·댓글·반응·친구·메시지 등 모든 데이터가 삭제되고 되돌릴 수 없어요.
            </p>
            <button className={styles.secondaryBtn} onClick={() => setStep('confirm')}>
              계속
            </button>
            <p className={styles.footer}>
              <a href="/">그만두기</a>
            </p>
          </>
        )}

        {step === 'confirm' && (
          <>
            <h1 className={styles.title}>정말 탈퇴하시겠어요?</h1>
            <p className={styles.subtitle}>본인 확인을 위해 비밀번호를 입력해주세요.</p>
            {error && <p className={styles.error}>{error}</p>}
            {/* 🔒 /qa 발견 — app/signup/page.tsx와 같은 이유·같은 방어(네이티브
                폴백이 GET이면 비밀번호가 URL에 남는다). */}
            <form onSubmit={onConfirm} method="post">
              <div className={styles.field}>
                <label htmlFor="password">비밀번호</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(stripNonAscii(e.target.value))}
                  required
                />
              </div>
              <button className={styles.destructiveBtn} type="submit" disabled={submitting}>
                {submitting ? '처리 중…' : '탈퇴하기'}
              </button>
            </form>
            <p className={styles.footer}>
              <a href="/">그만두기</a>
            </p>
          </>
        )}

        {step === 'done' && (
          <>
            <h1 className={styles.title}>탈퇴가 완료됐어요</h1>
            <p className={styles.subtitle}>그동안 이용해주셔서 감사했어요. 곧 홈으로 이동해요.</p>
          </>
        )}
      </div>
    </div>
  );
}
