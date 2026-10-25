'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { REACTIONS, ReactionIcon, type EmoticonType } from './ReactionIcons.tsx';
import { EmailVerifyNotice } from './EmailVerifyNotice.tsx';
import { useLoginRequiredDialog } from './LoginRequiredDialog.tsx';
import styles from './ReactionBar.module.css';

function CommentIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export interface ReactionBarProps {
  postId: string;
  initialCount: number;
  isLoggedIn: boolean;
  /** 이미 반응을 남긴 상태로 다시 방문했을 때(§11.7.4 포스트 상세) — 홈 카드에선 늘 null로 시작한다 */
  initialSelected?: EmoticonType | null;
  /** §11.10.2 — 카드 20px(기본) / 상세 24px */
  iconSize?: number;
  /**
   * 🔒 사용자 발견(2026-08, /design-review) — "아래부분 아이콘을 하트모양
   * (like)과 댓글수로 줄였으면 좋겠어". 포스트 상세 전용 — 6개 반응 중
   * '공감'(하트 모양 path)만 노출한다. 다른 5종은 상세에서 선택 UI 자체가
   * 없어질 뿐 데이터는 그대로다 — 이미 다른 반응으로 남겨둔 상태에서 하트를
   * 누르면 '공감'으로 교체된다(기존 토글/교체 로직 그대로, 필터링만 다르다).
   * 카운트는 반응 총합(reactionCount)을 그대로 보여준다 — '공감' 개수만
   * 따로 세려면 새 집계 쿼리가 필요해 이번 요청 범위를 넘어간다.
   */
  compact?: boolean;
  /** compact 모드에서만 쓰인다 — 말풍선 아이콘 옆에 댓글 수를 표시하고 `#comments`로 스크롤한다. */
  commentCount?: number;
  /**
   * 🔒 사용자 지시(2026-08) — "글 리스트의 하트 아이콘부분도 글내용보기
   * 페이지처럼 하트와 댓글만 보이게". 포스트 상세에서 쓰던 기본값
   * `#comments`는 "같은 페이지 안에서 스크롤"을 전제한다 — 피드 카드처럼
   * 다른 페이지(글 목록)에 떠 있을 땐 그 앵커가 지금 보고 있는 목록
   * 페이지에 그대로 붙어버려 아무 데도 안 간다. PostCard가 자기 글 상세
   * 경로(`/{category}/{id}#comments`)를 넘겨 오버라이드한다.
   */
  commentHref?: string;
}

/**
 * §11.10.3 인터랙션 + §11.5.2 "낙관적 토글 + 카운트 즉시 증감".
 * 비로그인 클릭은 §11.9.2 소프트 게이트 — 의도를 저장하고 로그인으로 보낸다
 * (그 뒤 이어지는 자동 실행은 components/resume-intent.ts가 로그인 페이지에서 맡는다).
 */
export function ReactionBar({
  postId,
  initialCount,
  isLoggedIn,
  initialSelected = null,
  iconSize = 20,
  compact = false,
  commentCount,
  commentHref = '#comments',
}: ReactionBarProps) {
  const router = useRouter();
  const { openLoginDialog, loginDialog } = useLoginRequiredDialog();
  const [selected, setSelected] = useState<EmoticonType | null>(initialSelected);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);

  async function handleClick(type: EmoticonType) {
    if (pending) return;
    setBlockedNotice(false);
    setEmailNotVerified(false);

    if (!isLoggedIn) {
      // 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을 띄우고 로그인이
      // 필요한 서비스입니다... 로그인으로 이동") — 즉시 리다이렉트 대신 확인
      // 모달을 먼저 띄운다. 의도 저장(§11.9.2)은 모달에서 "로그인"을 눌렀을
      // 때만 실행되도록 beforeRedirect로 넘긴다.
      openLoginDialog(async () => {
        await fetch('/api/intent', {
          method: 'POST',
          body: JSON.stringify({ action: 'reaction', targetId: postId, returnTo: window.location.pathname, emoticonType: type }),
        });
      });
      return;
    }

    // 낙관적 업데이트(§11.5.2) — 실패하면 아래서 원상 복구한다
    const prevSelected = selected;
    const prevCount = count;
    const willRemove = selected === type;
    setSelected(willRemove ? null : type);
    setCount((c) => (willRemove ? c - 1 : prevSelected ? c : c + 1));
    setPending(true);

    try {
      const res = await fetch('/api/intent/execute', {
        method: 'POST',
        body: JSON.stringify({
          intent: { action: 'reaction', targetId: postId, returnTo: window.location.pathname, emoticonType: type },
          confirmed: true,
        }),
      });
      const result = await res.json();
      if (result.status === 'executed') {
        // 🔒 /review 발견(red-team) — 서버가 최종 토글 상태(result.reaction)를
        // 돌려주는데도 클라이언트가 자기 낙관적 추측을 그대로 믿고 있었다.
        // 같은 글을 여러 탭에서 열어두는 등 진짜 경합이 있으면 서버가 계산한
        // DELETE-vs-UPSERT 결과와 화면이 갈라질 수 있다 — 서버 응답으로 맞춘다.
        setSelected(result.reaction ?? null);
      } else {
        setSelected(prevSelected);
        setCount(prevCount);
        if (result.status === 'email_not_verified') {
          setEmailNotVerified(true);
        } else {
          setBlockedNotice(true); // §10.2 — 왜 안 되는지는 밝히지 않는다
        }
      }
    } catch {
      setSelected(prevSelected);
      setCount(prevCount);
      setBlockedNotice(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {compact ? (
        // 🔒 사용자 발견(2026-08, /design-review) — "아이콘 사이즈가 안맞아...
        // 아이콘 + 숫자가 그룹이야. UI 적절히 잘 배치해". 아이콘·숫자를 각각
        // 따로 flex 자식으로 늘어놓으면 4개 항목이 등간격으로 흩어져 보여
        // "그룹"으로 안 읽힌다 — 아이콘+숫자를 하나의 pill 버튼으로 묶어
        // 호버·클릭 영역도 함께 반응하게 하고, 두 그룹 사이(공감 vs 댓글)만
        // 더 넓게 띄운다(styles.compactBar).
        <div className={`${styles.bar} ${styles.compactBar}`}>
          <button
            type="button"
            className={selected === 'empathy' ? `${styles.compactGroup} ${styles.selected}` : styles.compactGroup}
            aria-label="공감"
            aria-pressed={selected === 'empathy'}
            onClick={() => handleClick('empathy')}
            disabled={pending}
          >
            <ReactionIcon type="empathy" size={iconSize} />
            <span className={styles.compactCount}>{count}</span>
          </button>
          {commentCount !== undefined && (
            // 🔒 사용자 지시(2026-08-24, "관련된 페이지 모두 모달을... 로그인으로
            // 이동") — 비로그인이면 댓글 섹션 앵커 대신 로그인 확인 모달을 띄운다.
            <a
              href={isLoggedIn ? commentHref : undefined}
              className={styles.compactGroup}
              aria-label="댓글"
              onClick={(e) => {
                if (!isLoggedIn) {
                  e.preventDefault();
                  openLoginDialog();
                }
              }}
            >
              <CommentIcon size={iconSize} />
              <span className={styles.compactCount}>{commentCount}</span>
            </a>
          )}
        </div>
      ) : (
        <div className={styles.bar}>
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={selected === r.id ? `${styles.iconBtn} ${styles.selected}` : styles.iconBtn}
              aria-label={r.label}
              aria-pressed={selected === r.id}
              onClick={() => handleClick(r.id)}
              disabled={pending}
            >
              <ReactionIcon type={r.id} size={iconSize} />
            </button>
          ))}
          <span className={styles.count}>{count}</span>
        </div>
      )}
      {emailNotVerified ? (
        <EmailVerifyNotice />
      ) : (
        blockedNotice && (
          <p role="status" style={{ font: 'var(--text-label-sm)', color: 'var(--text-tertiary)', margin: 'var(--space-xs) 0 0' }}>
            지금은 반응할 수 없어요.
          </p>
        )
      )}
      {loginDialog}
    </div>
  );
}
