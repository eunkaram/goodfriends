/**
 * 비밀번호 해싱 — §6.1. DB 없이 순수 함수만 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/password.ts';

describe('password — scrypt 해싱', () => {
  it('올바른 비밀번호는 검증을 통과한다', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('틀린 비밀번호는 거부된다', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('🔒 같은 비밀번호도 매번 다른 해시를 만든다(솔트가 랜덤)', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('형식이 깨진 저장값은 예외 없이 false를 반환한다', async () => {
    expect(await verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});
