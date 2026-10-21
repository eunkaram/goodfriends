import { backendFetch, BackendError } from './backend.ts';

export type EmoticonType = 'empathy' | 'cheer' | 'funny' | 'surprise' | 'sad' | 'helpful';
export type LogPostVisibility = 'public' | 'followers';

export type PostDetail = {
  id: string;
  publicId: string;
  title: string;
  body: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  /** 🔒 M4 — 뉴스봇·다이제스트봇 글을 구분하는 "AI 에디터" 배지(users.is_agent). */
  authorIsAgent: boolean;
  categoryId: string | null;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  myReaction: EmoticonType | null;
  visibility: LogPostVisibility;
  /**
   * 🔒 사용자 지시(2026-09-06, "삭제된 글이면 모더레이터가 볼 때 삭제된
   * 글이라고 표시가 되어야") — RLS가 모더레이터에게만 삭제된 전체공개 글을
   * 계속 보여준다(reafy_backend PostDetail 참고) — 일반 유저는 애초에 이
   * 응답 자체를 못 받아서(404) 이 필드가 non-null인 걸 볼 일이 없다.
   */
  deletedAt: string | null;
  /** M2 — 조회수(백엔드 GET 상세에서 Redis dedup 증가). */
  views: number;
  /** M2 — Q&A 채택된 답변 comment id. null 아니면 상세에서 "채택" 배지로 쓴다. */
  adoptedCommentId: string | null;
  /** M2 — 글이 속한 시리즈(개발 로그 연재). 있으면 상세 헤더에 노출한다. */
  series: { id: string; title: string } | null;
};

export type Comment = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl: string;
  body: string;
  createdAt: string;
  reactionCount: number;
  myReaction: boolean;
  parentCommentId: string | null;
};

export async function fetchPostWithComments(publicId: string): Promise<{ post: PostDetail; comments: Comment[] } | null> {
  try {
    return await backendFetch<{ post: PostDetail; comments: Comment[] }>(`/api/posts/${encodeURIComponent(publicId)}`);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return null;
    throw err;
  }
}
