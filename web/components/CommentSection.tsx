'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { relativeTime } from './relative-time.ts';
import { ReactionIcon } from './ReactionIcons.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { AuthorLink } from './AuthorLink.tsx';
import { EmailVerifyNotice } from './EmailVerifyNotice.tsx';
import { useLoginRequiredDialog } from './LoginRequiredDialog.tsx';
import { useIsEmailVerified } from './use-is-email-verified.ts';
import { hasImageMarkers, parseBodyWithImageMarkers, makeImageMarker } from '../lib/link-detect.ts';
import styles from './CommentSection.module.css';

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGES_PER_COMMENT = 4;

type PendingImage = { id: string; previewUrl: string; status: 'uploading' | 'done' | 'error'; url?: string };

/**
 * 댓글 본문의 텍스트/이미지 마커를 순서대로 렌더링한다. BodyContent.tsx와
 * 달리 링크 미리보기(OG 카드·유튜브)는 일부러 안 붙인다 — 이번 요청은
 * "이미지 업로드"만이라 댓글에 링크 미리보기까지 넣는 건 범위 밖이고,
 * 볼 때마다 /api/link-preview를 부르는 트래픽도 늘어난다.
 */
function CommentBody({ body, className }: { body: string; className: string }) {
  if (!hasImageMarkers(body)) return body ? <p className={className}>{body}</p> : null;
  return (
    <>
      {parseBodyWithImageMarkers(body).map((seg, i) =>
        seg.type === 'text' ? (
          <p key={i} className={className}>
            {seg.value}
          </p>
        ) : (
          <img key={i} src={seg.url} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.commentImage} />
        ),
      )}
    </>
  );
}

export type CommentItem = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  body: string;
  createdAt: string;
  reactionCount: number;
  myReaction: boolean;
  /** 사용자 지시(2026-08, 1-depth 답글) — null이면 최상위 댓글, 값이 있으면 그 댓글의 답글. */
  parentCommentId: string | null;
};

export interface CommentSectionProps {
  postId: string;
  initialComments: CommentItem[];
  isLoggedIn: boolean;
  /** 🔒 사용자 지시(2026-08, /design-review) — thread류 답글 입력창의 "Reply to {글쓴이}..." placeholder에 쓴다. */
  postAuthorUsername: string;
  /** 내 댓글인지 판별(삭제 메뉴 노출) — 비로그인이면 null. */
  currentUserId: string | null;
  /** 🔒 사용자 발견(2026-08, "댓글입력창에 내 아바타가 안보여") — 댓글/답글
   * 컴포저 앞의 내 아바타. 없으면(비로그인·업로드 안 함) 빈 원 그대로. */
  currentUserAvatarUrl?: string | null;
  /** 🔒 사용자 발견(2026-08, "댓글을 쓰고나면 유저이름이 안나오고 '나'라고
   * 표시돼") — 낙관적 삽입(§11.5.2) 자리에 실제 닉네임 대신 하드코딩된
   * "나"가 들어가던 버그. 댓글 작성 직후 카드가 새로고침 전부터 정확한
   * 이름으로 보이려면 필요하다. */
  currentUsername?: string;
  currentNickname?: string;
  /** M2 — Q&A 채택. 카테고리가 'qna'이고 보는 사람이 글 작성자일 때만 채택 UI가 켜진다. */
  postPublicId: string;
  isQna: boolean;
  isPostOwner: boolean;
  adoptedCommentId: string | null;
}

/* 🔒 사용자 지시(2026-08, /design-review) — "오른쪽 이미지 아이콘은 좀더 크게하고" — 18px→22px */
function ImageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5.5-5.5a2 2 0 0 0-2.83 0L4 19" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

/**
 * 댓글의 "댓글(답글)" 아이콘. 🔒 사용자 지시(2026-08) — "댓글 아이콘을
 * 클릭하면 댓글쓰기 입력폼이 아래에 나타나고 댓글의 댓글을 쓸수 있게
 * 해줘". 최상위 댓글에서만 실제로 클릭 가능 — 답글에는 이 아이콘 자체를
 * 렌더링하지 않는다("댓글의 댓글은 댓글을 달수 없도록 아이콘을 안보이게").
 */
/* 🔒 사용자 지시(2026-08, "댓글의 아이콘을 글 본문의 아이콘과 크기를
   맞춰줘") — 글 본문(포스트 상세)의 compact ReactionBar가 쓰는
   iconSize={18}(app/[category]/[postId]/page.tsx)에 맞췄다. */
function ReplyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17H7a5 5 0 0 1 0-10h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 20V4.5" />
      <path d="M5.5 5h12l-2.8 3.6 2.8 3.6h-12" />
    </svg>
  );
}

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

/**
 * §11.7.4 6~7번 — 댓글 입력(접지 않는다) + 목록. 비로그인 제출은 §11.9.2
 * 소프트 게이트 — 의도(draft 포함)를 저장하고 로그인으로 보낸다. 로그인 후
 * components/resume-intent.ts가 draft를 ?draft= 로 이 화면에 되돌려주면
 * 아래에서 복원 + 포커스한다("자동 제출 금지" — 사용자가 직접 눌러야 한다).
 *
 * 🔒 사용자 지시(2026-08, /design-review) — "댓글 쓰는 부분의 디자인도
 * thread처럼 바꾸고 싶어. 이미지 첨부 가능하고, 글자를 한글자라도
 * 입력하면 이미지 버튼은 숨겨지고 저장버튼이 활성화 되는거야". 아바타+
 * pill 입력창으로 재구성.
 *
 * 🔒 사용자 지시(2026-08, /design-review 후속) — "이미지 업로드 가능하게
 * (멀티 이미지파일 선택가능해야함)하고... 업로드 왼쪽에 아이콘은
 * 안보여줘도 돼". 실제 업로드까지 구축(§17.3 오브젝트 스토리지 인프라를
 * 이번에 처음 만들었다 — src/object-storage.ts·src/media.ts 참고)하면서
 * 레이아웃도 다시 짰다 — 이미지 버튼이 입력 여부와 무관하게 항상 눌려야
 * 하니(텍스트를 입력 중이어도 사진을 더 붙일 수 있어야 한다), 예전처럼
 * "비어있으면 이미지만, 입력하면 펼치기+전송"으로 토글하지 않는다. 대신
 * [이미지 버튼][전송 버튼]을 항상 나란히 두고, 장식용이던 "펼치기" 아이콘은
 * 완전히 없앴다(사용자가 "필요없는거야"로 확인). 여러 장을 고르면 pill
 * 위에 썸네일 줄이 뜨고, 제출 시 본문 뒤에 이미지 마커(lib/link-detect.ts
 * makeImageMarker — posts의 붙여넣기 이미지와 같은 방식)로 이어붙인다.
 *
 * 🔒 사용자 지시(2026-08, /design-review) — "댓글 리스트도 첨부한 것처럼
 * 디자인 레이아웃을 변경해줘. 아래에 like 및 댓글, 그리고 점 세개부분에는
 * 메뉴형태로 수정하기, 삭제하기등이 있으면 좋을것 같아" → 이어서 "하트와
 * 댓글만 사용해"(리포스트·공유 아이콘 제외). 범위를 정하기 전에 먼저
 * 확인한 것 — 이 앱엔 댓글에 대한 답글(스레딩)·리포스트 개념 자체가
 * 없어서, 댓글 아이콘은 장식용(disabled)으로 남기고 하트만 실제로
 * 토글되게 했다(reactions.target_type='comment'가 스키마엔 이미 있었다,
 * comments.ts 참고). "..."메뉴는 삭제만 실제 동작 — "수정하기"는 이번
 * 요청에서 명시적으로 다시 확인하지 않아 범위 밖으로 남겼다(향후 필요하면
 * updatePost와 같은 패턴으로 추가 가능).
 */
export function CommentSection({
  postId,
  initialComments,
  isLoggedIn,
  postAuthorUsername,
  currentUserId,
  currentUserAvatarUrl,
  currentUsername,
  currentNickname,
  postPublicId,
  isQna,
  isPostOwner,
  adoptedCommentId,
}: CommentSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openLoginDialog, loginDialog } = useLoginRequiredDialog();
  const emailVerified = useIsEmailVerified();
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [reactionEmailNotVerified, setReactionEmailNotVerified] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [reportedId, setReportedId] = useState<string | null>(null);
  // 🔒 사용자 지시(2026-08, 1-depth 답글) — 한 번에 하나의 답글 입력폼만 연다
  // (다른 댓글의 답글 아이콘을 누르면 전환).
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  // 🔒 후속(2026-08, 스크린샷 제시 — "reply 댓글도 이미지첨부가 되어야해") —
  // 메인 컴포저와 같은 PendingImage 상태를 답글용으로도 하나 더 둔다(한
  // 번에 하나의 답글 폼만 열리므로 댓글별로 안 나누고 컴포넌트 전체에서
  // 공유). onToggleReply가 다른 댓글로 전환/닫힐 때 여기도 같이 비운다.
  const [replyImages, setReplyImages] = useState<PendingImage[]>([]);
  // 🔒 M2 — Q&A 채택. 카테고리 'qna' + 글 작성자만 채택/해제를 건드린다.
  const [adoptedId, setAdoptedId] = useState<string | null>(adoptedCommentId);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  // 🔒 사용자 발견(2026-08, "3점 메뉴를 누르면 리스트에 있는 동영상이
  // 사라져버려") — 댓글 "···" 메뉴도 PostCardMenu와 같은 작은 팝오버라
  // (전체 화면을 안 어둡게 함) `useModalOpenEffect`(iframe·video 전역
  // 숨김)를 걸면 본문 위 동영상까지 불필요하게 사라진다 — 의도적으로 뺐다.

  useEffect(() => {
    const draft = searchParams.get('draft');
    if (draft) {
      setBody(draft);
      inputRef.current?.focus();
      const url = new URL(window.location.href);
      url.searchParams.delete('draft');
      window.history.replaceState({}, '', url.pathname + url.search); // §4.4와 같은 원칙 — 로드 직후 파라미터 제거
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadingCount = images.filter((img) => img.status === 'uploading').length;
  const doneImages = images.filter((img) => img.status === 'done' && img.url);
  const canSubmit = (body.trim().length > 0 || doneImages.length > 0) && !submitting && uploadingCount === 0 && emailVerified;

  const replyUploadingCount = replyImages.filter((img) => img.status === 'uploading').length;
  const replyDoneImages = replyImages.filter((img) => img.status === 'done' && img.url);
  const canSubmitReply = (replyBody.trim().length > 0 || replyDoneImages.length > 0) && !replySubmitting && replyUploadingCount === 0 && emailVerified;

  // 🔒 이미지 첨부는 업로드 라우트 자체가 로그인 필수라(media-http.ts)
  // imageBtn을 비로그인일 땐 disabled로 막아둔다 — 그래서 이 분기에
  // 도달하는 텍스트 전용 흐름만 소프트 게이트하면 된다.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!canSubmit) return;

    if (!isLoggedIn) {
      setSubmitting(true);
      try {
        await fetch('/api/intent', {
          method: 'POST',
          body: JSON.stringify({ action: 'comment', targetId: postId, returnTo: window.location.pathname, draft: trimmed }),
        });
        router.push('/signin');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const finalBody = doneImages.length > 0 ? [trimmed, ...doneImages.map((img) => makeImageMarker(img.url!))].filter(Boolean).join('\n') : trimmed;

    setSubmitting(true);
    try {
      const res = await fetch('/api/comments', { method: 'POST', body: JSON.stringify({ postId, body: finalBody }) });
      if (!res.ok) return;
      const { id } = await res.json();
      // §11.5.2 낙관적 삽입
      setComments((prev) => [
        ...prev,
        {
          id,
          authorId: currentUserId ?? '',
          authorUsername: currentUsername ?? '나',
          authorNickname: currentNickname ?? currentUsername ?? '나',
          authorAvatarUrl: currentUserAvatarUrl ?? '',
          body: finalBody,
          createdAt: new Date().toISOString(),
          reactionCount: 0,
          myReaction: false,
          parentCommentId: null,
        },
      ]);
      setBody('');
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setImages([]);
    } finally {
      setSubmitting(false);
    }
  }

  // 🔒 후속(2026-08, "reply 댓글도 이미지첨부가 되어야해") — 메인 컴포저용
  // uploadOne이던 걸 setter를 받는 공용 함수로 일반화해 답글 컴포저와
  // 공유한다.
  async function uploadImageTo(id: string, file: File, setter: React.Dispatch<React.SetStateAction<PendingImage[]>>) {
    try {
      const res = await fetch('/api/media/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file });
      if (!res.ok) throw new Error('failed');
      const { url } = await res.json();
      setter((prev) => prev.map((img) => (img.id === id ? { ...img, status: 'done', url } : img)));
    } catch {
      setter((prev) => prev.map((img) => (img.id === id ? { ...img, status: 'error' } : img)));
    }
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 같은 파일을 다시 골라도 onChange가 또 발생하도록
    const room = MAX_IMAGES_PER_COMMENT - images.length;
    const toAdd = files.filter((f) => ALLOWED_IMAGE_MIME.includes(f.type)).slice(0, Math.max(room, 0));
    for (const file of toAdd) {
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      setImages((prev) => [...prev, { id, previewUrl, status: 'uploading' }]);
      uploadImageTo(id, file, setImages);
    }
  }

  function onReplyFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const room = MAX_IMAGES_PER_COMMENT - replyImages.length;
    const toAdd = files.filter((f) => ALLOWED_IMAGE_MIME.includes(f.type)).slice(0, Math.max(room, 0));
    for (const file of toAdd) {
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      setReplyImages((prev) => [...prev, { id, previewUrl, status: 'uploading' }]);
      uploadImageTo(id, file, setReplyImages);
    }
  }

  function onRemoveImage(id: string) {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }

  function onRemoveReplyImage(id: string) {
    setReplyImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }

  // 🔒 사용자 지시(2026-08) — "댓글 아이콘을 클릭하면 댓글쓰기 입력폼이
  // 아래에 나타나고". 최상위 댓글에서만 호출된다(답글에는 이 아이콘 자체가
  // 없다 — 렌더링 쪽에서 막는다). 다시 누르면 닫힌다. 🔒 비로그인은 로그인
  // 확인 모달(2026-08-24)만 띄운다 — 폼이 열리기 전 시점이라 잃을 입력값이
  // 없고, 이 규모의 부가 기능까지 §11.9.1 의도 보존 시스템을 확장하는 건
  // 범위를 넘어선다고 판단했다.
  function onToggleReply(commentId: string) {
    if (!isLoggedIn) {
      openLoginDialog();
      return;
    }
    setReplyingToId((prev) => (prev === commentId ? null : commentId));
    setReplyBody('');
    // 🔒 후속(2026-08, "reply 댓글도 이미지첨부가 되어야해") — 답글 폼을
    // 닫거나 다른 댓글로 전환할 때 이전 첨부도 같이 비운다(메인 컴포저의
    // 제출 후 정리와 같은 원칙).
    replyImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setReplyImages([]);
  }

  async function onSubmitReply(e: React.FormEvent, parentId: string) {
    e.preventDefault();
    const trimmed = replyBody.trim();
    if (!canSubmitReply) return;

    const finalBody = replyDoneImages.length > 0 ? [trimmed, ...replyDoneImages.map((img) => makeImageMarker(img.url!))].filter(Boolean).join('\n') : trimmed;

    setReplySubmitting(true);
    try {
      const res = await fetch('/api/comments', { method: 'POST', body: JSON.stringify({ postId, body: finalBody, parentCommentId: parentId }) });
      if (!res.ok) return;
      const { id } = await res.json();
      // §11.5.2 낙관적 삽입
      setComments((prev) => [
        ...prev,
        {
          id,
          authorId: currentUserId ?? '',
          authorUsername: currentUsername ?? '나',
          authorNickname: currentNickname ?? currentUsername ?? '나',
          authorAvatarUrl: currentUserAvatarUrl ?? '',
          body: finalBody,
          createdAt: new Date().toISOString(),
          reactionCount: 0,
          myReaction: false,
          parentCommentId: parentId,
        },
      ]);
      setReplyBody('');
      replyImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setReplyImages([]);
      setReplyingToId(null);
    } finally {
      setReplySubmitting(false);
    }
  }

  // 🔒 사용자 지시(2026-08, /design-review) — 댓글 하트. §11.5.2 "낙관적
  // 토글 + 카운트 즉시 증감" — ReactionBar.tsx의 handleClick과 같은 원칙,
  // 반응 하나(공감)뿐이라 로직은 더 단순하다. 🔒 후속(2026-08-24, "관련된
  // 페이지 모두 모달을... 로그인으로 이동") — 예전엔 버튼 자체를 disabled로
  // 막아 비로그인 클릭이 아무 반응 없었다가, 회원가입 즉시 이동을 거쳐
  // 이제 ReactionBar와 같은 로그인 확인 모달로 통일한다.
  async function onToggleReaction(commentId: string) {
    if (reactingId) return;
    if (!isLoggedIn) {
      openLoginDialog();
      return;
    }
    const target = comments.find((c) => c.id === commentId);
    if (!target) return;
    const prevReaction = target.myReaction;
    const prevCount = target.reactionCount;
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, myReaction: !prevReaction, reactionCount: prevReaction ? c.reactionCount - 1 : c.reactionCount + 1 } : c)),
    );
    setReactingId(commentId);
    setReactionEmailNotVerified(null);
    try {
      const res = await fetch(`/api/comments/${commentId}/reaction`, { method: 'POST' });
      if (!res.ok) {
        if (res.status === 403) setReactionEmailNotVerified(commentId);
        throw new Error('failed');
      }
    } catch {
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, myReaction: prevReaction, reactionCount: prevCount } : c)));
    } finally {
      setReactingId(null);
    }
  }

  function onToggleMenu(commentId: string) {
    setOpenMenuId((prev) => (prev === commentId ? null : commentId));
  }

  /** 🔒 M2 — Q&A 답변 채택/해제. 글 작성자만(PATCH /api/posts/:id/adoption). */
  async function onToggleAdopt(commentId: string) {
    if (!isLoggedIn || adoptingId) return;
    setAdoptingId(commentId);
    const prev = adoptedId;
    // 낙관적 갱신 — 채택은 단일 컬럼(하나만 유지)이므로 기존 채택을 즉시 벗긴다.
    setAdoptedId(prev === commentId ? null : commentId);
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(postPublicId)}/adoption`, {
        method: 'PATCH',
        body: JSON.stringify({ commentId: prev === commentId ? null : commentId }),
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { commentId: string | null };
      setAdoptedId(data.commentId); // 서버 응답으로 정합성 확정
    } catch {
      setAdoptedId(prev);
    } finally {
      setAdoptingId(null);
    }
  }

  function onCloseMenu() {
    setOpenMenuId(null);
  }

  // 🔒 후속(2026-08, "모든 버튼에서 두번 누르기 기능을 팝업으로 대체하고
  // 싶어" → "공용컴포넌트로 뽑아내줘") — 기존 "같은 버튼 2클릭" relabel
  // 패턴을 공용 ConfirmDialog 팝업으로 옮겼다. 메뉴에서 "삭제하기"를 누르면
  // 메뉴가 닫히고 확인 팝업이 뜬다.
  function onDeleteClick(commentId: string) {
    setConfirmDeleteId(commentId);
    onCloseMenu();
  }

  async function onConfirmDeleteComment() {
    if (!confirmDeleteId || deletePending) return;
    setDeletePending(true);
    try {
      const res = await fetch(`/api/comments/${confirmDeleteId}`, { method: 'DELETE' });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== confirmDeleteId));
      }
    } finally {
      setDeletePending(false);
      setConfirmDeleteId(null);
    }
  }

  async function onCopyLink(commentId: string) {
    try {
      await navigator.clipboard.writeText(window.location.href);
      // 🔒 ShareButton과 같은 원칙 — 복사 직후 메뉴를 바로 닫지 않고 라벨을
      // "복사됨"으로 잠깐 바꿔 보여준 뒤(2초) 스스로 사라진다.
      setCopiedId(commentId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // 클립보드 권한 거부 등 — 조용히 무시(ShareButton과 같은 원칙)
      onCloseMenu();
    }
  }

  // 🔒 Claude Design 확정안(2026-08) — artifact의 댓글 "..." 메뉴에 있던
  // "신고하기"(원문 "신고하기", 한글 그대로였다). ReportButton.tsx와 같은
  // API, 여기선 메뉴 항목 형태로 인라인 구현.
  async function onReportComment(commentId: string) {
    if (!isLoggedIn) {
      router.push('/signin');
      return;
    }
    if (reportedId === commentId) return;
    try {
      await fetch('/api/reports', { method: 'POST', body: JSON.stringify({ targetType: 'comment', targetId: commentId }) });
    } finally {
      setReportedId(commentId);
      setTimeout(onCloseMenu, 1200);
    }
  }

  // 🔒 사용자 지시(2026-08, 1-depth 답글) — 최상위 댓글마다 자기 답글을
  // 묶어서 렌더링한다("댓글은 thread처럼 그룹으로 묶고").
  // 🔒 M2(마감 후속, "채택된 답변은 상단에 고정") — 채택 댓글(id = adoptedId,
  // 낙관 state — 채택 즉시 이 값이 바뀌므로 props 원본이 아니라 state 기준)은
  // 최상위 목록에서 맨 앞으로 올린다. 나머지는 작성 순서 그대로( stabil).
  const topLevelComments = (() => {
    const flat = comments.filter((c) => !c.parentCommentId);
    if (!adoptedId) return flat;
    const adopted = flat.filter((c) => c.id === adoptedId);
    return adopted.length > 0 ? [...adopted, ...flat.filter((c) => c.id !== adoptedId)] : flat;
  })();
  const repliesOf = (parentId: string) => comments.filter((c) => c.parentCommentId === parentId);

  // 🔒 사용자 지시(2026-08, 1-depth 답글 후속) — "세로연결선을 원 댓글과
  // 댓글의 댓글 유저아이콘까지 연결하고 들여쓰기를 없애달라는것이야".
  // showThreadLine이 true인 행은 자기 아바타 아래로 선을 이어서 다음 행
  // (다음 답글, 또는 최초 답글)의 아바타까지 닿게 한다 — CSS만으로 처리
  // (아래 .threadLine 참고), 답글이 몇 개든/본문이 얼마나 길든 자기 박스
  // 기준 top/bottom 오프셋만 쓰므로 JS 계측이 필요 없다.
  function renderComment(c: CommentItem, { isReply, showThreadLine = false }: { isReply: boolean; showThreadLine?: boolean }) {
    return (
      <div key={c.id} className={showThreadLine ? `${styles.comment} ${styles.threadLine}` : styles.comment}>
        {/* 🔒 사용자 지시(2026-08) — "댓글 작성자 아바타"도 실제 프로필 사진을
            반영해야 한다. 이전엔 이니셜조차 없이 빈 원이었다. */}
        {c.authorAvatarUrl ? (
          <img src={c.authorAvatarUrl} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {c.authorNickname.trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className={styles.commentBody}>
          <div className={styles.commentMeta}>
            {/* 🔒 사용자 지시(2026-08, "유저 아이디 대신 유저네임으로 변경") —
                표시 텍스트만 닉네임으로 바꿨다. "Author" 배지 판별은 여전히
                username(고유값)으로 — 닉네임은 중복될 수 있어 신원 비교엔
                안 쓴다. 🔒 후속(2026-08-24, "닉네임 클릭시 얼럿 모달이
                떠야해") — 댓글엔 링크가 아예 없었다. PostCard·글내용과 같은
                `AuthorLink`로 신규 추가. */}
            <AuthorLink
              className={styles.commentAuthor}
              username={c.authorUsername}
              nickname={c.authorNickname}
              isLoggedIn={isLoggedIn}
            />
            <span className={styles.commentTime}>{relativeTime(c.createdAt)}</span>
            {/* 🔒 사용자 지시(2026-08, /design-review) — 레퍼런스 스크린샷의 "Author" 배지, 댓글 작성자가 글쓴이 본인일 때만 표시 */}
            {c.authorUsername === postAuthorUsername && <span className={styles.authorBadge}>Author</span>}
            {/* 🔒 M2 — 채택된 답변 배지. isReply인 답글도 채택 대상이므로 위치는 공용. */}
            {isQna && adoptedId === c.id && <span className={styles.adoptedBadge}>채택됨</span>}
          </div>
          <CommentBody body={c.body} className={styles.commentText} />
          {/* 🔒 후속(2026-08, 스크린샷 제시 — "아이콘들은 댓글 아래쪽에 위치
              해야하고") — 하트를 다시 본문 아래로 되돌렸다(한때 "···" 메뉴
              옆으로 옮겼던 걸 원복). 답글 버튼은 여전히 최상위 댓글에만 —
              "댓글의 댓글은 댓글을 달수 없도록 아이콘을 안보이게" 원칙 그대로,
              isReply면 이 버튼만 렌더링을 건너뛴다(하트는 답글에도 보인다). */}
          <div className={styles.commentActions}>
            <button
              type="button"
              className={c.myReaction ? `${styles.commentReactionBtn} ${styles.commentReactionActive}` : styles.commentReactionBtn}
              onClick={() => onToggleReaction(c.id)}
              disabled={isLoggedIn && reactingId === c.id}
              aria-label="좋아요"
              aria-pressed={c.myReaction}
            >
              <ReactionIcon type="empathy" size={18} />
              {c.reactionCount > 0 && <span>{c.reactionCount}</span>}
            </button>
            {!isReply && (
              <button
                type="button"
                className={replyingToId === c.id ? `${styles.commentReplyBtn} ${styles.commentReplyActive}` : styles.commentReplyBtn}
                onClick={() => onToggleReply(c.id)}
                aria-label="답글 달기"
                aria-pressed={replyingToId === c.id}
              >
                <ReplyIcon />
              </button>
            )}
            {/* 🔒 M2 — Q&A 채택 컨트롤. 글 작성자에게만 보이고, 글 작성자의
                TBD 반응줄 옆에 채택/해제 토글이 있다(단일 채택). */}
            {isQna && isPostOwner && (
              <button
                type="button"
                className={adoptedId === c.id ? `${styles.adoptBtn} ${styles.adoptBtnActive}` : styles.adoptBtn}
                onClick={() => onToggleAdopt(c.id)}
                disabled={adoptingId === c.id}
                aria-pressed={adoptedId === c.id}
              >
                {adoptedId === c.id ? '채택 해제' : '채택하기'}
              </button>
            )}
          </div>
          {reactionEmailNotVerified === c.id && <EmailVerifyNotice />}
        </div>
        {/* "···" 메뉴만 남는다 — .comment의 직속 flex item(align-self:flex-start는
            CommentSection.module.css .commentMenuWrap이 직접 갖는다). */}
        {currentUserId && (
          <div className={styles.commentMenuWrap}>
            <button type="button" className={styles.menuTrigger} onClick={() => onToggleMenu(c.id)} aria-label="더보기">
              <DotsIcon />
            </button>
            {openMenuId === c.id && (
              <>
                <div className={styles.menuOverlay} onClick={onCloseMenu} />
                <div className={styles.menuPopover}>
                  {/* 🔒 사용자 지시(2026-08, "댓글 부분도 목업 디자인으로 마이그레이션
                      해줘") — artifact `showDetail` 댓글 "···" 메뉴 실측 순서
                      (삭제하기→신고하기→링크복사) 그대로. */}
                  {c.authorId === currentUserId && (
                    <button type="button" className={styles.menuItemDanger} onClick={() => onDeleteClick(c.id)}>
                      <TrashIcon />
                      삭제하기
                    </button>
                  )}
                  <button type="button" className={styles.menuItem} onClick={() => onReportComment(c.id)}>
                    <FlagIcon />
                    {reportedId === c.id ? '신고 접수됨' : '신고하기'}
                  </button>
                  <button type="button" className={styles.menuItem} onClick={() => onCopyLink(c.id)}>
                    <LinkIcon />
                    {copiedId === c.id ? '복사됨' : '링크 복사'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // 🔒 사용자 지시(2026-08, "댓글 1 이부분도 없애줘") — "댓글 N" 카운트
  // 헤딩을 완전히 뺐다(예전엔 <h2>댓글 {comments.length}</h2>).
  return (
    <div>
      {/* 🔒 사용자 지시(2026-08-24, "댓글쓰기 폼... 안보이게 해서 진입점을
          없애야") — 예전엔 폼은 그대로 두고 개별 컨트롤(이미지 첨부·전송)만
          disabled였다. 이제 비로그인이면 폼 자체를 렌더링하지 않는다 — 댓글은
          위 onToggleReply에서 이미 /signup으로 보내므로 여기서 잃을 입력값도 없다. */}
      {isLoggedIn && (
        <>
          {images.length > 0 && (
        <div className={styles.imagePreviewRow}>
          {images.map((img) => (
            <div key={img.id} className={styles.imagePreviewItem}>
              <img src={img.previewUrl} alt="" className={styles.imagePreviewThumb} />
              {img.status === 'uploading' && <span className={styles.imagePreviewSpinner} aria-hidden="true" />}
              {img.status === 'error' && (
                <span className={styles.imagePreviewError} title="업로드 실패">
                  !
                </span>
              )}
              <button type="button" className={styles.imagePreviewRemove} onClick={() => onRemoveImage(img.id)} aria-label="이미지 제거">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 🔒 사용자 지시(2026-08, "댓글 부분도 목업 디자인으로 마이그레이션
          해줘") — artifact는 아바타를 pill 바깥의 별도 원으로 두고, pill
          자체는 입력창+아이콘+버튼만 감싼다(bg #f0f3ff = --search-bg, 이미
          토큰 전면 교체 라운드에서 정확히 일치하게 됨). 기존엔 아바타까지
          한 pill 안에 같이 두르고 있었다 — .composerRow(아바타+pill을 담는
          바깥 flex)와 .composerPill(입력창 전용 캡슐)로 분리. */}
      <form className={styles.composerRow} onSubmit={onSubmit}>
        {/* 🔒 사용자 발견(2026-08, "댓글입력창에 내 아바타가 안보여") — 이전엔
            항상 빈 원이었다. */}
        {currentUserAvatarUrl ? (
          <img src={currentUserAvatarUrl} alt="" className={styles.composerAvatar} />
        ) : (
          <span className={styles.composerAvatar} aria-hidden="true">
            {initial(currentNickname ?? currentUsername ?? '나')}
          </span>
        )}
        <div className={styles.composerPill}>
          <input
            ref={inputRef}
            className={emailVerified ? styles.composerInput : `${styles.composerInput} ${styles.composerInputWarn}`}
            type="text"
            placeholder={emailVerified ? `Reply to ${postAuthorUsername}...` : '이메일 인증 후 작성할 수 있어요'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!emailVerified}
            aria-label="댓글"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_IMAGE_MIME.join(',')}
            multiple
            onChange={onFilesSelected}
            style={{ display: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className={styles.composerActions}>
            <button
              type="button"
              className={styles.imageBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={!isLoggedIn || !emailVerified || images.length >= MAX_IMAGES_PER_COMMENT}
              title={!isLoggedIn ? '로그인 후 이용 가능해요' : !emailVerified ? '이메일 인증 후 이용 가능해요' : '이미지 첨부'}
              aria-label="이미지 첨부"
            >
              <ImageIcon />
            </button>
            <button type="submit" className={styles.sendBtn} disabled={!canSubmit} aria-label="댓글 등록">
              <SendIcon />
            </button>
          </div>
        </div>
      </form>
        </>
      )}

      {comments.length === 0 ? (
        <p className={styles.empty}>아직 댓글이 없어요.</p>
      ) : (
        <div className={styles.list}>
          {topLevelComments.map((c) => {
            const replies = repliesOf(c.id);
            const isReplying = replyingToId === c.id;
            return (
              <div key={c.id} className={styles.threadGroup}>
                {renderComment(c, { isReply: false, showThreadLine: replies.length > 0 })}
                {(replies.length > 0 || isReplying) && (
                  <div className={styles.repliesList}>
                    {replies.map((r, i) => renderComment(r, { isReply: true, showThreadLine: i < replies.length - 1 }))}
                    {isReplying && (
                      <>
                        {/* 🔒 후속(2026-08, "reply 댓글도 이미지첨부가 되어야해") —
                            메인 컴포저의 imagePreviewRow와 같은 패턴. */}
                        {replyImages.length > 0 && (
                          <div className={styles.imagePreviewRow}>
                            {replyImages.map((img) => (
                              <div key={img.id} className={styles.imagePreviewItem}>
                                <img src={img.previewUrl} alt="" className={styles.imagePreviewThumb} />
                                {img.status === 'uploading' && <span className={styles.imagePreviewSpinner} aria-hidden="true" />}
                                {img.status === 'error' && (
                                  <span className={styles.imagePreviewError} title="업로드 실패">
                                    !
                                  </span>
                                )}
                                <button type="button" className={styles.imagePreviewRemove} onClick={() => onRemoveReplyImage(img.id)} aria-label="이미지 제거">
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <form className={`${styles.composerRow} ${styles.replyComposerRow}`} onSubmit={(e) => onSubmitReply(e, c.id)}>
                          {currentUserAvatarUrl ? (
                            <img src={currentUserAvatarUrl} alt="" className={styles.composerAvatar} />
                          ) : (
                            <span className={styles.composerAvatar} aria-hidden="true">
                              {initial(currentNickname ?? currentUsername ?? '나')}
                            </span>
                          )}
                          <div className={styles.composerPill}>
                            <input
                              className={emailVerified ? styles.composerInput : `${styles.composerInput} ${styles.composerInputWarn}`}
                              type="text"
                              placeholder={emailVerified ? `Reply to ${c.authorUsername}...` : '이메일 인증 후 작성할 수 있어요'}
                              value={replyBody}
                              onChange={(e) => setReplyBody(e.target.value)}
                              disabled={!emailVerified}
                              aria-label="답글"
                              autoFocus
                            />
                            <input
                              ref={replyFileInputRef}
                              type="file"
                              accept={ALLOWED_IMAGE_MIME.join(',')}
                              multiple
                              onChange={onReplyFilesSelected}
                              style={{ display: 'none' }}
                              aria-hidden="true"
                              tabIndex={-1}
                            />
                            <div className={styles.composerActions}>
                              <button
                                type="button"
                                className={styles.imageBtn}
                                onClick={() => replyFileInputRef.current?.click()}
                                disabled={!emailVerified || replyImages.length >= MAX_IMAGES_PER_COMMENT}
                                title={!emailVerified ? '이메일 인증 후 이용 가능해요' : '이미지 첨부'}
                                aria-label="이미지 첨부"
                              >
                                <ImageIcon />
                              </button>
                              <button type="submit" className={styles.sendBtn} disabled={!canSubmitReply} aria-label="답글 등록">
                                <SendIcon />
                              </button>
                            </div>
                          </div>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        message="이 댓글을 삭제할까요? 삭제하면 되돌릴 수 없어요."
        confirmLabel="삭제"
        pendingLabel="삭제 중…"
        pending={deletePending}
        onConfirm={onConfirmDeleteComment}
        onCancel={() => setConfirmDeleteId(null)}
      />
      {loginDialog}
    </div>
  );
}
