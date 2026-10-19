/**
 * clientIp() — §6.1 레이트리밋의 "IP 기준" 판정이 여기서 갈린다.
 * 🔒 /review 발견(testing, confidence 60) — 순수 함수인데 실제 헤더를 세팅해서
 * 부른 적이 한 번도 없었다(fetch() 호출들은 전부 X-Forwarded-For를 안 준다).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clientIp, isRateLimitExempt } from '../../src/rate-limit.ts';

describe('clientIp', () => {
  it('🔒 TRUST_PROXY_HEADERS=true일 때만 X-Forwarded-For의 마지막 IP를 신뢰한다(/review 발견) — 첫 항목은 클라이언트가 자칭 가능, 마지막이 우리 프록시가 직접 붙인 hop', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } };
    process.env.TRUST_PROXY_HEADERS = 'true';
    try {
      expect(clientIp(req)).toBe('5.6.7.8');
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  it('🔒 /cso 발견(2026-09-04) — TRUST_PROXY_HEADERS가 꺼져 있으면(기본값) X-Forwarded-For를 무시하고 소켓 IP를 쓴다 — 신뢰 가능한 프록시 없이 노출됐을 때 요청마다 다른 IP를 자칭해 레이트리밋을 우회하는 것을 막는다', () => {
    expect(process.env.TRUST_PROXY_HEADERS).toBeUndefined();
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } };
    expect(clientIp(req)).toBe('9.9.9.9');
  });

  it('헤더 없으면 socket 주소로 폴백한다', () => {
    const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' } };
    expect(clientIp(req)).toBe('9.9.9.9');
  });

  it('둘 다 없으면 unknown', () => {
    const req = { headers: {}, socket: {} };
    expect(clientIp(req)).toBe('unknown');
  });

  it('빈 문자열 헤더는 무시하고 socket으로 폴백한다', () => {
    const req = { headers: { 'x-forwarded-for': '' }, socket: { remoteAddress: '9.9.9.9' } };
    expect(clientIp(req)).toBe('9.9.9.9');
  });
});

describe('isRateLimitExempt', () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_EXEMPT_CIDRS;
  });

  it('미설정이면(기본값) 아무 IP도 예외가 아니다', () => {
    expect(isRateLimitExempt('203.0.113.10')).toBe(false);
  });

  it('정확한 IP 하나만 등록하면 그 IP만 예외', () => {
    process.env.RATE_LIMIT_EXEMPT_CIDRS = '203.0.113.10';
    expect(isRateLimitExempt('203.0.113.10')).toBe(true);
    expect(isRateLimitExempt('203.0.113.11')).toBe(false);
  });

  it('CIDR 대역 안의 IP는 전부 예외', () => {
    process.env.RATE_LIMIT_EXEMPT_CIDRS = '203.0.113.0/28';
    expect(isRateLimitExempt('203.0.113.5')).toBe(true);
    expect(isRateLimitExempt('203.0.113.15')).toBe(true);
    expect(isRateLimitExempt('203.0.113.16')).toBe(false); // 대역 밖(다음 /28)
  });

  it('콤마로 여러 항목을 섞어 등록할 수 있다', () => {
    process.env.RATE_LIMIT_EXEMPT_CIDRS = '203.0.113.10, 198.51.100.0/24';
    expect(isRateLimitExempt('203.0.113.10')).toBe(true);
    expect(isRateLimitExempt('198.51.100.200')).toBe(true);
    expect(isRateLimitExempt('192.0.2.1')).toBe(false);
  });

  // 🔒 REGRESSION — Host/Origin 헤더 값은 애초에 이 함수 입력이 아니다(IP만
  // 받는다). "agents.reafy.com"처럼 도메인 문자열이 들어오면 ipv4ToInt가
  // 파싱 실패로 null을 반환해 항상 false — 도메인 기준 우회가 구조적으로 불가능하다.
  it('🔒 IP가 아닌 문자열(도메인 등)은 예외 목록과 무관하게 항상 false', () => {
    process.env.RATE_LIMIT_EXEMPT_CIDRS = '203.0.113.10';
    expect(isRateLimitExempt('agents.reafy.com')).toBe(false);
  });

  // 🔒 REGRESSION(실전 발견, 2026-09-06) — 듀얼스택 바인딩에서 socket.remoteAddress가
  // "::ffff:127.0.0.1" 형태로 온다. 접두어를 안 벗기면 127.0.0.1을 예외로
  // 등록해도 실제 연결에서 항상 false가 나와 예외 자체가 무효화된다.
  it('🔒 IPv4-매핑 IPv6 표기(::ffff:x.x.x.x)도 같은 IPv4 주소로 인식한다', () => {
    process.env.RATE_LIMIT_EXEMPT_CIDRS = '127.0.0.1';
    expect(isRateLimitExempt('::ffff:127.0.0.1')).toBe(true);
    expect(isRateLimitExempt('::ffff:10.0.0.1')).toBe(false);
  });
});
