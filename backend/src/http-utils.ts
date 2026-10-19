/** http-server.ts·auth-http.ts가 공유하는 최소 유틸 — 프레임워크 없이 raw http만 쓴다(§17.1). */
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 1_000_000; // 1MB — 이 앱의 모든 폼(글·댓글·프로필)보다 넉넉하다

/**
 * 🔒 /review 발견(red-team) — 누적 길이 제한이 전혀 없었다. 이 함수는
 * 모든 *-http.ts 라우트의 공용 바디 리더라 /api/auth/signup·/api/intent처럼
 * 세션 없이도 부를 수 있는 엔드포인트가 있다 — 인증 없이도 임의로 큰
 * 바디를 스트리밍해 검증 이전에 서버가 전부 메모리에 버퍼링하게 만들 수 있었다.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * readBody()의 이진 버전 — 이미지 업로드(media-http.ts)처럼 UTF-8 텍스트가
 * 아닌 raw 바이트를 그대로 받아야 하는 라우트 전용. 상한을 호출부가
 * 지정한다(이미지는 1MB보다 훨씬 커야 하니 MAX_BODY_BYTES를 공유하지 않는다).
 */
export function readBodyBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 🔒 /review 발견(api-contract) — 쿼리스트링/바디로 받은 id를 형식 검증 없이
 * 그대로 uuid 컬럼 비교에 바인딩하면 Postgres가 22P02(invalid input syntax)를
 * 던지고, 그게 잡히지 않은 채 500 평문 응답으로 새어나갔다. 라우트 레벨에서
 * 먼저 걸러 400을 돌려주기 위한 최소 검증.
 */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * 🔒 /review 발견(red-team) — posts-http.ts/market-http.ts가 각자 손으로
 * `Math.min(Number(...), 50)`/`Math.max(Number(...), 0)`만 걸었는데, 숫자로
 * 안 변환되는 값(Number(...) === NaN)이나 limit의 하한 누락(음수 통과)이
 * 그대로 SQL LIMIT/OFFSET 바인드까지 흘러가 Postgres가 잡히지 않은 500을
 * 던졌다 — uuid에 붙인 isUuid() 가드와 같은 종류의 구멍.
 */
export function parsePageParam(raw: string | null, fallback: number, opts: { min: number; max: number }): number {
  const n = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, opts.min), opts.max);
}
