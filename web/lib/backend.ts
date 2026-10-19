import { cookies } from 'next/headers';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3010';

export class BackendError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function backendFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: init.cache ?? 'no-store',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'UNKNOWN' }));
    throw new BackendError(res.status, data.error ?? 'UNKNOWN');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * 로그인 여부와 무관한 공개 데이터 전용(sitemap.ts, llms.txt 등) — 쿠키를
 * 안 실어보내고 revalidate로 캐시 가능하게 한다. backendFetch는 매 호출
 * cookies()를 읽어 라우트를 강제로 dynamic 처리하므로(Next 16 "이전 모델"
 * 기준) revalidate가 먹지 않는다.
 */
export async function publicBackendFetch<T>(path: string, revalidateSeconds: number): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { next: { revalidate: revalidateSeconds } });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'UNKNOWN' }));
    throw new BackendError(res.status, data.error ?? 'UNKNOWN');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
