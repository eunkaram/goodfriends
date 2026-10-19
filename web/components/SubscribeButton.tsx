'use client';

import { useState } from 'react';
import type { Category } from '../lib/categories.ts';
import { useSubscriptions } from './subscriptions-context.tsx';
import { useLoginRequiredDialog } from './LoginRequiredDialog.tsx';

/**
 * §11.7.3 1순위 — "이 화면이 구독의 유일한 진입점".
 * 🔒 좌 사이드바 "구독 중" 목록과 새로고침 없이 동기화한다(사용자 발견,
 * 2026-08) — `categoryId`만이 아니라 카테고리 전체(`category`)를 받아
 * `SubscriptionsProvider`(형제 트리 Context)에 그대로 반영한다.
 */
export function SubscribeButton({ category, initialSubscribed, isLoggedIn }: { category: Category; initialSubscribed: boolean; isLoggedIn: boolean }) {
  const { subscribe, unsubscribe } = useSubscriptions();
  const { openLoginDialog, loginDialog } = useLoginRequiredDialog();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [pending, setPending] = useState(false);
  // 🔒 사용자 지시(2026-08, "커뮤니티 구독은 최대 10개까지만") — 롤백만 하면
  // "눌렀는데 취소됐다"로만 보인다. 잠깐 이유를 보여준다(CommunityPopup의
  // CategoryRow와 같은 패턴).
  const [limitReached, setLimitReached] = useState(false);

  async function onClick() {
    if (!isLoggedIn) {
      // 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을... 로그인으로
      // 이동") — 즉시 리다이렉트 대신 로그인 확인 모달. 구독은 §11.9.2 의도
      // 보존 대상이 아니라(반응·저장·댓글·친구신청·팔로우만 해당) beforeRedirect
      // 없이 그냥 /signin으로 보낸다.
      openLoginDialog();
      return;
    }
    setPending(true);
    const next = !subscribed;
    setSubscribed(next); // 낙관적 업데이트(§11.5.2)
    if (next) subscribe(category); else unsubscribe(category.id); // 사이드바도 같이 낙관적으로 갱신
    try {
      const res = await fetch('/api/subscriptions', {
        method: next ? 'POST' : 'DELETE',
        body: JSON.stringify({ categoryId: category.id }),
      });
      if (!res.ok) {
        setSubscribed(!next); // 롤백
        if (next) unsubscribe(category.id); else subscribe(category);
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
      if (next) unsubscribe(category.id); else subscribe(category);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
    {/* 🔒 사용자 지시(2026-08, "절대로 목업디자인으로 따라가") — artifact
        실측(디코딩 원본 line 318): `height:34px; padding:0 16px;
        border-radius:9999px(완전한 pill); font-size:13px; font-weight:600`.
        예전 "tiny하게" 라운드가 8/16px→4/12px 패딩, radius-sm(8px), 12px,
        min-width:72 강제로 임의 축소했던 게 애초에 artifact 수치와 전혀
        안 맞았다 — 원본 그대로 복원(색은 dynamic 바인딩이라 hex를 알 수
        없어 이 앱의 기존 CTA 색 관례를 그대로 유지). min-width도 artifact엔
        없다 — 라벨 길이에 맞춰 자연스럽게 크기가 달라지는 게 원래 의도. */}
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={subscribed}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 34,
        padding: '0 16px',
        font: '600 13px var(--font-sans)',
        color: subscribed ? 'var(--text-primary)' : 'var(--on-accent)',
        background: subscribed ? 'var(--raised)' : 'var(--accent)',
        border: subscribed ? '1px solid var(--border)' : 'none',
        borderRadius: 9999,
        cursor: 'pointer',
      }}
    >
      {limitReached ? '최대 10개까지' : subscribed ? '구독 중' : '구독하기'}
    </button>
    {loginDialog}
    </>
  );
}
