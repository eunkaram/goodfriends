'use client';

import { useRouter } from 'next/navigation';
import { Gnb, type GnbCategoryGroup } from './Gnb.tsx';
import { ComposerModalProvider } from './composer-modal-context.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

/**
 * §11.9.2 소프트 게이트 통합(사용자 지시, 2026-08-24) — 개인 로그·앨범·
 * 친구 목록·저장한 글·메시지처럼 페이지 전체가 로그인을 요구하는 화면의
 * 공용 게이트. 예전엔 화면마다 인라인 안내 카드를 그리거나(개인
 * 로그·앨범·친구 목록) 서버에서 바로 `redirect('/signin')`했는데(저장한
 * 글·메시지), 이제 전부 이 컴포넌트 하나로 통일해 "로그인이 필요한
 * 서비스입니다" 확인 모달을 띄운다. `ConfirmDialog`의 오버레이가 이미
 * `position:fixed; inset:0`라 뒤에 그릴 본문이 따로 필요 없다 — `Gnb`만
 * 그대로 둬서(가입 전이라도 헤더/전역 이동은 유지) 다른 로그인 게이트
 * 화면들과 같은 골격을 갖는다. `ComposerModalProvider`를 여기서 직접
 * 감싸서 Gnb의 폰 하단 탭바가 항상 요구하는 Provider가 새 호출부에서
 * 또 빠지는 일을 구조적으로 막는다.
 */
export function LoginRequiredGate({ categoryTree }: { categoryTree?: GnbCategoryGroup[] }) {
  const router = useRouter();
  return (
    <ComposerModalProvider>
      <Gnb profileHref="/signin" categoryTree={categoryTree} />
      <ConfirmDialog
        open
        message="로그인이 필요한 서비스입니다."
        confirmLabel="로그인"
        onConfirm={() => router.push('/signin')}
        onCancel={() => router.push('/')}
        destructive={false}
      />
    </ComposerModalProvider>
  );
}
