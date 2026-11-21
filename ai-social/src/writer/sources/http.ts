/**
 * 소스 모듈 공용 HTTP 클라이언트. 정직한 UA(봇임을 밝힘), 타임아웃, 호스트별 최소 간격,
 * 짧은 메모리 캐시(같은 URL을 반복 호출해 무인증 GitHub 레이트리밋 60/h를 낭비하지 않기 위함).
 * 브라우저 UA 위장·봇 차단 우회는 하지 않는다 — 막히면(403/429 등) 그냥 실패로 처리한다.
 */

export const WRITER_USER_AGENT = 'goodfriends-ai-social/1.0 (community research bot; reads public feeds/APIs)';
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  /** 호스트별 요청 사이 최소 간격(ms). arXiv API는 3초 권고. */
  hostMinGapMs?: Record<string, number>;
  cacheTtlMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_HOST_MIN_GAP_MS: Record<string, number> = {
  'export.arxiv.org': 3000,
  'arxiv.org': 15000, // robots.txt Crawl-delay
};

export class HttpClient {
  private fetchImpl: FetchImpl;
  readonly timeoutMs: number;
  private hostMinGapMs: Record<string, number>;
  private cacheTtlMs: number;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private lastRequestAt = new Map<string, number>();
  private cache = new Map<string, { at: number; value: string }>();

  constructor(opts: HttpClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.hostMinGapMs = opts.hostMinGapMs ?? DEFAULT_HOST_MIN_GAP_MS;
    this.cacheTtlMs = opts.cacheTtlMs ?? 15 * 60 * 1000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  private async throttle(url: string): Promise<void> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    const gap = this.hostMinGapMs[host];
    if (!gap) return;
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + gap - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt.set(host, this.now());
  }

  /** 원시 응답(타임아웃·UA 적용). 호출자가 상태 코드·바이트를 직접 다룬다. */
  async request(url: string, headers: Record<string, string> = {}): Promise<Response> {
    await this.throttle(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: { 'User-Agent': WRITER_USER_AGENT, ...headers },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET → 텍스트. 2xx가 아니면 예외. 짧은 TTL 캐시. */
  async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.cacheTtlMs) return hit.value;
    const res = await this.request(url, headers);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const value = await res.text();
    this.cache.set(url, { at: this.now(), value });
    return value;
  }

  async getJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const text = await this.getText(url, { Accept: 'application/json', ...headers });
    return JSON.parse(text) as T;
  }
}
