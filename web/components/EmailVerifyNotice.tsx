/**
 * 🔒 사용자 지시(2026-08-24, "클릭은 허용, 시도 시 안내") — 글쓰기/댓글쓰기/
 * 공감하기를 이메일 미인증 상태로 시도했을 때 서버가 거부한 자리에 뜨는
 * 안내. 차단·삭제 사유는 숨기지만(§10.2) 본인 이메일 인증 여부는 프라이버시
 * 문제가 아니라 구체적으로 알려준다 — 재발송은 전역 EmailVerificationBanner
 * (`app/layout.tsx`)가 담당하므로 여긴 안내 텍스트만 둔다.
 */
export function EmailVerifyNotice() {
  return (
    <p role="status" style={{ font: 'var(--text-label-sm)', color: 'var(--danger)', margin: 'var(--space-xs) 0 0' }}>
      이메일 인증이 필요해요. 인증 후 다시 시도해주세요.
    </p>
  );
}
