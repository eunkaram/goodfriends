'use client';

import type { ReactNode } from 'react';
import { HAD_PRIOR_PAGE_KEY } from './nav-history-boot.ts';

/**
 * 🔒 사용자 발견(2026-08, "프로파일 -> 글 내용 -> 목록으로 가기하면 home으로
 * 이동 되어버리네. post 메뉴에서도 마찬가지고. 어떤 위치든지 글 읽기에서
 * 목록으로 가기 하면 원래위치로 가야 할것 같아") — 포스트 상세의 "← 목록으로"
 * 버튼이 지금까지 글의 카테고리(또는 홈)로 가는 고정 href였다. New Post가
 * 이제 모든 페이지(Profile/Posts/Saved/Messages 등)에서 열리면서 그 글로
 * 들어오는 진입점도 다양해졌는데, 이 버튼은 진입 경로를 전혀 안 보고 항상
 * 같은 곳으로 보냈다 — 이 앱은 전부 일반 `<a href>`라(next/link 없음)
 * 페이지 이동마다 실제 하드 리로드가 일어나므로, 브라우저 히스토리를 그대로
 * 따라가는 게 "원래 위치"의 정확한 정의다. `nav-history-boot`(루트
 * 레이아웃에서 매 페이지 로드마다 실행)가 sessionStorage에 적어둔 "이
 * 페이지 이전에 우리 앱을 이미 거쳤는지"가 '1'일 때만 `history.back()`을
 * 쓴다 — 새 탭에 이 글 URL을 직접 열었을 때('0')는 진짜 돌아갈 자리가
 * 없으니 그대로 fallbackHref로 이동한다(preventDefault 없이 그냥
 * `<a href>` 클릭이 되게 둔다). sessionStorage 값 자체를 클릭 시점에
 * 직접 읽는다 — JS 모듈 변수 공유는 청크 경계 때문에 신뢰 못 한다(실측,
 * nav-history-boot.ts 주석 참고).
 */
export function BackToListLink({ fallbackHref, className, children }: { fallbackHref: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={fallbackHref}
      className={className}
      onClick={(e) => {
        if (sessionStorage.getItem(HAD_PRIOR_PAGE_KEY) === '1') {
          e.preventDefault();
          window.history.back();
        }
      }}
    >
      {children}
    </a>
  );
}
