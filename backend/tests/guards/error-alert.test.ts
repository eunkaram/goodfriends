/**
 * 서버 에러 관리자 알림 — src/error-alert.ts. 실제 SMTP 발송 없이
 * sendEmail 호출 여부·인자·레이트리밋만 검증한다(email.ts 자체의 SMTP
 * 로직은 §17.3 "미해결 숙제"라 별도 검증 대상 아님, auth.test.ts와 같은 패턴).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/email.ts', () => ({ sendEmail: sendEmailMock }));

import { alertAdminOfError } from '../../src/error-alert.ts';
import { redis } from '../../src/redis.ts';

describe('alertAdminOfError', () => {
  let savedEnv: string | undefined;

  beforeEach(async () => {
    savedEnv = process.env.ADMIN_ALERT_EMAIL;
    sendEmailMock.mockClear();
    sendEmailMock.mockResolvedValue(undefined);
    await redis().del('ratelimit:admin-error-alert');
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.ADMIN_ALERT_EMAIL;
    else process.env.ADMIN_ALERT_EMAIL = savedEnv;
    await redis().del('ratelimit:admin-error-alert');
  });

  it('ADMIN_ALERT_EMAIL이 없으면 sendEmail을 호출하지 않는다', async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    await alertAdminOfError(new Error('boom'), '/api/test');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('ADMIN_ALERT_EMAIL이 있으면 sendEmail을 호출하고 경로·에러 메시지를 담는다', async () => {
    process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
    await alertAdminOfError(new Error('boom'), '/api/test');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('admin@example.com');
    expect(call.subject).toContain('/api/test');
    expect(call.text).toContain('boom');
  });

  it('🔒 같은 5분 윈도우 안에서는 두 번째 호출을 억제한다(로그 폭주 방지)', async () => {
    process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
    await alertAdminOfError(new Error('first'), '/api/a');
    await alertAdminOfError(new Error('second'), '/api/b');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('sendEmail이 던져도 alertAdminOfError 자체는 안 던진다(호출부를 막지 않는다)', async () => {
    process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'));
    await expect(alertAdminOfError(new Error('boom'), '/api/test')).resolves.toBeUndefined();
  });
});
