'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import styles from './PostCard.module.css';

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17H7a5 5 0 0 1 0-10h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 20V4.5" />
      <path d="M5.5 5h12l-2.8 3.6 2.8 3.6h-12" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4.2L6 20V5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/**
 * 🔒 Claude Design 확정안(2026-08) — 피드 카드 "···" 메뉴(artifact 실측:
 * Copy link / Report / 글 수정 / 글 삭제). 이전 라운드는 "링크 복사"·"신고하기"·
 * "저장"만 구현했다 — FeedPost엔 authorId가 없어(본인 글 판별 불가) 삭제까지
 * 인라인으로 넣으려면 feed 쿼리 확장이 필요했기 때문. 이번 라운드(사용자
 * 발견, 2026-08 — "리스트에서 내글인데 3점 메뉴를 클릭하면 삭제하기 메뉴가
 * 없어")에서 그 확장을 마쳤다 — `src/feed.ts`가 이제 author_id를 같이
 * 내려준다(`PostCard.tsx`가 isOwner를 계산). "글 수정"은 이번 범위 밖으로
 * 남겼다(포스트 상세의 `PostDetailMenu.tsx`에 이미 있고, 목록 카드까지
 * 인라인 수정 폼을 넣는 건 이 요청의 스코프를 넘는다).
 *
 * 🔒 사용자 지시(2026-08, "confirm창이 떠서 확인을 받아야 할것 같아. 글쓰기
 * 취소와 같은 스타일로 만들어줘") — `PostDetailMenu.tsx`의 기존 삭제는
 * "같은 버튼을 두 번 눌러 라벨이 바뀌는" 2클릭 패턴이지만, 이번엔 명시적으로
 * `PostComposerModal`의 "글쓰기 취소" 확인창(오버레이+카드, 파괴적 버튼은
 * 외곽선만·안전한 버튼만 채움)과 같은 스타일을 요구받아 그 시각 언어를
 * 그대로 재현했다.
 *
 * 🔒 후속(2026-08, "모든 버튼에서 두번 누르기 기능을 팝업으로 대체하고
 * 싶어" → "공용컴포넌트로 뽑아내줘") — 여기서 처음 만든 이 오버레이+카드가
 * `ConfirmDialog.tsx`(공용 컴포넌트)의 원형이다. `PostDetailMenu.tsx`·
 * `CommentSection.tsx`·`RelationshipButton.tsx`의 2클릭 relabel 패턴도
 * 전부 이 컴포넌트로 옮겨 이제 앱 전체가 한 시각 언어를 쓴다.
 *
 * 🔒 사용자 발견(2026-08, "리스트에서 3점 메뉴를 누르면 리스트에 있는
 * 동영상이 사라져버려") — `useModalOpenEffect`(iframe·video 전역 숨김)를
 * 한때 여기 걸었었다. 이 메뉴는 CommunityPopup류(전체 화면 오버레이+
 * 본문 다지는 모달)와 달리 버튼 옆에 뜨는 작은 팝오버(`.menuOverlay`는
 * 투명 — 클릭 캐처일 뿐 화면을 안 어둡게 한다)라, `body.modal-open`
 * 전역 규칙이 그 카드뿐 아니라 리스트의 다른 글 동영상까지 전부 숨겨
 * 실제로 없던 문제를 만들었다 — 의도적으로 뺐다. 다시 걸지 말 것. 아래
 * 삭제 확인 오버레이도 같은 이유로 안 건다 — 후속16 이후 목록(compact)
 * 카드는 실제 iframe/video가 아니라 정적 썸네일만 렌더링해서 가릴 대상이
 * 애초에 없다.
 */
export function PostCardMenu({
  postUrl,
  postId,
  isLoggedIn,
  savedMode,
  onUnsaved,
  isOwner,
  onDeleted,
}: {
  postUrl: string;
  postId: string;
  isLoggedIn: boolean;
  /** §11.7.7 "저장한 글" 목록 전용 — true면 "저장"(추가) 대신 "저장 취소"(제거)를 보여준다. */
  savedMode?: boolean;
  onUnsaved?: () => void;
  /** 본인 글일 때만 "삭제하기" 메뉴를 노출한다. */
  isOwner?: boolean;
  /** 삭제 성공 시 호출 — 없으면 router.refresh()로 대체(서버 컴포넌트 목록 등 낙관적 제거가 없는 화면용). */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);

  function onClose() {
    setOpen(false);
    setCopied(false);
  }

  function onDeleteClick() {
    setOpen(false);
    setShowDeleteConfirm(true);
  }

  async function onConfirmDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setShowDeleteConfirm(false);
      if (onDeleted) onDeleted();
      else router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(new URL(postUrl, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onClose();
    }
  }

  function onReportClick() {
    if (reported) return;
    setOpen(false);
    setShowReportConfirm(true);
  }

  async function onConfirmReport() {
    if (reporting) return;
    setReporting(true);
    try {
      await fetch('/api/reports', { method: 'POST', body: JSON.stringify({ targetType: 'post', targetId: postId }) });
      setShowReportConfirm(false);
      setReported(true);
    } finally {
      setReporting(false);
    }
  }

  /* 🔒 §11.7.7 신규 — "저장" 자체는 새 엔드포인트가 아니라 이미 있는 P4 경로
     (`POST /api/intent/execute`, action:'save')를 그대로 쓴다 — save는 confirmed
     여부와 무관하게 즉시 실행되는 액션이라(executeIntent.ts) 별도 확인 단계가
     필요 없다. */
  async function onSave() {
    if (saved || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/intent/execute', {
        method: 'POST',
        body: JSON.stringify({ intent: { action: 'save', targetId: postId }, confirmed: true }),
      });
      const result = await res.json();
      if (result.status === 'executed') {
        setSaved(true);
        setTimeout(onClose, 1200);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onUnsave() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/saved-posts', { method: 'DELETE', body: JSON.stringify({ postId }) });
      onUnsaved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.menuWrap}>
      <button type="button" className={styles.menuTrigger} onClick={() => setOpen((v) => !v)} aria-label="더보기">
        <DotsIcon />
      </button>
      {open && (
        <>
          <div className={styles.menuOverlay} onClick={onClose} />
          <div className={styles.menuPopover}>
            <button type="button" className={styles.menuItem} onClick={onCopyLink}>
              <LinkIcon />
              {copied ? '복사됨' : '링크 복사'}
            </button>
            {/* 🔒 사용자 지시(2026-08-24, "비로그인시 글 삼점 메뉴에서 신고/저장하기는
                안보이게") — 클릭 시 /signup으로 보내던 소프트 게이트에서, 메뉴
                항목 자체를 렌더링하지 않는 쪽으로 변경. */}
            {isLoggedIn &&
              (savedMode ? (
                <button type="button" className={styles.menuItemDanger} onClick={onUnsave} disabled={busy}>
                  <SaveIcon />
                  저장 취소
                </button>
              ) : (
                <button type="button" className={styles.menuItem} onClick={onSave} disabled={busy}>
                  <SaveIcon />
                  {saved ? '저장됨' : '저장'}
                </button>
              ))}
            {isLoggedIn && (
              <button type="button" className={styles.menuItemDanger} onClick={onReportClick} disabled={reported}>
                <FlagIcon />
                {reported ? '신고 접수됨' : '신고하기'}
              </button>
            )}
            {isOwner && (
              <button type="button" className={styles.menuItemDanger} onClick={onDeleteClick}>
                <TrashIcon />
                삭제하기
              </button>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        message="이 글을 삭제할까요? 삭제하면 되돌릴 수 없어요."
        confirmLabel="삭제"
        pendingLabel="삭제 중…"
        pending={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <ConfirmDialog
        open={showReportConfirm}
        message="이 글을 신고할까요?"
        confirmLabel="신고"
        pendingLabel="신고 중…"
        pending={reporting}
        onConfirm={onConfirmReport}
        onCancel={() => setShowReportConfirm(false)}
      />
    </div>
  );
}
