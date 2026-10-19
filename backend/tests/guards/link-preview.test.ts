/**
 * 링크 미리보기 SSRF 방어 — src/link-preview.ts 헤더 주석 참고. 이 사용자가
 * 준 URL로 우리 서버가 대신 요청을 보내는 구조라, 내부망·클라우드 메타데이터
 * 엔드포인트를 가리키면 안 된다.
 */
import { describe, expect, it } from 'vitest';
import { isPrivateOrLoopbackIp, isSafeUrl, fetchLinkPreview, fetchYoutubeEmbedSize } from '../../src/link-preview.ts';

describe('isPrivateOrLoopbackIp', () => {
  it('🔒 루프백은 전부 차단', () => {
    expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('127.5.5.5')).toBe(true);
    expect(isPrivateOrLoopbackIp('::1')).toBe(true);
  });

  it('🔒 사설망 대역(RFC1918) 전부 차단', () => {
    expect(isPrivateOrLoopbackIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrLoopbackIp('192.168.1.1')).toBe(true);
  });

  it('🔒 172.x대역 중 사설망 밖(172.15.x, 172.32.x)은 차단하지 않는다', () => {
    expect(isPrivateOrLoopbackIp('172.15.0.1')).toBe(false);
    expect(isPrivateOrLoopbackIp('172.32.0.1')).toBe(false);
  });

  it('🔒 링크로컬(클라우드 메타데이터 169.254.169.254 포함) 차단', () => {
    expect(isPrivateOrLoopbackIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrLoopbackIp('169.254.0.1')).toBe(true);
  });

  it('🔒 IPv6 ULA·링크로컬 차단', () => {
    expect(isPrivateOrLoopbackIp('fc00::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('fd12:3456::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('fe80::1')).toBe(true);
  });

  it('공인 IP는 통과시킨다', () => {
    expect(isPrivateOrLoopbackIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrLoopbackIp('93.184.216.34')).toBe(false);
  });
});

describe('fetchLinkPreview — 네트워크 호출 전에 걸러지는 케이스(DNS lookup 없이 즉시 판정)', () => {
  it('http/https가 아니면 null', async () => {
    expect(await fetchLinkPreview('ftp://example.com/file')).toBeNull();
    expect(await fetchLinkPreview('javascript:alert(1)')).toBeNull();
  });

  it('파싱 자체가 안 되는 문자열이면 null', async () => {
    expect(await fetchLinkPreview('그냥 텍스트')).toBeNull();
  });

  it('🔒 localhost·루프백 리터럴은 즉시 차단(SSRF)', async () => {
    expect(await fetchLinkPreview('http://localhost/admin')).toBeNull();
    expect(await fetchLinkPreview('http://127.0.0.1:6379/')).toBeNull();
    expect(await fetchLinkPreview('http://169.254.169.254/latest/meta-data/')).toBeNull();
  });
});

// 🔒 보안 점검 발견(2026-08-22) — isSafeUrl은 최초 요청과 리다이렉트 매
// 홉에 똑같이 적용되는 유일한 검증 함수다(fetchFollowingSafeRedirects가
// 매 홉마다 이 함수를 다시 통과시킨다) — 실제 네트워크 왕복 없이도 이
// 함수 하나만 검증하면 "리다이렉트가 검증을 우회하지 못한다"는 걸 보장할
// 수 있다.
describe('isSafeUrl — fetchLinkPreview의 최초 요청·리다이렉트 매 홉에 공통 적용되는 게이트', () => {
  it('http/https가 아니면 거부(스킴 우회 차단)', async () => {
    expect(await isSafeUrl(new URL('ftp://example.com/'))).toBe(false);
    expect(await isSafeUrl(new URL('file:///etc/passwd'))).toBe(false);
    expect(await isSafeUrl(new URL('gopher://example.com/'))).toBe(false);
  });

  it('🔒 리다이렉트 목적지가 내부망/루프백이면 거부 — SSRF 리다이렉트 우회 시나리오', async () => {
    expect(await isSafeUrl(new URL('http://127.0.0.1:6379/'))).toBe(false);
    expect(await isSafeUrl(new URL('http://169.254.169.254/latest/meta-data/'))).toBe(false);
    expect(await isSafeUrl(new URL('http://localhost/admin'))).toBe(false);
    expect(await isSafeUrl(new URL('http://10.0.0.5/internal'))).toBe(false);
  });

  it('공인 호스트는 통과시킨다', async () => {
    expect(await isSafeUrl(new URL('https://example.com/'))).toBe(true);
  });
});

describe('fetchYoutubeEmbedSize — 영상 실제 비율(oEmbed) 조회, 사용자 지시(2026-08, "가로/세로 규격을 찾아서 자동으로 임베드")', () => {
  it('videoId 형식이 11자 base64url이 아니면 네트워크 호출 없이 즉시 null', async () => {
    expect(await fetchYoutubeEmbedSize('short')).toBeNull();
    expect(await fetchYoutubeEmbedSize('this-is-way-too-long-for-a-video-id')).toBeNull();
    expect(await fetchYoutubeEmbedSize('has spaces!')).toBeNull();
    expect(await fetchYoutubeEmbedSize('')).toBeNull();
  });
});
