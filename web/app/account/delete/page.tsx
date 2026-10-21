'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import authStyles from '../../../components/AuthForm.module.css';
import styles from './page.module.css';

type AccountSummary = {
  username: string;
  nickname: string;
  email: string | null;
  joinedAt: string;
  hasPassword: boolean;
  /** 소셜 전용 계정(비밀번호 없음)일 때만 채워진다 — 이 값을 그대로 입력받는다. */
  deleteConfirmationPhrase: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIAL: '입력하신 내용이 일치하지 않습니다.',
  RATE_LIMITED: '너무 여러 번 시도했습니다. 잠시 후 다시 시도해 주십시오.',
};

function joinedLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 계정 삭제 — §6.1 "안내 → 확인 → 완료 3단계". ProfileHeader의 "···"
 * 메뉴 "계정 삭제"에서 이 페이지로 이동해온다(사용자 지시, 2026-08-22).
 * 팝업 재확인 대신 이 페이지 자체가 확인 단계다 — 기본정보를 먼저 보여주고
 * (안내), 동의 체크 + 비밀번호/확인문구 재입력을 받은 뒤(확인)에만 실제
 * 삭제(src/auth.ts deleteAccount, 하드 삭제·유예 없음)를 호출한다.
 */
export default function DeleteAccountPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/account-summary');
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/signin');
            return;
          }
          throw new Error(`status ${res.status}`);
        }
        const data = (await res.json()) as AccountSummary;
        if (!cancelled) setSummary(data);
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
    if (!summary || !agreed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const body = summary.hasPassword ? { password: credential } : { confirmationPhrase: credential };
      const res = await fetch('/api/auth/delete-account', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const { error: code } = await res.json();
        setError(ERROR_MESSAGES[code] ?? '처리에 실패했습니다. 잠시 후 다시 시도해 주십시오.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('네트워크 연결을 확인해 주십시오.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={authStyles.page}>
      <a className={authStyles.logo} href="/">
        AI Community
      </a>
      <div className={authStyles.card}>
        {loadError ? (
          <>
            <h1 className={authStyles.title}>불러오지 못했어요</h1>
            <p className={authStyles.subtitle}>네트워크 연결을 확인하고 새로고침해 주십시오.</p>
          </>
        ) : !summary ? null : (
          <>
            <h1 className={authStyles.title}>계정을 삭제할까요?</h1>
            <p className={authStyles.subtitle}>
              삭제하면 글·댓글·메시지를 포함한 모든 데이터가 즉시 지워지고 되돌릴 수 없습니다. 같은 이메일로는 7일 동안 다시 가입할 수 없습니다.
            </p>

            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>아이디</span>
                <span className={styles.summaryValue}>@{summary.username}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>닉네임</span>
                <span className={styles.summaryValue}>{summary.nickname}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>이메일</span>
                <span className={styles.summaryValue}>{summary.email ?? '없음(소셜 로그인 전용)'}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>가입일</span>
                <span className={styles.summaryValue}>{joinedLabel(summary.joinedAt)}</span>
              </div>
            </div>

            {error && <p className={authStyles.error}>{error}</p>}

            <form onSubmit={onSubmit}>
              <div className={authStyles.formContents}>
                <label className={styles.consent}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  이 작업은 되돌릴 수 없으며, 모든 데이터가 삭제되는 것에 동의합니다.
                </label>

                <div className={authStyles.field}>
                  <label htmlFor="credential">{summary.hasPassword ? '비밀번호' : `확인 문구 — "${summary.deleteConfirmationPhrase}" 그대로 입력`}</label>
                  <input
                    id="credential"
                    name="credential"
                    type={summary.hasPassword ? 'password' : 'text'}
                    required
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder={summary.hasPassword ? undefined : (summary.deleteConfirmationPhrase ?? undefined)}
                  />
                </div>

                <div className={styles.actions}>
                  <a className={styles.cancelBtn} href={`/@${summary.username}`}>
                    취소
                  </a>
                  <button className={styles.deleteBtn} type="submit" disabled={!agreed || submitting}>
                    {submitting ? '삭제 중…' : '계정 삭제'}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
