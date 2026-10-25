'use client';

import { useRouter } from 'next/navigation';
import { useComposerModal } from './composer-modal-context.tsx';
import { PostComposerModal } from './PostComposerModal.tsx';
import type { Category } from '../lib/categories.ts';

/**
 * 🔒 사용자 지시(2026-08, "모든페이지에서 new post버튼이 활성화 되어야해.
 * 커뮤니티 메뉴가 아닌 다른곳에서 new post를 클릭할 경우 기본적으로
 * 마이로그에 글을쓰는것으로 간주하고 작업 해줘") — 원래는 포스트 상세
 * 페이지 전용(당시 이름 `PostDetailComposer`)이었는데, Profile/Messages/
 * Saved/Posts/정적 페이지(소개·광고·약관·개인정보·HELP)는 전부
 * `ComposerModalProvider`만 있고 `PostComposerModal`을 실제로 렌더링하는
 * 컴포넌트가 아무 데도 없어서 좌 사이드바 "New Post"를 눌러도 `isOpen`만
 * true가 되고 화면엔 아무 일도 안 일어났다 — 이름을 일반화하고 그 6개
 * 페이지에도 그대로 재사용한다.
 *
 * `HomeFeed`·`CategoryFeed`는 자기 자신이 피드 목록을 들고 있어
 * `PostComposerModal`을 직접 렌더링하지만(방금 만든 글을 목록 맨 위에
 * 낙관적으로 끼워 넣어야 해서), 나머지 페이지엔 그렇게 끼워 넣을 피드
 * 목록이 없다(있어도 새 글이 그 목록에 안 속하는 경우가 대부분 —
 * Messages/Saved/정적 페이지는 애초에 글 목록이 아니고, Profile/Posts는
 * 남의 프로필일 수도 있다) — 그래서 이 얇은 래퍼가 모달만 띄우고, 글이
 * 만들어지면 그 새 글의 상세 페이지로 이동한다. `defaultCategoryId`를
 * 안 주면(이 6개 페이지 전부 안 준다) `PostComposerModal`의 기존
 * 스마트 디폴트 로직이 자동으로 'log'(My Post)를 고른다 — 이 컴포넌트가
 * 따로 분기할 필요가 없다.
 */
export function NewPostComposer({
  isLoggedIn,
  categories,
  defaultCategoryId,
  authorId,
  authorUsername,
  authorNickname,
  authorAvatarUrl,
}: {
  isLoggedIn: boolean;
  categories: Category[];
  defaultCategoryId?: string;
  authorId?: string;
  authorUsername: string;
  authorNickname: string;
  /** 🔒 사용자 발견(2026-08, "글쓰기, 글 수정 팝업에 내 아바타가 표시가
   * 안돼") — 글쓰기 모달 아바타 실제 사진용, 없으면 이니셜로 폴백. */
  authorAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const { isOpen, close } = useComposerModal();

  if (!isLoggedIn || !isOpen) return null;

  return (
    <PostComposerModal
      categories={categories}
      defaultCategoryId={defaultCategoryId}
      authorId={authorId ?? ''}
      authorUsername={authorUsername}
      authorNickname={authorNickname}
      authorAvatarUrl={authorAvatarUrl}
      onCreated={(post) => {
        close();
        router.push(`/${post.categorySlug}/${post.publicId}`);
      }}
      onClose={close}
    />
  );
}
