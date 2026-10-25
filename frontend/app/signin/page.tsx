'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../components/AuthForm.module.css';
import { SITE_NAME, SITE_TAGLINE } from '../../lib/site.ts';
import { stripNonAscii } from '../../components/input-filters.ts';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않아요.',
  INVALID_INPUT: '이메일과 비밀번호를 입력해주세요.',
  ACCOUNT_BANNED: '정지된 계정이에요.',
};

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  // 🔒 goodfriends CLAUDE.md 3. "소셜 로그인은 Google과 GitHub만" — 시안엔
  // 버튼이 있지만, 이 프로젝트 백엔드는 oauth를 아직 구현하지 않았다
  // (src/auth-http.ts "소셜 로그인(oauth)은 이 프로젝트에서 제외했다").
  // PROMPT.md "로그인 연동은 하지마" 범위를 지키면서 시안 그대로 버튼은
  // 보여주되, 클릭하면 실제 연동 대신 안내만 띄운다.
  const [oauthNotice, setOauthNotice] = useState<'google' | 'github' | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const body = { email: form.get('email'), password: form.get('password') };

    try {
      const res = await fetch('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const { error: code } = await res.json();
        setError(ERROR_MESSAGES[code] ?? '로그인에 실패했어요.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('네트워크 연결을 확인해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <a className={styles.logo} href="/" aria-label={SITE_NAME}>
        <img src="/gf/images/logo-mark.png" alt="" className={styles.logoMark} />
        <span className={styles.logoWordmark}>goodfriends</span>
      </a>
      <div className={styles.card}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>다시 만나서 반가워요</h1>
          <p className={styles.subtitle}>{SITE_TAGLINE}</p>
        </div>

        <div className={styles.social}>
          <button type="button" className={styles.socialBtnGoogle} onClick={() => setOauthNotice('google')}>
            <img src="/gf/images/google-g.png" alt="" className={styles.socialIcon} />
            Google로 계속하기
          </button>
          <button type="button" className={styles.socialBtnGithub} onClick={() => setOauthNotice('github')}>
            <img src="/gf/images/github-mark-white.png" alt="" className={styles.socialIcon} />
            GitHub로 계속하기
          </button>
          {oauthNotice && <p className={styles.socialNotice}>{oauthNotice === 'google' ? 'Google' : 'GitHub'} 로그인은 곧 지원할 예정이에요.</p>}
        </div>

        <div className={styles.divider}>이메일로 로그인</div>

        {error && <p className={styles.error}>{error}</p>}

        {/* 🔒 사용자 지시(2026-08) — artifact는 인풋에 보이는 라벨이 없다(placeholder만).
            aria-label로 접근성 이름만 유지. */}
        {/* 🔒 /qa 발견 — app/signup/page.tsx와 같은 이유·같은 방어(네이티브
            폴백이 GET이면 비밀번호가 URL에 남는다). */}
        <form className={styles.formContents} onSubmit={onSubmit} method="post">
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
          <div className={styles.field}>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="비밀번호"
              aria-label="비밀번호"
              value={passwordValue}
              onChange={(e) => setPasswordValue(stripNonAscii(e.target.value))}
              required
            />
          </div>
          <a className={styles.forgotLink} href="/forgot-password">
            비밀번호를 잊으셨나요?
          </a>

          <button className={styles.submit} type="submit" disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <p className={styles.footer}>
          아직 계정이 없으신가요? <a href="/signup">가입하기</a>
        </p>
      </div>
    </div>
  );
}
