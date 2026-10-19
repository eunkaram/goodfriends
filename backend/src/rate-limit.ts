/**
 * 고정 윈도우 레이트리밋 — Redis INCR+EXPIRE. 재설정/재발송 요청 스팸
 * 방어용(§6.1 미착수 항목이었다). 이메일 존재 여부 원칙(requestPasswordReset)과
 * 충돌하지 않도록 **이메일이 아니라 IP 기준**으로만 건다 — "이 요청자가
 * 너무 자주 시도했다"는 사실은 계정 존재 여부를 누설하지 않는다.
 */
import { redis } from './redis.ts';

export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const count = await redis().incr(`ratelimit:${key}`);
  if (count === 1) {
    await redis().expire(`ratelimit:${key}`, windowSeconds);
  }
  return count <= max;
}

/**
 * 프록시(Cloudflare/Nginx, §17.1) 뒤에서는 X-Forwarded-For를 우선한다.
 *
 * 🔒 /review 발견(red-team) — 첫 번째 항목이 아니라 **마지막** 항목을 신뢰해야
 * 한다. Nginx의 표준 설정(`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`)은
 * 기존 헤더 뒤에 실제 클라이언트 IP를 append한다 — 즉 우리 프록시가 직접 붙인
 * 마지막 hop만 신뢰할 수 있고, 첫 번째 항목은 클라이언트가 요청 헤더에 마음대로
 * 적어 보낸 값이라 그대로 신뢰하면 요청마다 다른 IP를 자칭해 레이트리밋을 우회한다.
 *
 * 🔒 /cso 발견(2026-09-04, confidence 8) — 위 로직 자체는 맞지만, 실제로
 * 신뢰할 수 있는 프록시를 거쳐 왔는지 확인하는 절차가 없었다. 이 프로세스가
 * 프록시 없이 직접 노출되면(또는 배포 설정 실수) 누구나 X-Forwarded-For를
 * 요청마다 다른 값으로 보내 로그인/가입/비밀번호재설정의 IP 기준
 * 레이트리밋을 그냥 무력화할 수 있었다. 운영자가 "이 배포는 실제로 신뢰
 * 가능한 프록시 뒤에 있다"고 명시적으로 확인(TRUST_PROXY_HEADERS=true)하기
 * 전까지는 XFF를 아예 안 본다 — fail-safe 기본값은 소켓 IP.
 */
export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const hops = forwarded.split(',').map((h) => h.trim());
      return hops[hops.length - 1];
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * 신뢰하는 내부 서비스(agents.reafy.com — 에이전트 계정 자동 생성/운영)의
 * 레이트리밋 예외. Host/Origin 헤더 기준으로는 절대 예외 처리하지 않는다 —
 * 그 값들은 클라이언트가 마음대로 적어 보낼 수 있어서, 그걸로 예외를 주면
 * 공격자가 그 도메인으로 요청을 보내는 것만으로 로그인/가입 브루트포스
 * 방어 자체가 무력화된다. 대신 고정 IP 대역(CIDR)만 신뢰한다 — 이 서비스가
 * 항상 알려진 고정 IP에서만 호출한다는 전제.
 */
// 🔒 실전 발견(2026-09-06) — Node가 듀얼스택으로 바인딩되면 IPv4 연결도
// socket.remoteAddress가 "::ffff:127.0.0.1" 같은 IPv4-매핑 IPv6 표기로
// 온다. 이 접두어를 벗겨내지 않으면 실제로 127.0.0.1에서 온 연결인데도
// 파싱 실패로 예외 목록이 통째로 무효화된다.
function ipv4ToInt(rawIp: string): number | null {
  const ip = rawIp.replace(/^::ffff:/i, '');
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

// 🔒 매 호출마다 env를 다시 읽는다(모듈 스코프 캐싱 안 함) — 테스트가
// process.env.RATE_LIMIT_EXEMPT_CIDRS를 런타임에 바꿔가며 검증할 수 있어야
// 하고, 호출 빈도(signup/login) 자체가 낮아 재파싱 비용이 무의미하다.
function exemptRanges(): { network: number; mask: number }[] {
  return (process.env.RATE_LIMIT_EXEMPT_CIDRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [ipPart, prefixPart] = entry.split('/');
      const ip = ipv4ToInt(ipPart);
      if (ip === null) return [];
      const prefix = prefixPart !== undefined ? Number(prefixPart) : 32;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return [];
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return [{ network: ip & mask, mask }];
    });
}

export function isRateLimitExempt(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return exemptRanges().some(({ network, mask }) => (n & mask) === network);
}
