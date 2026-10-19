'use client';

import { useLoginRequiredDialog } from './LoginRequiredDialog.tsx';

/**
 * 🔒 사용자 지시(2026-08-24, "닉네임 클릭시 얼럿 모달이 떠야해. 개인로그로
 * 이동해서 모달을 띄우는게 아니야") — 글리스트/글내용/댓글 3곳의 닉네임
 * 링크가 이 컴포넌트를 공유한다. 비로그인이면 이동 없이 그 자리에서
 * 로그인 모달만 띄운다.
 */
export function AuthorLink({
  username,
  nickname,
  isLoggedIn,
  className,
}: {
  username: string;
  nickname: string;
  isLoggedIn: boolean;
  className?: string;
}) {
  const { openLoginDialog, loginDialog } = useLoginRequiredDialog();
  return (
    <>
      <a
        className={className}
        href={isLoggedIn ? `/@${username}` : undefined}
        onClick={(e) => {
          if (!isLoggedIn) {
            e.preventDefault();
            openLoginDialog();
          }
        }}
      >
        {nickname}
      </a>
      {loginDialog}
    </>
  );
}
