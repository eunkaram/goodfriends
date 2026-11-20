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
