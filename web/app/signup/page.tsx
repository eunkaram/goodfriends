'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../components/AuthForm.module.css';
import { COUNTRIES } from '../../lib/countries.ts';
import { stripNonAscii, stripNonDigits } from '../../components/input-filters.ts';

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_TAKEN: '이미 가입된 이메일이에요.',
  RECENTLY_DELETED: '최근 탈퇴한 이메일이에요. 7일 후 다시 가입할 수 있어요.',
  UNDERAGE: '가입 가능한 나이가 아니에요.',
  INVALID_INPUT: '입력하신 내용을 다시 확인해주세요.',
};

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 사용자 지시(2026-08-25, "생년월일 입력시 년도부분에... 현재년도-100~현재 년도까지") — 렌더마다 새로 계산해 오늘 날짜를 반영한다.
  const birthdateMax = new Date().toISOString().slice(0, 10);
  const birthdateMin = `${new Date().getFullYear() - 100}-01-01`;
  const [postalCodeValue, setPostalCodeValue] = useState('');
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const body = {
      nickname: form.get('nickname'),
      email: form.get('email'),
      password: form.get('password'),
      birthdate: form.get('birthdate'),
      country: form.get('country'),
      postalCode: form.get('postalCode') || undefined,
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
      <a className={styles.logo} href="/">
        Reafy
      </a>
      <div className={styles.card}>
        <div className={styles.titleGroup}>
          {/* 🔒 Claude Design 확정안(2026-08) — 기존 "가입하기"에서 artifact 실측 카피로 교체 */}
          <h1 className={styles.title}>함께 기록할 준비 되셨나요</h1>
          <p className={styles.subtitle}>세상을 읽고, 나를 기록하는 커뮤니티</p>
        </div>

        <div className={styles.divider}>이메일로 가입</div>

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

          <div className={styles.row}>
            <div className={styles.field}>
              {/* 사용자 지시(2026-08-25) — 년도 4자리(현재년도-100~현재년도)로 제한. type=date는 년도 세그먼트가 4자리를 넘게 입력받지 않아 별도 처리가 필요 없다. */}
              <input id="birthdate" name="birthdate" type="date" min={birthdateMin} max={birthdateMax} aria-label="생년월일" required />
            </div>
            <div className={styles.field}>
              <div className={styles.selectWrap}>
                <select id="country" name="country" defaultValue="KR" aria-label="거주 국가" required>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className={styles.selectChevron}>
                  <ChevronDownIcon />
                </span>
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <input
              id="postalCode"
              name="postalCode"
              placeholder="우편번호 (선택)"
              aria-label="우편번호 (선택)"
              inputMode="numeric"
              value={postalCodeValue}
              onChange={(e) => setPostalCodeValue(stripNonDigits(e.target.value, 5))}
            />
          </div>

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
