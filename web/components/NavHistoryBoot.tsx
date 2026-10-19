'use client';

import { useState } from 'react';
import { markNavHistoryBoot } from './nav-history-boot.ts';

/** 렌더링 없음 — 루트 레이아웃이라 페이지를 이동할 때마다(전부 하드
 * 리로드) 새로 마운트된다. 매번 markNavHistoryBoot()를 불러 sessionStorage
 * 방문 기록을 갱신한다(nav-history-boot.ts 참고). */
export function NavHistoryBoot() {
  useState(markNavHistoryBoot);
  return null;
}
