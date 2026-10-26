'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../components/AuthForm.module.css';
import { SITE_NAME, SITE_TAGLINE } from '../../lib/site.ts';
import { stripNonAscii } from '../../components/input-filters.ts';

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_TAKEN: '이미 가입된 이메일이에요.',
  RECENTLY_DELETED: '최근 탈퇴한 이메일이에요. 7일 후 다시 가입할 수 있어요.',
  INVALID_INPUT: '입력하신 내용을 다시 확인해주세요.',
};

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  // 🔒 2026-10-26 — app/signin과 같은 소셜 로그인 연동(Google/GitHub).
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3010';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const body = {
      nickname: form.get('nickname'),
      email: form.get('email'),
      password: form.get('password'),
    };

    try {
      const res = await fetch('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const { error: code } = await res.json();
        setError(ERROR_MESSAGES[code] ?? '가입에 실패했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      router.push('/verify-email/pending');
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
          {/* 🔒 CLAUDE.md 3. 정해진 제품 규칙 — 회원가입 제목은 "당신의 AI 경험을 들려주세요" 고정 */}
          <h1 className={styles.title}>당신의 AI 경험을 들려주세요</h1>
          <p className={styles.subtitle}>{SITE_TAGLINE}</p>
        </div>

        <div className={styles.social}>
          <a className={styles.socialBtnGoogle} href={`${apiBase}/api/auth/google`}>
            <img src="/gf/images/google-g.png" alt="" className={styles.socialIcon} />
            Google로 계속하기
          </a>
          <a className={styles.socialBtnGithub} href={`${apiBase}/api/auth/github`}>
            <img src="/gf/images/github-mark-white.png" alt="" className={styles.socialIcon} />
            GitHub로 계속하기
          </a>
        </div>

        <div className={styles.divider}>이메일 가입</div>

        {error && <p className={styles.error}>{error}</p>}

        {/* 🔒 사용자 지시(2026-08) — artifact는 인풋에 보이는 라벨이 없다(placeholder만).
            aria-label로 접근성 이름만 유지. */}
        {/* 🔒 /qa 발견 — onSubmit이 preventDefault를 걸어도, JS 인터셉트가
            어떤 이유로든(자동화 클릭·확장 프로그램 충돌 등) 안 먹으면 method
            기본값(GET)이라 비밀번호가 그대로 URL에 남는다. method="post"는
            그 네이티브 폴백 자체를 무해하게 만드는 방어선 — action이 없어도
            POST 폴백은 현재 URL로 body 전송만 하고 페이지 컴포넌트엔 POST
            핸들러가 없어 값이 노출되지 않는다. */}
        <form className={styles.formContents} onSubmit={onSubmit} method="post">
          <div className={styles.field}>
            <input id="nickname" name="nickname" placeholder="닉네임" aria-label="닉네임" required />
          </div>

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
              minLength={8}
              value={passwordValue}
              onChange={(e) => setPasswordValue(stripNonAscii(e.target.value))}
              required
            />
          </div>

          {/* 🔒 사용자 지시(2026-10-19, "회원가입에서 생년월일, 위치, zipcode 입력창
              제거") — 가입은 닉네임·이메일·비밀번호만 받는다. 생년월일·국가는
              선택 입력이 되어 NULL 저장 백엔드(auth.ts) 코멘트 참고 — 온보딩
              (/onboarding) 또는 프로필 편집에서 채울 수 있다. */}

          <button className={styles.submit} type="submit" disabled={submitting}>
            {submitting ? '가입 중…' : '가입하기'}
          </button>
        </form>

        <p className={styles.footer}>
          이미 계정이 있으신가요? <a href="/signin">로그인</a>
        </p>
      </div>
    </div>
  );
}
