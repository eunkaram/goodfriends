'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PostComposerModal, type EditingPost } from './PostComposerModal.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { Category } from '../lib/categories.ts';
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

function SaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4.2L6 20V5a1 1 0 0 1 1-1z" />
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

function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
 * 🔒 사용자 지시(2026-08) — "글 수정 페이지 목업파일을 확인하고 수정해야해,
 * 글 하단 오른쪽 글삭제~링크복사부분을 3점 메뉴로 변경해줘". artifact
 * `showDetail`의 헤더 "···" 메뉴 실측(Copy link/Report/글 수정/글 삭제,
 * 이 순서 그대로)을 참고하되, 트리거 위치는 artifact처럼 헤더로 옮기지 않고
 * 사용자가 명시한 "글 하단"(기존 ShareButton/ReportButton/EditPostButton/
 * DeletePostButton이 있던 자리, `.actionsRight`) 그대로 유지했다 — 문구를
 * 문자 그대로 따른 판단.
 *
 * PostCardMenu(피드 카드 "···" 메뉴)와 완전히 같은 시각 언어를 그대로
 * 재사용한다(`PostCard.module.css`의 `.menuWrap`/`.menuTrigger`/
 * `.menuOverlay`/`.menuPopover`/`.menuItem`/`.menuItemDanger` — hover는
 * 색만 바뀌고 배경은 안 바뀐다, 위험 항목은 hover에도 accent로 안 바뀌고
 * danger 고정). artifact 원본은 "글 삭제"도 hover 시 accent(#af2746)로
 * 바뀌지만, 방금 PostCardMenu에서 확정한 "파괴적 항목은 hover에도 danger
 * 유지" 원칙과 충돌해 이 앱 내부 일관성을 우선했다 — artifact를 그대로
 * 안 베낀 지점.
 *
 * "신고하기"도 PostCardMenu와 같이 `.menuItemDanger`로 뒀다(기존
 * `ReportButton.tsx`는 danger 색이 아니었지만, 두 "···" 메뉴 사이의
 * 일관성을 우선했다).
 *
 * 🔒 후속(2026-08, "모든 버튼에서 두번 누르기 기능을 팝업으로 대체하고
 * 싶어" → "공용컴포넌트로 뽑아내줘") — "글 삭제"의 기존 "같은 버튼 2클릭"
 * relabel 패턴을 공용 `ConfirmDialog`(PostCardMenu.tsx가 원형) 팝업으로
 * 옮겼다. 이제 메뉴에서 "글 삭제"를 누르면 메뉴가 닫히고 확인 팝업이 뜬다.
 */
export function PostDetailMenu({
  postId,
  isLoggedIn,
  isOwner,
  editPost,
  categories,
  authorUsername,
  authorNickname,
  authorAvatarUrl,
}: {
  postId: string;
  isLoggedIn: boolean;
  isOwner: boolean;
  /** 본인 글 + category_id가 있을 때만 전달 — 없으면 "글 수정" 항목 자체를 안 그린다. */
  editPost: EditingPost | null;
  categories: Category[];
  authorUsername: string;
  authorNickname: string;
  /** 🔒 사용자 발견(2026-08, "글쓰기, 글 수정 팝업에 내 아바타가 표시가
   * 안돼") — "글 수정" 모달 아바타 실제 사진용, 없으면 이니셜로 폴백. */
  authorAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);

  function onClose() {
    setOpen(false);
    setCopied(false);
  }

  /** PostCardMenu.tsx의 onSave와 같은 원칙(§11.7.7) — goodfriends 시안 글
   * 상세 3점 메뉴 첫 항목(디코딩 원본 line 163-165)인데 이전엔 빠져 있었다. */
  async function onSave() {
    if (saved || savePending) return;
    setSavePending(true);
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
      setSavePending(false);
    }
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
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
    if (reportPending) return;
    setReportPending(true);
    try {
      await fetch('/api/reports', { method: 'POST', body: JSON.stringify({ targetType: 'post', targetId: postId }) });
      setShowReportConfirm(false);
      setReported(true);
    } finally {
      setReportPending(false);
    }
  }

  function onEditClick() {
    setEditOpen(true);
    onClose();
  }

  function onDeleteClick() {
    setOpen(false);
    setShowDeleteConfirm(true);
  }

  async function onConfirmDelete() {
    if (deletePending) return;
    setDeletePending(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/');
        return;
      }
    } finally {
      setDeletePending(false);
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
            {/* 🔒 사용자 지시(2026-08-24, "비로그인시 글 삼점 메뉴에서 신고/저장하기는
                안보이게") — PostCardMenu.tsx와 같은 조건. */}
            {isLoggedIn && (
              <button type="button" className={styles.menuItem} onClick={onSave} disabled={savePending}>
                <SaveIcon />
                {saved ? '저장됨' : '저장하기'}
              </button>
            )}
            <button type="button" className={styles.menuItem} onClick={onCopyLink}>
              <LinkIcon />
              {copied ? '복사됨' : '링크 복사'}
            </button>
            {isLoggedIn && (
              <button type="button" className={styles.menuItemDanger} onClick={onReportClick} disabled={reported}>
                <FlagIcon />
                {reported ? '신고 접수됨' : '신고하기'}
              </button>
            )}
            {editPost && (
              <button type="button" className={styles.menuItem} onClick={onEditClick}>
                <EditIcon />
                글 수정
              </button>
            )}
            {isOwner && (
              <button type="button" className={styles.menuItemDanger} onClick={onDeleteClick}>
                <TrashIcon />
                글 삭제
              </button>
            )}
          </div>
        </>
      )}
      {editOpen && editPost && (
        <PostComposerModal
          categories={categories}
          editingPost={editPost}
          authorUsername={authorUsername}
          authorNickname={authorNickname}
          authorAvatarUrl={authorAvatarUrl}
          onUpdated={() => {
            setEditOpen(false);
            router.refresh();
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        message="이 글을 삭제할까요? 삭제하면 되돌릴 수 없어요."
        confirmLabel="삭제"
        pendingLabel="삭제 중…"
        pending={deletePending}
        onConfirm={onConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <ConfirmDialog
        open={showReportConfirm}
        message="이 글을 신고할까요?"
        confirmLabel="신고"
        pendingLabel="신고 중…"
        pending={reportPending}
        onConfirm={onConfirmReport}
        onCancel={() => setShowReportConfirm(false)}
      />
    </div>
  );
}
