'use client';

import { useState } from 'react';
import { useSubscriptions } from './subscriptions-context.tsx';
import { useLoginRequiredDialog } from './LoginRequiredDialog.tsx';

type SubscribableCategory = { id: string; name: string; slug: string };

/**
 * 🔒 `SubscribeButton.tsx`(카테고리 페이지 상단 pill 버튼)이 이미 갖고 있던
 * "낙관적 토글 + API 호출 + 실패 시 롤백 + SubscriptionsProvider 동기화"
 * 로직을 뽑아냈다 — CommunityPopup의 팝오버 행(artifact 실측: 텍스트 링크,
 * pill 아님)이 똑같은 로직을 필요로 하게 되면서(사용자 발견, 2026-08 —
 * "구독하기 버튼이 누락되어있어") 시각적으로 다른 두 곳이 로직만 공유한다.
 */
export function useSubscribeToggle(category: SubscribableCategory, initialSubscribed: boolean, isLoggedIn: boolean) {
  const { subscribe, unsubscribe } = useSubscriptions();
  const { openLoginDialog, loginDialog } = useLoginRequiredDialog();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [pending, setPending] = useState(false);
  // 🔒 사용자 지시(2026-08, "커뮤니티 구독은 최대 10개까지만") — 롤백만 하면
  // 사용자 눈엔 "눌렀는데 그냥 취소됐다"로만 보인다. 왜 실패했는지 잠깐
  // 보여준다(이 프로젝트의 "복사됨"/"저장됨" 라벨 전환과 같은 패턴).
  const [limitReached, setLimitReached] = useState(false);

  async function toggle() {
    if (!isLoggedIn) {
      // 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을... 로그인으로
      // 이동") — 즉시 리다이렉트 대신 로그인 확인 모달. 구독은 §11.9.2 의도
      // 보존 대상이 아니다 — beforeRedirect 없이 그냥 /signin으로 보낸다.
      openLoginDialog();
      return;
    }
    setPending(true);
    const next = !subscribed;
    setSubscribed(next); // 낙관적 업데이트(§11.5.2)
    if (next) subscribe(category);
    else unsubscribe(category.id);
    try {
      const res = await fetch('/api/subscriptions', {
        method: next ? 'POST' : 'DELETE',
        body: JSON.stringify({ categoryId: category.id }),
      });
      if (!res.ok) {
        setSubscribed(!next); // 롤백
        if (next) unsubscribe(category.id);
        else subscribe(category);
        if (next) {
          const body = await res.json().catch(() => null);
          if (body?.error === 'LIMIT_REACHED') {
            setLimitReached(true);
            setTimeout(() => setLimitReached(false), 2000);
          }
        }
      }
    } catch {
      setSubscribed(!next);
      if (next) unsubscribe(category.id);
      else subscribe(category);
    } finally {
      setPending(false);
    }
  }

  return { subscribed, pending, limitReached, toggle, loginDialog };
}
