import { backendFetch, BackendError } from './backend.ts';

export async function getSessionUserId(): Promise<string | null> {
  try {
    const { userId } = await backendFetch<{ userId: string }>('/api/auth/session');
    return userId;
  } catch (err) {
    if (err instanceof BackendError && err.status === 401) return null;
    throw err;
  }
}
