'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from '../../components/AuthForm.module.css';

type Status = 'checking' | 'success' | 'error';

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    fetch('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then((res) => setStatus(res.ok ? 'success' : 'error'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className={styles.page}>
      <a className={styles.logo} href="/">
        AI Community
      </a>
      <div className={styles.card}>
        {status === 'checking' && (
          <>
            <h1 className={styles.title}>확인하는 중…</h1>
            <p className={styles.subtitle}>잠시만 기다려주세요.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h1 className={styles.title}>이메일 인증이 완료됐어요</h1>
            <p className={styles.subtitle}>이제 모든 기능을 이용하실 수 있어요.</p>
            <a className={styles.submit} href="/">
              홈으로
            </a>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className={styles.title}>인증 링크가 유효하지 않아요</h1>
            <p className={styles.subtitle}>만료됐거나 이미 사용된 링크예요. 로그인 후 인증 메일을 다시 받아보세요.</p>
            <a className={styles.submit} href="/signin">
              로그인하러 가기
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
