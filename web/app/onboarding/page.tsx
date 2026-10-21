'use client';

import { useEffect, useState, type FormEvent } from 'react';
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
  INVALID_INPUT: '입력하신 내용을 다시 확인해주세요.',
  EMAIL_TAKEN: '이미 가입된 이메일이에요. 그 계정으로 로그인해주세요.',
  RATE_LIMITED: '너무 여러 번 시도했어요. 잠시 후 다시 시도해주세요.',
};

type OnboardingStatus = { birthdate: boolean; country: boolean; email: boolean; suggestedEmail: string | null };

/**
 * 🔒 CEO 리뷰(2026-08-22, 카카오 무이메일 온보딩) — 예전엔 생년월일·국가
 * 2필드 고정 폼이었다. 이제 유저마다 실제로 빠진 필드가 다르다(구글은
 * 이메일은 항상 있고 생년월일·국가만 없음, 카카오는 이메일도 없을 수 있음,
 * 기존에 생년월일·국가만 채우고 이메일을 못 채운 유저는 이메일만 필요) —
 * 그래서 서버 상태(`/api/auth/onboarding/status`)를 먼저 물어보고 그
 * 결과에 맞는 필드만 그린다. RSC로 만들지 않고(auth.ts를 Next 서버 번들에
 * 끌어들이면 커스텀 서버 쪽 authPool()과 별개로 풀이 하나 더 생길 위험,
 * 불변식 20) 기존처럼 client fetch로 처리한다.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 사용자 지시(2026-08-25) — signup 페이지와 같은 생년월일 범위 제한(현재년도-100~현재년도).
  const birthdateMax = new Date().toISOString().slice(0, 10);
  const birthdateMin = `${new Date().getFullYear() - 100}-01-01`;
  const [emailValue, setEmailValue] = useState('');
  const [postalCodeValue, setPostalCodeValue] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/onboarding/status');
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/signin');
            return;
          }
          throw new Error(`status ${res.status}`);
        }
        const data = (await res.json()) as OnboardingStatus;
        if (cancelled) return;
        if (!data.birthdate && !data.country && !data.email) {
          router.push('/');
          return;
        }
        setStatus(data);
        setEmailValue(data.suggestedEmail ?? '');
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!status) return;
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const body: { birthdate?: string; country?: string; postalCode?: string; email?: string } = {};
    if (status.birthdate) body.birthdate = String(form.get('birthdate') ?? '');
    if (status.country) {
      body.country = String(form.get('country') ?? '');
      // 🔒 사용자 지시(2026-08-23) — signup 페이지와 같은 이유로 선택 입력
      // (§6.1 "선택. 마켓 진입 시 유도") — 생년월일·국가와 같이 뜰 때만 받는다.
      const postalCode = String(form.get('postalCode') ?? '').trim();
      if (postalCode) body.postalCode = postalCode;
    }
    if (status.email) body.email = String(form.get('email') ?? '');

    try {
      const res = await fetch('/api/auth/onboarding', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const { error: code } = await res.json();
        if (code === 'UNDERAGE') {
          // 서버가 이미 계정·세션을 지웠다 — 여긴 안내만 보여준다, 재시도 폼은 의미 없다.
          setBlocked(true);
          return;
        }
        setError(ERROR_MESSAGES[code] ?? '처리에 실패했어요. 잠시 후 다시 시도해주세요.');
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
    // 🔒 사용자 지시(2026-08-25, "컨텐츠를 상단 120px로 이동") — 이전엔
    // 화면높이 1/3(33vh)이었다. 다른 AuthForm.module.css 공용 화면(로그인/
    // 가입 등)은 그대로 중앙 정렬을 유지해야 해서, 이 페이지에만 인라인
    // 스타일로 좁혀 적용한다(공용 클래스 .page를 직접 고치면 signin/signup/
    // account/delete 등도 다 같이 움직임).
    <div className={styles.page} style={{ justifyContent: 'flex-start', paddingTop: '120px' }}>
      <a className={styles.logo} href="/">
        AI Community
      </a>
      <div className={styles.card}>
        {blocked ? (
          <>
            <h1 className={styles.title}>가입할 수 없어요</h1>
            <p className={styles.subtitle}>AI Community는 만 14세 이상만 이용할 수 있어요. 입력하신 내용 기준으로는 아직 이용하실 수 없어요.</p>
            <a className={styles.footer} href="/">
              홈으로 돌아가기
            </a>
          </>
        ) : loadError ? (
          <>
            <h1 className={styles.title}>불러오지 못했어요</h1>
            <p className={styles.subtitle}>네트워크 연결을 확인하고 새로고침해주세요.</p>
          </>
        ) : !status ? null : (
          <>
            <h1 className={styles.title}>마지막 정보를 알려주세요</h1>
            <p className={styles.subtitle}>소셜 계정에서는 일부 정보를 받아오지 못해요. 서비스 이용을 위해 마저 입력해주세요.</p>

            {error && <p className={styles.error}>{error}</p>}

            {/* 🔒 사용자 지시(2026-08-25, "legend제거하고 placeholder로 처리.
                회원가입페이지와 동일하게 구성") — app/signup/page.tsx와 같은
                패턴: 보이는 <label> 없이 placeholder+aria-label만 쓴다.
                className={styles.formContents}도 signup처럼 <form> 자체에
                바로 붙여 카드의 gap:20px 스택을 그대로 받는다("버튼과
                입력폼이 너무 붙어 있어"서 도입했던 감싸는 div는 더 이상
                불필요 — signup은 처음부터 이 구조였다). */}
            <form className={styles.formContents} onSubmit={onSubmit}>
              {/* 🔒 사용자 지시(2026-09-01, "이메일박스를 제일 위로 올려줘") —
                  X처럼 이메일 자체를 아예 안 주는 provider는 생년월일·국가와
                  함께 이메일도 이 폼에서 한꺼번에 받는데, 입력 항목 중
                  이메일이 시각적으로 가장 눈에 띄어야 한다는 판단(그동안은
                  아래 블록 뒤에 있었다) — 필드 순서만 위로 옮긴다, 상태·검증
                  로직은 그대로. */}
              {status.email && (
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
              )}

              {(status.birthdate || status.country) && (
                <>
                  <div className={styles.row}>
                    {status.birthdate && (
                      <div className={styles.field}>
                        <input
                          id="birthdate"
                          name="birthdate"
                          type="date"
                          min={birthdateMin}
                          max={birthdateMax}
                          aria-label="생년월일"
                          required
                        />
                      </div>
                    )}
                    {status.country && (
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
                    )}
                  </div>
                  {/* 🔒 사용자 지시(2026-08-23, "지역 zip코드도 입력 받게") —
                      app/signup/page.tsx의 우편번호 필드와 같은 패턴(선택
                      입력, §6.1 "마켓 진입 시 유도" — 이 자리에서도 국가와
                      같이 뜰 때만 받는다). ProfileEditModal의 실시간 위치
                      미리보기(country+postalCode → location-preview API)는
                      가입 순간엔 과한 기능이라 안 가져왔다 — signup 페이지와
                      동일하게 단순 입력만 받는다. */}
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
                </>
              )}

              <button className={styles.submit} type="submit" disabled={submitting}>
                {submitting ? '확인 중…' : '계속하기'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
