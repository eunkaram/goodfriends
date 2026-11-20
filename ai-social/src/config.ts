import dotenv from 'dotenv';
dotenv.config();

export const config = {
  goodfriends: {
    baseUrl: process.env.GOODFRIENDS_BASE_URL || 'http://127.0.0.1:3011',
  },
  localLlm: {
    baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434/v1',
    apiKey: process.env.LOCAL_LLM_API_KEY || 'ollama',
    model: process.env.LOCAL_LLM_MODEL || 'qwen2.5:14b',
    temperature: parseFloat(process.env.LOCAL_LLM_TEMPERATURE || '0.7'),
  },
  openRouter: {
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free',
    // OpenRouter 랭킹에 쓰이는 선택적 헤더 (https://openrouter.ai/docs) — 없어도 동작함
    siteUrl: process.env.OPENROUTER_SITE_URL || '',
    siteName: process.env.OPENROUTER_SITE_NAME || '',
  },
  llmProvider: {
    // 기본 공급자. 'local'(사내망 Ollama 등) 또는 'openrouter'.
    active: (process.env.LLM_PROVIDER === 'openrouter' ? 'openrouter' : 'local') as 'local' | 'openrouter',
    // active가 'local'이고 OPENROUTER_API_KEY가 설정돼 있으면, 로컬이 완전히 실패했을 때
    // OpenRouter로 자동 전환. 키가 없으면 자동으로 꺼짐(의도치 않은 과금 방지).
    fallbackToOpenRouter: process.env.LLM_FALLBACK_TO_OPENROUTER !== 'false',
  },
  search: {
    duckDuckGoEnabled: process.env.ENABLE_DUCKDUCKGO !== 'false',
    customRssFeeds: (process.env.RSS_FEEDS || '').split(',').filter(Boolean),
  },
  server: {
    // 대시보드는 인증이 없으므로 로컬 루프백에만 바인드 (환경변수로 열 수 없게 고정)
    host: '127.0.0.1',
    port: parseInt(process.env.PORT || '3013', 10),
  },
  simulation: {
    // 글로벌 틱 간격 (ms) - 각 에이전트 스케줄 점검 주기
    tickIntervalMs: parseInt(process.env.TICK_INTERVAL_MS || '30000', 10), // 30초마다 체크
    autoStart: process.env.AUTO_START !== 'false',
  },
  personas: {
    // DB가 비어있을 때(최초 부팅) 시드할 페르소나 수. 이미 시드된 DB는 영향 없음(personas 테이블
    // 비어있을 때만 동작 — PersonaRegistry.ensureSeeded 참고).
    seedCount: parseInt(process.env.PERSONA_SEED_COUNT || '100', 10),
  },
};
