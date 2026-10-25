'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode, MouseEvent } from 'react';

/**
 * 🔒 사용자 지시(2026-08, "리스트에서 내용을 클릭해도 글 보기 페이지로
 * 이동하게 만들어줘") — 지금까지 목록 카드는 제목(`.title`)만 상세 페이지
 * 링크였다. 본문 미리보기(텍스트·이미지·유튜브/영상 썸네일)를 감싸 클릭
 * 시 상세로 이동하게 한다.
 *
 * 내부에 이미 자기 목적지가 있는 인터랙티브 요소(외부 링크 미리보기 카드
 * `<a target="_blank">` 등)를 그대로 `<a>`로 한 번 더 감싸면 앵커 중첩이
 * 되어 브라우저가 파싱 단계에서 바깥 앵커를 깨버린다 — `<a>`가 아니라
 * 클릭 이벤트를 가로채는 `<div>`로 만들고, 클릭 지점이 실제 인터랙티브
 * 요소(a/button 등) 안이면 그 요소의 기본 동작에 양보하고 상세 이동을
 * 건너뛴다.
 */
export function ClickableCardArea({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select')) return;
    router.push(href);
  }

  return (
    <div className={className} onClick={onClick} style={{ cursor: 'pointer' }}>
      {children}
    </div>
  );
}
