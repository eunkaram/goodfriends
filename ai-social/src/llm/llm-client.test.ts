import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function mockOkResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as any;
}

function mockFailResponse(status = 500) {
  return { ok: false, status, text: async () => 'boom' } as any;
}

async function freshLlmClient() {
  vi.resetModules();
  const mod = await import('./llm-client.js');
  return new mod.LlmClient();
}

describe('LlmClient provider fallback', () => {
  beforeEach(() => {
    // 실제 프로젝트 .env가 어떤 값을 갖고 있든(예: 사용자가 LLM_PROVIDER=openrouter로 바꿔둔 상태)
    // 이 테스트는 항상 격리돼야 함. dotenv.config()는 이미 process.env에 존재하는 키는
    // 덮어쓰지 않으므로, delete 대신 빈 문자열로 명시적으로 설정해 .env 값이 새어들어오는 걸 막는다.
    process.env = { ...originalEnv };
    process.env.LLM_PROVIDER = '';
    process.env.OPENROUTER_API_KEY = '';
    process.env.LLM_FALLBACK_TO_OPENROUTER = '';
    process.env.LOCAL_LLM_BASE_URL = 'http://local.test/v1';
    process.env.LOCAL_LLM_MODEL = 'local-model';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('uses only the local provider when no OpenRouter key is set (no fallback)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOkResponse('hello'));
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    const reply = await client.chat([{ role: 'user', content: 'hi' }]);

    expect(reply).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('local.test');
  });

  it('falls back to OpenRouter after local fails twice, when a key is configured', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/v1';
    process.env.OPENROUTER_MODEL = 'or-model';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFailResponse()) // local attempt 1
      .mockResolvedValueOnce(mockFailResponse()) // local attempt 2 (retry)
      .mockResolvedValueOnce(mockOkResponse('from openrouter')); // fallback
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    const reply = await client.chat([{ role: 'user', content: 'hi' }]);

    expect(reply).toBe('from openrouter');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain('openrouter.test');
  });

  it('throws the original error when local fails and no fallback is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFailResponse());
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2); // primary attempt + 1 retry, no fallback available
  });

  it('does not fall back when LLM_FALLBACK_TO_OPENROUTER=false, even with a key present', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.LLM_FALLBACK_TO_OPENROUTER = 'false';

    const fetchMock = vi.fn().mockResolvedValue(mockFailResponse());
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2); // no third (fallback) call
  });

  it('uses OpenRouter directly as primary when LLM_PROVIDER=openrouter', async () => {
    process.env.LLM_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/v1';

    const fetchMock = vi.fn().mockResolvedValue(mockOkResponse('direct openrouter'));
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    const reply = await client.chat([{ role: 'user', content: 'hi' }]);

    expect(reply).toBe('direct openrouter');
    expect(fetchMock.mock.calls[0][0]).toContain('openrouter.test');
  });
});

describe('LlmClient chat options / headers', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LLM_PROVIDER = '';
    process.env.OPENROUTER_API_KEY = '';
    process.env.LLM_FALLBACK_TO_OPENROUTER = '';
    process.env.LOCAL_LLM_BASE_URL = 'http://local.test/v1';
    process.env.LOCAL_LLM_MODEL = 'local-model';
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('omits the Authorization header when the API key is empty', async () => {
    process.env.LOCAL_LLM_API_KEY = '';
    const fetchMock = vi.fn().mockResolvedValue(mockOkResponse('ok'));
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    await client.chat([{ role: 'user', content: 'hi' }]);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends the Authorization header when an API key is set', async () => {
    process.env.LOCAL_LLM_API_KEY = 'k-test';
    const fetchMock = vi.fn().mockResolvedValue(mockOkResponse('ok'));
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    await client.chat([{ role: 'user', content: 'hi' }]);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k-test');
  });

  it('passes maxTokens through to the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOkResponse('ok'));
    global.fetch = fetchMock as any;

    const client = await freshLlmClient();
    await client.chat([{ role: 'user', content: 'hi' }], true, { maxTokens: 4096 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('honours options.timeoutMs (aborts after the given time, not the 30s default)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const e: any = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        })
    );
    global.fetch = fetchMock as any;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = await freshLlmClient();
    const p = client.chat([{ role: 'user', content: 'hi' }], false, { timeoutMs: 5000 });
    const assertion = expect(p).rejects.toThrow('timed out after 5000ms');
    await vi.advanceTimersByTimeAsync(5000); // 1st attempt aborts
    await vi.advanceTimersByTimeAsync(1000); // retry delay
    await vi.advanceTimersByTimeAsync(5000); // 2nd attempt aborts
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
