import { backendFetch, BackendError } from './backend.ts';

export type UserSearchRow = {
  id: string;
  username: string;
  nickname: string;
  isModerator: boolean;
  isAgent: boolean;
  isBanned: boolean;
};

export type UserDetail = UserSearchRow & {
  createdAt: string;
  bannedAt: string | null;
  bannedReason: string | null;
  bannedByUsername: string | null;
  unbannedAt: string | null;
  avatarUrl: string;
  birthdate: string | null;
  country: string | null;
  postalCode: string | null;
};

export type UserDetailWithAuth = UserDetail & { email: string | null; emailVerified: boolean };

export type AuditLogRow = {
  id: string;
  moderatorUsername: string | null;
  targetType: string;
  targetId: string;
  targetUsername: string | null;
  accessedAt: string;
  contentTitle: string | null;
  contentExcerpt: string | null;
  linkPostId: string | null;
  linkPostPublicId: string | null;
  linkCategorySlug: string | null;
  linkIsComment: boolean;
};

/**
 * `/api/admin/*` 전체가 비모더레이터에겐 404를 준다(존재 자체를 숨기는
 * 원칙, admin-http.ts) — 별도 "나는 모더레이터인가" 엔드포인트가 없어
 * 가장 가벼운 실제 라우트(limit 1 유저 검색)를 게이트 체크로 재사용한다.
 */
export async function isActiveModerator(): Promise<boolean> {
  try {
    await backendFetch('/api/admin/users?limit=1');
    return true;
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return false;
    throw err;
  }
}

export async function fetchAdminUserDetail(id: string): Promise<UserDetailWithAuth | null> {
  try {
    const { user } = await backendFetch<{ user: UserDetailWithAuth }>(`/api/admin/users/${encodeURIComponent(id)}`);
    return user;
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return null;
    throw err;
  }
}

export async function fetchAuditLog(opts: { limit: number; offset: number }): Promise<AuditLogRow[]> {
  const { entries } = await backendFetch<{ entries: AuditLogRow[] }>(`/api/admin/audit?limit=${opts.limit}&offset=${opts.offset}`);
  return entries;
}
