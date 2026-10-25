import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => '' }),
}));

const { fetchAccountSummary } = await import('../../lib/account.ts');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchAccountSummary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the account on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { username: 'chk', nickname: '닉네임' }));

    await expect(fetchAccountSummary()).resolves.toMatchObject({ username: 'chk' });
  });

  // 🔒 실전 발견(2026-09-04) — 세션은 Redis에만 있고 계정은 Postgres에 있다.
  // 계정이 정상 경로가 아니라 DB만 직접 지워지면 세션은 여전히 유효한데
  // 이 호출만 404가 난다 — 호출부(app/page.tsx 등)가 전부 "userId가 있으면
  // 계정도 있다"고 가정해서 크래시했다. 404는 null로 흡수해야 한다.
  test('returns null on 404 instead of throwing (stale session, account deleted from DB)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(404, { error: 'NOT_FOUND' }));

    await expect(fetchAccountSummary()).resolves.toBeNull();
  });

  test('still throws for non-404 errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(500, { error: 'INTERNAL' }));

    await expect(fetchAccountSummary()).rejects.toThrow();
  });
});
