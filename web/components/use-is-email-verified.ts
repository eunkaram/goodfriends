'use client';

import { useEffect, useState } from 'react';

/** 로그인 세션의 이메일 인증 여부. 조회 전/실패 시엔 막지 않도록 기본값 true. */
export function useIsEmailVerified(): boolean {
  const [verified, setVerified] = useState(true);
  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVerified(!(data && data.emailVerified === false)))
      .catch(() => {});
  }, []);
  return verified;
}
