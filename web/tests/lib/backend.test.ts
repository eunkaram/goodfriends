import { describe, test, expect, vi, beforeEach } from 'vitest';

let mockCookieHeader = '';
vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => mockCookieHeader }),
}));

const { backendFetch, publicBackendFetch, BackendError } = await import('../../lib/backend.ts');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('backendFetch', () => {
  beforeEach(() => {
    mockCookieHeader = '';
    vi.restoreAllMocks();
  });

  test('forwards the current request cookie header', async () => {
    mockCookieHeader = 'reafy_session=abc123';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }));

    await backendFetch('/api/health');

    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Headers).get('Cookie')).toBe('reafy_session=abc123');
  });

  test('omits the Cookie header when there is no session cookie', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }));

    await backendFetch('/api/health');

    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Headers).has('Cookie')).toBe(false);
  });

  test('resolves with the parsed JSON body on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true, db: 'ok' }));

    await expect(backendFetch('/api/health')).resolves.toEqual({ ok: true, db: 'ok' });
  });

  test('sets Content-Type: application/json when a body is given and none is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await backendFetch('/api/posts', { method: 'POST', body: JSON.stringify({ title: 'x' }) });

    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  test('throws BackendError with the status and error code on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, { error: 'NOT_AUTHENTICATED' }));

    await expect(backendFetch('/api/auth/session')).rejects.toMatchObject(
      new BackendError(401, 'NOT_AUTHENTICATED'),
    );
  });

  test('falls back to UNKNOWN when a non-ok response has no parseable JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 500 }));

    await expect(backendFetch('/api/posts')).rejects.toMatchObject(new BackendError(500, 'UNKNOWN'));
  });

  test('resolves to undefined on 204 No Content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(backendFetch('/api/saved-posts')).resolves.toBeUndefined();
  });
});

describe('publicBackendFetch', () => {
  beforeEach(() => {
    mockCookieHeader = '';
    vi.restoreAllMocks();
  });

  test('does not forward a Cookie header even when one is present', async () => {
    mockCookieHeader = 'reafy_session=abc123';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { entries: [] }));

    await publicBackendFetch('/api/sitemap-data', 3600);

    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Headers | undefined)?.has('Cookie')).not.toBe(true);
  });

  test('passes the revalidate seconds to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { entries: [] }));

    await publicBackendFetch('/api/sitemap-data', 3600);

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.next).toEqual({ revalidate: 3600 });
  });

  test('throws BackendError with the status and error code on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(404, { error: 'NOT_FOUND' }));

    await expect(publicBackendFetch('/api/categories/tree', 3600)).rejects.toMatchObject(
      new BackendError(404, 'NOT_FOUND'),
    );
  });
});
