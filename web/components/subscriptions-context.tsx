'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Category } from '../lib/categories.ts';

/**
 * §11.7.3 "이 화면이 구독의 유일한 진입점" — `SubscribeButton`(카테고리 페이지
 * 상단)과 좌 사이드바의 "구독 중" 목록(`SubscribedCategoriesWidget`)은 서버
 * 트리 상 형제라, 새로고침 없이 서로를 갱신하려면 Context로 목록 자체를
 * 공유해야 한다(사용자 발견, 2026-08 — "구독/취소 하게 되면 왼쪽 메뉴에
 * interaction이 발생하지 않아"). `ComposerModalProvider`와 같은 패턴.
 * 🔒 `subscribe()`가 받는 타입을 전체 `Category`가 아니라 실제로 쓰는
 * 필드만(`Pick`)으로 좁혔다 — `CommunityPopup`(사용자 발견, 2026-08 —
 * "구독하기 버튼이 누락되어있어")이 `GnbCategory`(`{id,name,slug}`, 카테고리
 * 트리를 사이드바용으로 축약한 타입)로도 호출해야 하는데, `nameKey`/`type`
 * 같은 나머지 필드는 어차피 `SubscribedCategoriesWidget`이 렌더링에 안 쓴다.
 */
type SubscribableCategory = Pick<Category, 'id' | 'name' | 'slug'>;

type SubscriptionsCtx = {
  subscribed: SubscribableCategory[];
  subscribe: (category: SubscribableCategory) => void;
  unsubscribe: (categoryId: string) => void;
};

const SubscriptionsContext = createContext<SubscriptionsCtx | null>(null);

export function SubscriptionsProvider({ initialSubscribed, children }: { initialSubscribed: SubscribableCategory[]; children: ReactNode }) {
  const [subscribed, setSubscribed] = useState<SubscribableCategory[]>(initialSubscribed);

  function subscribe(category: SubscribableCategory) {
    setSubscribed((prev) => (prev.some((c) => c.id === category.id) ? prev : [...prev, category]));
  }
  function unsubscribe(categoryId: string) {
    setSubscribed((prev) => prev.filter((c) => c.id !== categoryId));
  }

  return <SubscriptionsContext.Provider value={{ subscribed, subscribe, unsubscribe }}>{children}</SubscriptionsContext.Provider>;
}

export function useSubscriptions(): SubscriptionsCtx {
  const ctx = useContext(SubscriptionsContext);
  if (!ctx) throw new Error('useSubscriptions는 SubscriptionsProvider 안에서만 쓸 수 있다');
  return ctx;
}
