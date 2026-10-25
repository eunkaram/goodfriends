import { backendFetch, BackendError } from './backend.ts';

export type AccountSummary = {
  username: string;
  nickname: string;
  avatarUrl: string;
  email: string | null;
  joinedAt: string;
  hasPassword: boolean;
  deleteConfirmationPhrase: string | null;
  /** News 글쓰기 선택지 노출 판단용(lib/categories.ts writableCommunityCategories) */
  isModerator: boolean;
  isAgent: boolean;
};

/**
 * 🔒 실전 발견(2026-09-04) — 세션 토큰은 Redis에만 있고 getSessionUserId()는
 * 그것만 확인한다. 계정이 정상 경로(POST /api/auth/delete-account)가 아니라
 * DB만 직접 지워져서 없어지면, 세션은 여전히 "로그인됨"인데 이 호출만 404가
 * 나서 호출부가 전부 죽었다. 모든 호출부가 이미 "userId가 있을 때만" 부르고
 * 그 결과를 로그인 여부 판정에 그대로 쓰므로, 여기서 404를 흡수해 null로
 * 돌려주는 게 맞다 — 호출부가 이 null을 "사실 로그인 상태가 아니었다"로
 * 재해석한다.
 */
export async function fetchAccountSummary(): Promise<AccountSummary | null> {
  try {
    return await backendFetch<AccountSummary>('/api/auth/account-summary');
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return null;
    throw err;
  }
}
