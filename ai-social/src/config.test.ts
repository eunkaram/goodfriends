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

describe('드라이런·writer 한도 기본값', () => {
  it('DRY_RUN은 기본 true(환경변수가 정확히 false일 때만 꺼진다)', () => {
    if (process.env.DRY_RUN !== 'false') expect(config.dryRun).toBe(true);
  });
  it('writer 데드라인 기본 40분, LLM 호출 상한 기본 150', () => {
    if (!process.env.WRITER_DEADLINE_MS) expect(config.writer.deadlineMs).toBe(40 * 60 * 1000);
    if (!process.env.WRITER_MAX_LLM_CALLS) expect(config.writer.maxLlmCalls).toBe(150);
  });
});
