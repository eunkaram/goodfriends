/**
 * 비밀번호 해싱 — §6.1
 *
 * Node 내장 scrypt만 쓴다(새 의존성 없음 — 이 프로젝트의 "필요할 때만 추가"
 * 원칙과 같은 이유로 bcrypt/argon2 패키지를 넣지 않았다). scrypt는 OWASP가
 * bcrypt와 함께 권장하는 알고리즘이고, Node 표준 라이브러리에 이미 있다.
 *
 * 저장 형식: `scrypt$<salt-hex>$<hash-hex>` — 알고리즘 접두어를 둬서 나중에
 * 다른 알고리즘으로 옮길 때 기존 해시를 구분할 수 있게 한다.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  // 🔒 길이가 다르면 timingSafeEqual이 예외를 던진다 — 형식이 깨진 해시는 항상 거부한다.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
