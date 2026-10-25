import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => '' }),
}));

const { getSessionUserId } = await import('../../lib/session.ts');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('getSessionUserId', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the userId when the session is valid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { userId: 'u1' }));

    await expect(getSessionUserId()).resolves.toBe('u1');
  });

  // 🔒 lib/backend.ts의 다른 401(BackendError)들은 그대로 던지는데, 세션
  // 체크만 "로그인 안 함"이 정상 상태라 null로 흡수한다 — 회귀 방지용.
  test('returns null on 401 instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, { error: 'NOT_AUTHENTICATED' }));

    await expect(getSessionUserId()).resolves.toBeNull();
  });

  test('still throws for non-401 errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(500, { error: 'INTERNAL' }));

    await expect(getSessionUserId()).rejects.toThrow();
  });
});
