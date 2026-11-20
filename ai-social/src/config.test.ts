import { describe, it, expect } from 'vitest';
import { config } from './config.js';

describe('대시보드 서버 설정', () => {
  it('127.0.0.1에만 바인드한다', () => {
    expect(config.server.host).toBe('127.0.0.1');
  });
  it('기본 포트는 3013이다', () => {
    if (!process.env.PORT) expect(config.server.port).toBe(3013);
  });
});

describe('로컬 LLM 설정 기본값', () => {
  it('환경변수가 없으면 이 서버 로컬 엔드포인트·모델을 쓰고 키는 비어 있다', () => {
    if (!process.env.LOCAL_LLM_BASE_URL) expect(config.localLlm.baseUrl).toBe('http://127.0.0.1:11234/v1');
    if (!process.env.LOCAL_LLM_MODEL) expect(config.localLlm.model).toBe('Qwen3.8-Flash-Next-oQ4e-mtp');
    if (!process.env.LOCAL_LLM_API_KEY) expect(config.localLlm.apiKey).toBe('');
  });
  it('긴 호출 타임아웃 기본값은 600000ms다', () => {
    if (!process.env.LLM_LONG_TIMEOUT_MS) expect(config.llm.longTimeoutMs).toBe(600000);
  });
});
