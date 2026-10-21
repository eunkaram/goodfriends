import styles from '../../../components/AuthForm.module.css';

/**
 * 이메일 가입 직후 랜딩 페이지 — §6.1 "재발송 UI 필수"와는 별개로, 가입
 * 직후엔 인증 링크가 방금 발송됐다는 사실 자체를 안내한다. 인증 여부가
 * 로그인·열람은 막지 않지만(§11.9.3과 같은 원칙), 사용자 지시(2026-08-24)로
 * 글쓰기/댓글쓰기/공감하기는 인증 전까지 제한된다는 점을 여기서 미리
 * 안내한다 — "홈으로 가기"로 바로 나갈 수 있게 한다. 재발송은 홈 진입 후
 * 전역 EmailVerificationBanner(`app/layout.tsx`)가 계속 담당.
 *
 * 순수 정적 안내라 상태·fetch가 필요 없어 클라이언트 컴포넌트가 아니다.
 */
export default function VerifyEmailPendingPage() {
  return (
    <div className={styles.page}>
      <a className={styles.logo} href="/">
        AI Community
      </a>
      <div className={styles.card}>
        <h1 className={styles.title}>이메일을 확인해주세요</h1>
        <p className={styles.subtitle}>
          가입하신 이메일 주소로 인증 링크를 보냈어요. 메일함에서 링크를 눌러 인증을 완료해주세요. 인증 전에도 둘러보실 수 있지만, 글쓰기·댓글쓰기·공감하기는 인증 후에 이용하실 수 있어요.
        </p>
        <a className={styles.submit} href="/">
          홈으로 가기
        </a>
      </div>
    </div>
  );
}
