'use client';

import { useEffect } from 'react';

/**
 * 🔒 실전 발견(2026-08, 사용자 리포트 — "Community 버튼을 눌러서 게시판
 * 리스트를 불러왔어. UI가 깨져버려. 밝은색으로 되어있는것들이 팝업보다
 * 상단에 노출") — YouTube iframe(`LinkPreviewCard`)이 어떤 모달을 열어도
 * (CommunityPopup z-index:100부터 PostComposerModal z-index:400까지)
 * 그 위로 뚫고 나와 보였다. z-index를 아무리 올려도 안 고쳐졌다 —
 * `iframe.style.visibility = 'hidden'`으로 직접 테스트해서 확인한 바,
 * CSS 스태킹 컨텍스트 계산 문제가 아니라 크로스 오리진 iframe이 별도
 * GPU 합성 레이어로 그려지면서 일반 z-index 비교 자체를 우회하는
 * 브라우저 합성 단계의 문제였다 — CSS만으로는 근본적으로 못 고친다.
 * 모달이 열려 있는 동안 `<body>`에 클래스를 달아 `app/globals.css`의
 * 전역 규칙(`body.modal-open iframe/video { visibility:hidden }`)이
 * 모든 iframe·video를 일괄적으로 숨기게 한다 — 개별 컴포넌트가 서로의
 * 존재를 몰라도 되는 가장 단순한 해법.
 */
/** 모듈 스코프 카운터 — 두 팝업이 동시에 열려도(예: "···" 메뉴가 열린
 * 채로 다른 모달을 여는 흔치 않은 경로) 먼저 닫힌 쪽이 아직 열려 있는
 * 다른 쪽까지 같이 지우지 않도록 방어한다. */
let openCount = 0;

export function useModalOpenEffect(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    document.body.classList.add('modal-open');
    return () => {
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        document.body.classList.remove('modal-open');
      }
    };
  }, [open]);
}
