'use client';

import { useState, type FormEvent } from 'react';
import styles from '../../components/AuthForm.module.css';
import { stripNonAscii } from '../../components/input-filters.ts';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailValue, setEmailValue] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const email = new FormData(e.currentTarget).get('email');
    try {
      await fetch('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) });
    } finally {
      // 🔒 계정 존재 여부와 무관하게 항상 같은 화면을 보여준다 — 이메일 스캐닝 방지
      setSent(true);
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <a className={styles.logo} href="/">
        Reafy
      </a>
      <div className={styles.card}>
        {sent ? (
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>이메일을 확인해주세요</h1>
            <p className={styles.subtitle}>입력하신 주소로 가입된 계정이 있다면, 비밀번호 재설정 링크를 보내드렸어요.</p>
          </div>
        ) : (
          <>
            <div className={styles.titleGroup}>
              {/* 🔒 Claude Design 확정안(2026-08) — artifact 실측 카피로 교체 */}
              <h1 className={styles.title}>비밀번호를 잊으셨나요?</h1>
              <p className={styles.subtitle}>가입하신 이메일을 입력하시면 재설정 링크를 보내드려요.</p>
            </div>
            {/* 🔒 사용자 지시(2026-08) — artifact는 인풋에 보이는 라벨이 없다(placeholder만) */}
            <form className={styles.formContents} onSubmit={onSubmit}>
              <div className={styles.field}>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="이메일"
                  aria-label="이메일"
                  value={emailValue}
                  onChange={(e) => setEmailValue(stripNonAscii(e.target.value))}
                  required
                />
              </div>
              <button className={styles.submit} type="submit" disabled={submitting}>
                {submitting ? '전송 중…' : '재설정 링크 보내기'}
              </button>
            </form>
          </>
        )}
        <p className={styles.footer}>
          <a href="/signin">로그인으로 돌아가기</a>
        </p>
      </div>
    </div>
  );
}
