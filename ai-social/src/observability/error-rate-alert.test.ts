import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeErrorRate, shouldAlert, sendWebhookAlert, ERROR_RATE_THRESHOLD } from './error-rate-alert.js';

describe('computeErrorRate', () => {
  it('returns 0 for an empty window', () => {
    expect(computeErrorRate([])).toBe(0);
  });

  it('computes the fraction of error entries', () => {
    expect(computeErrorRate(['error', 'error', 'browse', 'post'])).toBeCloseTo(0.5);
  });

  it('returns 0 when there are no errors', () => {
    expect(computeErrorRate(['browse', 'post', 'comment'])).toBe(0);
  });

  it('returns 1 when everything is an error', () => {
    expect(computeErrorRate(['error', 'error'])).toBe(1);
  });
});

describe('shouldAlert', () => {
  it('does not alert below the minimum sample size even at 100% error rate', () => {
    expect(shouldAlert(['error', 'error', 'error'])).toBe(false);
  });

  it('alerts when the window is large enough and error rate crosses the threshold', () => {
    const types = Array.from({ length: 10 }, (_, i) => (i < 4 ? 'error' : 'browse')); // 40%
    expect(shouldAlert(types, ERROR_RATE_THRESHOLD)).toBe(true);
  });

  it('does not alert when error rate is below threshold', () => {
    const types = Array.from({ length: 10 }, (_, i) => (i < 1 ? 'error' : 'browse')); // 10%
    expect(shouldAlert(types, ERROR_RATE_THRESHOLD)).toBe(false);
  });
});

describe('sendWebhookAlert', () => {
  const originalEnv = process.env.WEBHOOK_URL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.WEBHOOK_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WEBHOOK_URL;
    else process.env.WEBHOOK_URL = originalEnv;
    global.fetch = originalFetch;
  });

  it('is a no-op (local log only) when WEBHOOK_URL is not set', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendWebhookAlert('test message')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('posts to WEBHOOK_URL when configured', async () => {
    process.env.WEBHOOK_URL = 'https://example.com/hook';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;

    await sendWebhookAlert('test message');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('never throws even if the webhook request fails (fire-and-forget)', async () => {
    process.env.WEBHOOK_URL = 'https://example.com/hook';
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendWebhookAlert('test message')).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
