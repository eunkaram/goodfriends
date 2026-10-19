'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { History } from '@tiptap/extension-history';
import { Placeholder } from '@tiptap/extension-placeholder';
import type { FeedPost } from '../lib/feed.ts';
import type { Category } from '../lib/categories.ts';
type LogPostVisibility = 'public' | 'followers';
import { makeImageMarker, hasImageMarkers, parseBodyWithImageMarkers, detectFirstLink, hasStandaloneMediaLine } from '../lib/link-detect.ts';
import { LinkPreviewCard } from './LinkPreviewCard.tsx';
import { ComposerImage } from './composer-image-extension.ts';
import { ComposerLinkPreview } from './composer-link-preview-extension.tsx';
import { LinkAutoConvert } from './composer-link-autoconvert.ts';
import { TrailingParagraph } from './composer-trailing-paragraph.ts';
import { useModalOpenEffect } from './use-modal-open-effect.ts';
import { EmailVerifyNotice } from './EmailVerifyNotice.tsx';
import styles from './HomeFeed.module.css';

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
// 🔒 사용자 지시(2026-08, "글쓰기 팝업에서 이미지 업로드 기능 처리해줘") —
// CommentSection.tsx의 MAX_IMAGES_PER_COMMENT(4)보다 넉넉하게 잡았다 —
// 글은 댓글보다 콘텐츠 단위가 커서(붙여넣기로는 이미 개수 제한이 없다,
// link-detect.ts 참고) 명시적 업로드 버튼도 조금 더 여유를 두는 게
// 자연스럽다고 판단한 값이라, 정확히 이 숫자여야 할 근거는 없다.
const MAX_IMAGES_PER_POST = 8;

/** 🔒 사용자 지시(2026-08, "UI는 이대로 적용해. 너가 마음대로 절대 하지마.
 * 시키는대로만 해" — 아티팩트에서 뽑아온 실제 HTML/인라인 스타일 그대로) —
 * 아이콘 path·크기 전부 사용자가 준 소스와 1:1로 일치시킨다. */
function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.8" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="M4.5 16.5l4.3-5 3.2 3.6 2.5-3 4.9 4.4" />
    </svg>
  );
}

/** 🔒 사용자 지시(2026-08, 위 주석 참고) — "일상/잡담"(커뮤니티) 대상 아이콘. */
function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6" />
      <path d="M16 6.2a3 3 0 0 1 0 5.8M17.5 14.6c2 .6 3.2 2 3.2 4.4" />
    </svg>
  );
}

/** 🔒 사용자 지시(2026-08, 위 주석 참고) — "My Post" 대상 아이콘. */
function LogIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 19.5c0-3.4 3.1-5.2 7-5.2s7 1.8 7 5.2" />
    </svg>
  );
}

/** 🔒 사용자 지시(2026-08, 위 주석 참고) — "전체공개" 아이콘. */
function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4" />
      <path d="M12 3.8c2.4 2.4 2.4 13.9 0 16.4-2.4-2.5-2.4-14 0-16.4z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6L18 18 M18 6L6 18" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

/**
 * 🔒 사용자 지시(2026-08, "내가 원하는 글쓰기 폼이아니야. wysiwyg editor
 * 같은 입력폼을 원해") — 그 전 라운드들이 plain `<textarea>` 위에 마커
 * 텍스트(그다음엔 라벨 텍스트)를 심어 넣는 방식으로 "이미지 + 글 + 이미지
 * + 글"과 "경로 안 보이기"를 풀었는데, 사용자가 원한 건 그게 아니라
 * 이미지가 편집 중에 실제 그림으로 바로 보이는 진짜 WYSIWYG였다.
 * Tiptap(ProseMirror 기반)으로 교체 — AskUserQuestion으로 확인한 범위는
 * "이미지만 인라인 실사, 볼드/이탤릭 등 서식 도구는 없음"이라 StarterKit
 * 대신 최소 확장 세트(Document/Paragraph/Text/History/Placeholder +
 * 커스텀 ComposerImage 노드)만 등록했다 — 그래야 Ctrl+B 같은 서식
 * 단축키나 마크다운 자동변환이 실수로도 안 끼어든다.
 *
 * 저장 형식은 그대로다: 제출 시 `docToBody()`가 에디터의 JSON 문서를
 * 순회해 기존 마커 포맷(SOH+IMG:+url)으로 직렬화한다 — DB·피드 카드·
 * 포스트 상세가 파싱하는 형식은 전혀 안 바뀐다. 반대로 글 수정 모드는
 * `bodyToDoc()`이 그 저장된 마커를 에디터 문서로 되돌려서 초기 내용을
 * 채운다.
 */
/** 수정 대상 글 — 있으면 컴포저가 "새 글 쓰기" 대신 "글 수정" 모드로 동작한다.
 * 🔒 사용자 지시(2026-08, "게시판에 글을 쓸건지 내 로그(프로파일)에만
 * 글을 쓸건지 선택이 필요해") — categoryId가 null이면 로그 전용 글이라는
 * 뜻이고, 그때 visibility가 실제 값을 갖는다(게시판 글이면 무시됨, 항상
 * 'public'이라서). */
export type EditingPost = { id: string; title: string; body: string; categoryId: string | null; visibility: LogPostVisibility };

/** body(마커 포함 저장 형식) → Tiptap 문서. 빈 줄도 빈 문단으로 보존해서
 * 왕복 시 사용자가 일부러 띄운 문단 간격이 사라지지 않게 한다.
 * 🔒 사용자 지시(2026-08, "글, 영상, 글, 미디어, 영상 이런식으로
 * 수정했었는데 또 고낭났어. 글쓰기와 글 내용수정 둘다 같은 기능이어야해") —
 * "줄 전체가 URL 하나뿐인" 줄도 이미지 마커처럼 독립 노드(composerLinkPreview)로
 * 되돌린다(lib/link-detect.ts의 parseBodySegments와 판정 규칙 동일) — 그래야
 * 글 수정 화면이 새 글쓰기 때 라이브로 봤던 것과 완전히 같은 인라인 미리보기를
 * 보여준다. */
function lineToNode(line: string): JSONContent {
  const trimmed = line.trim();
  if (trimmed) {
    const link = detectFirstLink(trimmed);
    if (link && link.url === trimmed) return { type: 'composerLinkPreview', attrs: { url: link.url } };
  }
  return line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' };
}

function bodyToDoc(rawBody: string): JSONContent {
  const toNodes = (text: string): JSONContent[] => text.split('\n').map(lineToNode);

  let content: JSONContent[];
  if (!hasImageMarkers(rawBody)) {
    content = rawBody ? toNodes(rawBody) : [];
  } else {
    content = [];
    for (const seg of parseBodyWithImageMarkers(rawBody)) {
      if (seg.type === 'text') content.push(...toNodes(seg.value));
      else content.push({ type: 'composerImage', attrs: { src: seg.url, uploadId: null, status: 'done' } });
    }
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

/** Tiptap 문서 → body(마커 포함 저장 형식). 제출·hasUnsavedChanges 비교 둘 다 이걸 쓴다.
 * composerLinkPreview는 마커가 아니라 plain text 한 줄(그 URL 그대로)로
 * 되돌린다 — ComposerImage와 다른 점: 이건 업로드가 아니라 사용자가 이미
 * 타이핑한 URL을 시각적으로만 승격시킨 것이라, 저장 형식에는 원래 텍스트
 * 그대로 남아야 발행 페이지의 기존 렌더링(BodyContent의 링크 감지)과
 * 어긋나지 않는다. */
function docToBody(json: JSONContent): string {
  const lines: string[] = [];
  for (const node of json.content ?? []) {
    if (node.type === 'paragraph') {
      lines.push((node.content ?? []).map((c) => c.text ?? '').join(''));
    } else if (node.type === 'composerImage') {
      const src = node.attrs?.src as string | undefined;
      if (src) lines.push(makeImageMarker(src));
    } else if (node.type === 'composerLinkPreview') {
      const url = node.attrs?.url as string | undefined;
      if (url) lines.push(url);
    }
  }
  return lines.join('\n');
}

function countComposerImages(json: JSONContent): number {
  return (json.content ?? []).filter((n) => n.type === 'composerImage').length;
}

export function PostComposerModal({
  categories,
  defaultCategoryId,
  authorId,
  authorUsername,
  authorNickname,
  authorAvatarUrl,
  editingPost,
  onCreated,
  onUpdated,
  onClose,
}: {
  categories: Category[];
  defaultCategoryId?: string;
  /** 낙관적 삽입 카드의 소유자 판별용(§11.7.7 "···" 메뉴 삭제하기) — 새 글쓰기 경로에서만 쓰인다.
   * `editingPost`(수정 모드)는 onCreated를 안 타서 이 값 없이도 안전하다 — PostDetailMenu가
   * 전달하지 않는다. */
  authorId?: string;
  authorUsername: string;
  authorNickname: string;
  /** 🔒 사용자 발견(2026-08, "글쓰기, 글 수정 팝업에 내 아바타가 표시가
   * 안돼") — 프로필 사진을 좌 사이드바·글 목록/상세·댓글엔 반영했지만
   * 이 모달만 빠져 있었다(그 라운드 이후 신설된 화면이라). 있으면
   * 실제 사진, 없으면 기존처럼 닉네임 이니셜. */
  authorAvatarUrl?: string | null;
  /** 사용자 발견(2026-08) — "내글에 대해 수정기능이 없어". 있으면 폼이 이 값으로 채워지고 PATCH로 제출한다. */
  editingPost?: EditingPost;
  onCreated?: (post: FeedPost) => void;
  onUpdated?: (postId: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const isEditing = editingPost !== undefined;
  // 🔒 사용자 지시(2026-08, "Post Option을 넣어야 할것 같아. 게시판에 글을
  // 쓸건지 내 로그(프로파일)에만 글을 쓸건지 선택이 필요해") — 수정 모드는
  // 기존 글의 categoryId 유무로 초기값을 정한다(null이면 로그 전용 글이었다는 뜻).
  //
  // 🔒 후속(2026-08, Threads 스크린샷 첨부 — "새글쓰기를 커뮤니티에서
  // 시작하면 기본적으로 커뮤니티의 카테고리가 기본 선택이 되어있어야 하고...
  // 커뮤니티 외에서 새글쓰기를 하면 내로그가 기본설정... post option의
  // 경우, 커뮤니티에서 글쓰기를 할경우 기본값은 전체 공개, 그외는
  // follower가 기본값") — 새 글쓰기(수정 아님)일 때 `defaultCategoryId`
  // 존재 여부로 "커뮤니티에서 시작했는지"를 판별한다. `CategoryFeed.tsx`는
  // 항상 현재 카테고리를 넘기고(커뮤니티 진입점), `HomeFeed.tsx`는 아예
  // 안 넘긴다(커뮤니티 밖 진입점) — 이미 있던 이 prop 하나로 "어디서
  // 시작했는지"가 정확히 갈린다. 초기 계산은 마운트 시점 한 번뿐 — 사용자가
  // 이후 Post Option을 직접 눌러 바꾸면(예: 게시판→내 로그) 그 선택을
  // 그대로 존중하고 되돌리지 않는다("시작하면"이라는 표현 그대로).
  const initialDestination: 'board' | 'log' = editingPost
    ? editingPost.categoryId
      ? 'board'
      : 'log'
    : defaultCategoryId
      ? 'board'
      : 'log';
  const [destination, setDestination] = useState<'board' | 'log'>(initialDestination);
  const [visibility, setVisibility] = useState<LogPostVisibility>(
    editingPost?.visibility ?? (initialDestination === 'board' ? 'public' : 'followers'),
  );
  const [categoryId, setCategoryId] = useState(editingPost?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '');
  const [title, setTitle] = useState(editingPost?.title ?? '');
  // 🔒 에디터가 실제 편집 상태를 들고 있고, bodyText는 그로부터 파생된
  // "현재 저장 형식" 문자열이다(에디터 onUpdate마다 갱신) — hasUnsavedChanges·
  // canSubmit·제출 payload 전부 이 문자열을 그대로 쓴다. 라벨/마커를
  // textarea에 직접 넣던 이전 방식과 달리 이제 body는 항상 최종 저장
  // 형식과 동일해서 별도 "펼치기" 변환이 필요 없다.
  const [bodyText, setBodyText] = useState(editingPost?.body ?? '');
  const [uploadingCount, setUploadingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 🔒 사용자 지시(2026-08, "글쓰기 취소시 경고메세지를 띄워줘야 할것 같아") —
  // 오버레이 클릭·×버튼·Escape 셋 다 이 상태를 거친다.
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // 🔒 사용자 지시(2026-08, 첨부 스크린샷 — "일상/잡담은 선택된 상태에서
  // 한번더 클릭하면 카테고리 리스트를 보여주는거야") — 카테고리 선택
  // 드롭다운 열림 상태. destination이 'board'가 아니게 되면 렌더 조건
  // 자체가 false가 돼 자동으로 닫힌다(아래 JSX 참고).
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  useModalOpenEffect(true);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      ComposerImage,
      ComposerLinkPreview,
      LinkAutoConvert,
      TrailingParagraph,
      Placeholder.configure({ placeholder: '오늘의 이야기를 들려주세요…' }),
    ],
    content: bodyToDoc(editingPost?.body ?? ''),
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      setBodyText(docToBody(editor.getJSON()));
    },
    editorProps: {
      attributes: { 'aria-label': '본문', class: styles.composerEditor },
      // 🔒 클립보드에 이미지 "파일"이 직접 들어있는 경우(스크린샷 붙여넣기
      // 등) — HTML의 <img> 태그가 아니라 진짜 파일이라 ComposerImage의
      // parseHTML로는 안 잡힌다. 여기서 가로채 버튼 업로드와 같은
      // 파이프라인(uploadImage)으로 흘려보낸다. 이미지 파일이 없는
      // 붙여넣기(일반 텍스트, <img> 태그가 있는 HTML 등)는 false를 반환해
      // Tiptap 기본 처리로 넘긴다 — HTML 안의 <img>는 ComposerImage.parseHTML이
      // 알아서 노드로 되돌린다.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => ALLOWED_IMAGE_MIME.includes(f.type));
        if (files.length === 0) return false;
        event.preventDefault();
        insertFiles(files);
        return true;
      },
    },
  });

  // 🔒 새 글쓰기는 "뭐라도 입력했으면" 미저장 취급, 글 수정은 원래 값과
  // 달라진 게 있을 때만 — 수정 모드는 항상 title/body가 비어있지 않은
  // 상태로 시작하므로 "비어있지 않음"만으로는 항상 경고가 뜨게 된다.
  // bodyText가 이제 항상 저장 형식 그대로라 editingPost.body와 직접 비교하면 된다.
  const hasUnsavedChanges = isEditing
    ? title !== (editingPost?.title ?? '') || bodyText !== (editingPost?.body ?? '')
    : title.trim().length > 0 || bodyText.trim().length > 0;

  function requestClose() {
    if (hasUnsavedChanges) {
      setShowLeaveConfirm(true);
      return;
    }
    onClose();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // 확인 창이 이미 떠 있으면 Escape는 그 확인부터 닫는다(안전한 기본값 —
      // 초안을 지키는 쪽) — requestClose를 다시 부르지 않는다. 카테고리
      // 드롭다운이 열려 있으면 그것부터 닫는다(같은 원칙 — 가장 안쪽 UI부터).
      if (showLeaveConfirm) {
        setShowLeaveConfirm(false);
        return;
      }
      if (categoryMenuOpen) {
        setCategoryMenuOpen(false);
        return;
      }
      requestClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges, showLeaveConfirm, categoryMenuOpen]);

  // 🔒 CommentSection.tsx의 uploadImageTo와 정확히 같은 업로드 자체(§17.3
  // 인프라, R2, POST /api/media/upload). 완료·실패 둘 다 노드를 "위치"가
  // 아니라 uploadId로 다시 찾아서 반영한다 — 편집 중 계속 바뀌는 위치를
  // 신뢰하면 안 되는 ProseMirror의 표준 패턴(doc.descendants로 순회).
  async function uploadImage(uploadId: string, file: File) {
    try {
      const res = await fetch('/api/media/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file });
      if (!res.ok) throw new Error('failed');
      const { url } = await res.json();
      updateImageNode(uploadId, { src: url, status: 'done' });
    } catch {
      removeImageNode(uploadId);
    } finally {
      setUploadingCount((n) => n - 1);
    }
  }

  function findImageNodePos(uploadId: string): { pos: number; size: number } | null {
    if (!editor) return null;
    let found: { pos: number; size: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name === 'composerImage' && node.attrs.uploadId === uploadId) {
        found = { pos, size: node.nodeSize };
        return false;
      }
      return true;
    });
    return found;
  }

  function updateImageNode(uploadId: string, attrs: Partial<{ src: string; status: 'uploading' | 'done' }>) {
    if (!editor) return;
    const found = findImageNodePos(uploadId);
    if (!found) return; // 사용자가 업로드 도중 이미 지웠을 수 있다 — 조용히 무시
    const node = editor.state.doc.nodeAt(found.pos);
    if (!node) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(found.pos, undefined, { ...node.attrs, ...attrs }));
  }

  function removeImageNode(uploadId: string) {
    if (!editor) return;
    const found = findImageNodePos(uploadId);
    if (!found) return;
    editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + found.size));
  }

  /** 파일 선택(버튼)·이미지 붙여넣기(파일) 공용 삽입 경로. 커서 위치는
   * Tiptap이 삽입 직후 그 바로 뒤로 옮겨준다 — 이미지가 문서 맨 끝에
   * 삽입돼 뒤에 커서 둘 곳이 없어지는 경우(그대로 두면 NodeSelection이
   * 남아 다음 타이핑이 이미지를 치환해버렸다)는 이제 composer-trailing-
   * paragraph.ts의 ProseMirror 플러그인이 문서 레벨 불변식으로 일괄
   * 처리한다 — 이 함수에서 개별 패치할 필요가 없어졌다. */
  function insertFiles(files: File[]) {
    if (!editor) return;
    const room = MAX_IMAGES_PER_POST - countComposerImages(editor.getJSON());
    const toAdd = files.slice(0, Math.max(room, 0));
    for (const file of toAdd) {
      const uploadId = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      editor.chain().focus().insertContent({ type: 'composerImage', attrs: { src: previewUrl, uploadId, status: 'uploading' } }).run();
      setUploadingCount((n) => n + 1);
      uploadImage(uploadId, file);
    }
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => ALLOWED_IMAGE_MIME.includes(f.type));
    e.target.value = ''; // 같은 파일을 다시 골라도 onChange가 또 발생하도록
    insertFiles(files);
  }

  const currentImageCount = editor ? countComposerImages(editor.getJSON()) : 0;
  // 🔒 사용자 발견(2026-08, "글쓰기시에 내용을 줄바꿈만 넣어도 저장이 돼.
  // 글자수를 체크하는 로직을 추가해") — 빈 문단만 여러 개 넣으면 bodyText가
  // "\n\n" 같은 줄바꿈만 남는데, 지금까지 title만 체크해서 그대로 통과했다.
  // bodyText.trim()은 이미지 마커·링크 한 줄만 있어도 빈 문자열이 아니라
  // 통과한다 — "사진만 있는 글"은 그대로 허용해야 하니 의도한 동작이다.
  const canSubmit =
    title.trim().length > 0 &&
    bodyText.trim().length > 0 &&
    !submitting &&
    uploadingCount === 0 &&
    (destination === 'board' ? !!categoryId : true);
  const currentCategoryName = categories.find((c) => c.id === categoryId)?.name ?? '카테고리';

  // 🔒 사용자 지시(2026-08, 첨부 스크린샷 — "일상/잡담(커뮤니티 카테고리)/my
  // post부분은 토글이야. 그리고 일상/잡담은 선택된 상태에서 한번더
  // 클릭하면 카테고리 리스트를 보여주는거야") — 이미 board 모드면 카테고리
  // 드롭다운을 토글하고, 아니면 board 모드로 먼저 전환만 한다(드롭다운은
  // 그 다음 클릭에야 연다) — 모드 전환과 목록 열기를 한 클릭에 같이 하면
  // "무슨 일이 일어난 건지" 한눈에 안 들어온다.
  function onClickBoardToggle() {
    if (destination !== 'board') {
      setDestination('board');
      return;
    }
    setCategoryMenuOpen((v) => !v);
  }

  function onClickLogToggle() {
    setDestination('log');
    setCategoryMenuOpen(false);
  }

  function onSelectCategory(id: string) {
    setCategoryId(id);
    setCategoryMenuOpen(false);
  }

  // 🔒 사용자 지시(2026-08, "공개 부분은 커뮤니티 선택시 전체공개만, my
  // post가 선택된 상태에서는 전체공개/follower only로 선택할수 있어야해") —
  // 커뮤니티 글은 §5.2 CHECK로 항상 전체공개가 DB 레벨에서 강제되므로
  // board 모드에서는 이 버튼이 아예 disabled(값 자체도 항상 'public'로
  // 제출됨, onSubmit 참고) — log 모드에서만 두 값 사이를 직접 토글한다.
  function onClickVisibilityToggle() {
    if (destination === 'board') return;
    setVisibility((v) => (v === 'public' ? 'followers' : 'public'));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const finalBody = bodyText.trim();
    setSubmitting(true);
    setEmailNotVerified(false);
    try {
      if (isEditing) {
        const payload = destination === 'board' ? { categoryId, title, body: finalBody } : { title, body: finalBody, visibility };
        const res = await fetch(`/api/posts/${editingPost.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (!res.ok) {
          if (res.status === 403) setEmailNotVerified(true);
          return;
        }
        onUpdated?.(editingPost.id);
        return;
      }
      // 🔒 사용자 지시(2026-08, "내로그에만 쓴 글") — 로그 전용 글은 홈/카테고리
      // 피드에 애초에 안 나타나므로(§5, category_id 기반 조회) 그 목록에
      // 낙관적으로 끼워 넣지 않는다 — 대신 NewPostComposer와 같은 방식으로
      // 새 글의 permalink로 바로 이동한다(어느 화면에서 열었든 동일하게 동작).
      if (destination === 'log') {
        const res = await fetch('/api/posts', { method: 'POST', body: JSON.stringify({ title, body: finalBody, visibility }) });
        if (!res.ok) {
          if (res.status === 403) setEmailNotVerified(true);
          return;
        }
        const { publicId } = await res.json();
        onClose();
        router.push(`/post/${publicId}`);
        return;
      }
      const res = await fetch('/api/posts', { method: 'POST', body: JSON.stringify({ categoryId, title, body: finalBody }) });
      if (!res.ok) {
        if (res.status === 403) setEmailNotVerified(true);
        return;
      }
      const { id, publicId } = await res.json();
      const category = categories.find((c) => c.id === categoryId);
      // §11.5.2 낙관적 삽입 — 카운트는 0으로 시작(서버 재조회 없이도 정확하다, 방금 만든 글이라서)
      onCreated?.({
        id,
        publicId,
        title,
        bodyPreview: finalBody.slice(0, 300),
        authorId: authorId ?? '',
        authorUsername,
        authorNickname,
        authorAvatarUrl: authorAvatarUrl ?? '',
        categoryName: category?.name ?? '',
        categorySlug: category?.slug ?? '',
        createdAt: new Date().toISOString(),
        reactionCount: 0,
        commentCount: 0,
        deletedAt: null,
      });
      setTitle('');
      editor?.commands.clearContent();
      setBodyText('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={requestClose}>
      <form className={styles.composer} onSubmit={onSubmit} onClick={(e) => e.stopPropagation()}>
        <div className={styles.composerHeader}>
          <span className={styles.composerHeaderTitle}>{isEditing ? '글 수정' : '글 쓰기'}</span>
          <button type="button" className={styles.modalCloseBtn} onClick={requestClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </div>
        <div className={styles.composerTop}>
          {authorAvatarUrl ? (
            <img src={authorAvatarUrl} alt="" className={styles.composerAvatar} />
          ) : (
            <span className={styles.composerAvatar} aria-hidden="true">
              {initial(authorNickname)}
            </span>
          )}
          <div className={styles.composerFields}>
            {/* 🔒 사용자 지시(2026-08, 첨부 스크린샷 — "글쓰기 팝업을 새로
                디자인했어") — 게시 대상(게시판/My Post) 선택을 아바타 옆
                브레드크럼에서 아예 걷어내 푸터의 카테고리·My Post 토글
                버튼으로 옮겼다(아래 참고) — 새 목업엔 아바타 옆에 닉네임도,
                destination 표시도 없다. */}
            <input
              type="text"
              placeholder="제목을 입력하세요"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="제목"
              maxLength={200}
              className={styles.titleInput}
              autoFocus
            />
            {/* 🔒 사용자 지시(2026-08, "내가 원하는 글쓰기 폼이아니야. wysiwyg
                editor 같은 입력폼을 원해", 후속 — "글, 영상, 글, 미디어,
                영상 이런식으로 수정했었는데 또 고낭났어. 글쓰기와 글
                내용수정 둘다 같은 기능이어야해") — 이미지는 ComposerImage,
                "줄 전체가 URL인" 유튜브·mp4·일반 링크는 ComposerLinkPreview
                노드로 둘 다 에디터 안에서 실제 최종 모습 그대로 보인다
                (composer-link-autoconvert.ts가 문단이 완결되는 순간 자동
                전환한다) — 텍스트·이미지·영상이 어떤 순서·개수로 섞여도
                (예: 글→영상→글→이미지→영상) 원문 순서 그대로, 별도
                라벨·마커 텍스트 없이 라이브로 보인다. */}
            <EditorContent editor={editor} className={styles.composerEditorWrap} />
            {/* 🔒 남은 한 가지 경우 — 문장 중간에 자연스럽게 낀 링크("이거
                봤어? https://... 재밌더라")는 그 줄 전체가 URL이 아니라서
                위 자동 전환 대상이 아니다(Threads·Slack류 관례 — 문장
                흐름을 안 깨려고 "줄 전체가 URL일 때만" 임베드한다,
                lib/link-detect.ts의 parseBodySegments 참고). 이 경우만
                에디터 밑에 미리보기를 별도로 보여준다 — 원문 텍스트는
                에디터 안에 그대로 남아있으니 중복 없이 미리보기만 추가.
                image/link 세그먼트가 하나라도 있으면(=이미 에디터 노드로
                떠 있음) 여기선 아무것도 안 그린다. */}
            {(() => {
              if (hasStandaloneMediaLine(bodyText)) return null;
              const legacyLink = detectFirstLink(bodyText);
              if (!legacyLink) return null;
              return (
                <LinkPreviewCard
                  url={legacyLink.url}
                  youtubeVideoId={legacyLink.youtubeVideoId}
                  isYoutubeShorts={legacyLink.isYoutubeShorts}
                  isDirectImage={legacyLink.isDirectImage}
                  isDirectVideo={legacyLink.isDirectVideo}
                  isHlsVideo={legacyLink.isHlsVideo}
                  compact
                />
              );
            })()}
          </div>
        </div>
        <div className={styles.composerFooter}>
          <div className={styles.composerActions}>
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
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={currentImageCount >= MAX_IMAGES_PER_POST}
              title="이미지 첨부"
            >
              <ImageIcon />
              <span className={styles.btnLabel}>이미지</span>
            </button>
            {/* 🔒 사용자 지시(2026-08, "글 수정일 때, 카테고리/my post는
                변경 불가능. 해당글이 my post글일때는 공개여부만 수정가능")
                — 글을 만든 뒤엔 게시판↔My Post 전환도, 카테고리 재선택도
                막는다(같은 버튼이 두 가지를 다 겸하므로 disabled 하나로
                충분). 공개범위(§ 밑 블록)는 log 글이면 여전히 토글 가능 —
                "일상/잡담"·"My Post" 자체는 회색 트랙 안에 같이 묶인
                세그먼트 컨트롤(활성 = 흰 배경+box-shadow+액센트 글자,
                비활성 = 투명 배경+연한 글자), "일상/잡담"은 선택된 상태에서
                한 번 더 누르면(새 글일 때만) 카테고리 드롭다운이 열린다. */}
            <div className={styles.destinationSegment}>
              <div className={styles.destinationMenuWrap}>
                <button
                  type="button"
                  className={destination === 'board' ? `${styles.segmentBtn} ${styles.segmentBtnActive}` : styles.segmentBtn}
                  onClick={onClickBoardToggle}
                  disabled={isEditing}
                  title={isEditing ? '수정 중에는 변경할 수 없어요' : undefined}
                  aria-haspopup="listbox"
                  aria-expanded={destination === 'board' && categoryMenuOpen}
                >
                  <PeopleIcon />
                  <span className={styles.btnLabel}>{currentCategoryName}</span>
                  <ChevronDownIcon />
                </button>
                {destination === 'board' && categoryMenuOpen && (
                  <>
                    <div className={styles.categoryMenuOverlay} onClick={() => setCategoryMenuOpen(false)} />
                    <div className={styles.categoryMenuPopover} role="listbox" aria-label="카테고리">
                      {categories.map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          role="option"
                          aria-selected={c.id === categoryId}
                          className={c.id === categoryId ? `${styles.categoryMenuItem} ${styles.categoryMenuItemActive}` : styles.categoryMenuItem}
                          onClick={() => onSelectCategory(c.id)}
                        >
                          {c.name}
                          {c.id === categoryId && <CheckIcon />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                className={destination === 'log' ? `${styles.segmentBtn} ${styles.segmentBtnActive}` : styles.segmentBtn}
                onClick={onClickLogToggle}
                disabled={isEditing}
                title={isEditing ? '수정 중에는 변경할 수 없어요' : undefined}
              >
                <LogIcon />
                <span className={styles.btnLabel}>My Post</span>
              </button>
            </div>
            {/* 🔒 사용자 지시(2026-08, "공개 부분은 커뮤니티 선택시
                전체공개만, my post가 선택된 상태에서는 전체공개/follower
                only로 선택할수 있어야해") — board 모드는 §5.2 CHECK로 항상
                전체공개라 클릭해도 아무 일이 안 일어난다(disabled), log
                모드만 클릭할 때마다 두 값 사이를 토글한다. */}
            <button
              type="button"
              className={styles.visibilityBtn}
              onClick={onClickVisibilityToggle}
              disabled={destination === 'board'}
              aria-label="공개범위"
            >
              {destination === 'log' && visibility === 'followers' ? <LogIcon /> : <GlobeIcon />}
              <span className={styles.btnLabel}>{destination === 'board' || visibility === 'public' ? '전체공개' : '팔로워 공개'}</span>
            </button>
          </div>
          <button type="submit" className={styles.submitBtn} disabled={!canSubmit}>
            {submitting ? (isEditing ? '수정 중…' : '입력 중…') : isEditing ? '수정' : '입력'}
          </button>
        </div>
        {emailNotVerified && <EmailVerifyNotice />}
      </form>
      {/* 🔒 사용자 지시(2026-08, "글쓰기 취소시 경고메세지를 띄워줘야 할것
          같아") — 입력한 내용이 있을 때만 뜬다(빈 컴포저를 닫을 땐 잃을 게
          없어 물어볼 필요가 없다). "나가기"(내용 버림)는 파괴적 액션이라
          채우지 않는다(§11.2.4) — "계속 작성"만 accent로 채워 안전한 선택을
          강조한다. */}
      {showLeaveConfirm && (
        <div className={styles.leaveConfirmOverlay} onClick={() => setShowLeaveConfirm(false)}>
          <div className={styles.leaveConfirmCard} onClick={(e) => e.stopPropagation()}>
            <p className={styles.leaveConfirmText}>작성 중인 내용이 사라져요. 계속 작성하시겠어요?</p>
            <div className={styles.leaveConfirmActions}>
              <button type="button" className={styles.leaveConfirmDiscardBtn} onClick={onClose}>
                나가기
              </button>
              <button type="button" className={styles.leaveConfirmKeepBtn} onClick={() => setShowLeaveConfirm(false)} autoFocus>
                계속 작성
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
