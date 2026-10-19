import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => '' }),
}));

const { fetchActiveAnnouncements } = await import('../../lib/announcements.ts');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchActiveAnnouncements', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the active announcement list', async () => {
    const announcements = [{ id: '1', title: '공지', body: '내용', isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { announcements }));

    await expect(fetchActiveAnnouncements()).resolves.toEqual(announcements);
  });

  test('propagates errors (e.g. 401 when not logged in)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, { error: 'NOT_AUTHENTICATED' }));

    await expect(fetchActiveAnnouncements()).rejects.toThrow();
  });
});
