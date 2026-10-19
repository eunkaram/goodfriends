/**
 * 이슈 #8 — createSession()/clearSessionCookie()의 Domain 속성.
 * APP_BASE_URL이 서브도메인이면 상위 도메인으로 공유되게, localhost/apex/IP면
 * 기존처럼 host-only로 남게(로컬 개발 회귀 없음) 검증한다.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createSession, destroySession, clearSessionCookie } from '../../src/session.ts';
import { ownerPool } from '../../src/db.ts';

let owner: ReturnType<typeof ownerPool>;
let userId: string;
let tokensToDestroy: string[] = [];

const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL;

function setBaseUrl(url: string | undefined) {
  if (url === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = url;
}

afterEach(() => {
  setBaseUrl(ORIGINAL_APP_BASE_URL);
});

afterAll(async () => {
  await Promise.all(tokensToDestroy.map((t) => destroySession(t)));
  await owner?.query(`DELETE FROM users WHERE username = 'session_cookie_domain_test'`);
  await owner?.end();
});

describe('createSession — Domain 속성', () => {
  it('로컬(localhost)이면 Domain 속성이 없다(host-only, 회귀 없음)', async () => {
    owner ??= ownerPool();
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (username) VALUES ('session_cookie_domain_test') ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    );
    userId = u.rows[0].id;

    setBaseUrl('http://localhost:3010');
    const { token, setCookie } = await createSession(userId);
    tokensToDestroy.push(token);
    expect(setCookie).not.toContain('Domain=');
  });

  it('서브도메인(app.reafy.com)이면 상위 도메인(.reafy.com)으로 Domain을 붙인다', async () => {
    setBaseUrl('https://app.reafy.com');
    const { token, setCookie } = await createSession(userId);
    tokensToDestroy.push(token);
    expect(setCookie).toContain('; Domain=.reafy.com');
  });

  it('이미 최상위 도메인(reafy.com, 라벨 2개)이면 Domain을 안 붙인다', async () => {
    setBaseUrl('https://reafy.com');
    const { token, setCookie } = await createSession(userId);
    tokensToDestroy.push(token);
    expect(setCookie).not.toContain('Domain=');
  });

  it('IP 주소면 Domain을 안 붙인다', async () => {
    setBaseUrl('http://192.168.1.96:3010');
    const { token, setCookie } = await createSession(userId);
    tokensToDestroy.push(token);
    expect(setCookie).not.toContain('Domain=');
  });

  it('APP_BASE_URL 미설정이면(기본값 localhost) Domain을 안 붙인다', async () => {
    setBaseUrl(undefined);
    const { token, setCookie } = await createSession(userId);
    tokensToDestroy.push(token);
    expect(setCookie).not.toContain('Domain=');
  });
});

describe('clearSessionCookie — createSession과 같은 Domain 로직', () => {
  it('서브도메인이면 로그아웃 쿠키도 같은 상위 도메인을 지운다(안 그러면 새 도메인 쿠키가 안 지워짐)', () => {
    setBaseUrl('https://app.reafy.com');
    expect(clearSessionCookie()).toContain('; Domain=.reafy.com');
  });

  it('로컬이면 host-only 그대로다', () => {
    setBaseUrl('http://localhost:3010');
    expect(clearSessionCookie()).not.toContain('Domain=');
  });
});
