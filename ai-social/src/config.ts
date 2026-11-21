import dotenv from 'dotenv';
dotenv.config();

function intEnv(name: string, fallback: number, min = 1): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export const config = {
  /**
   * DRY_RUN(기본 true). true면 실서버에 아무 것도 쓰지 않는다: 로그인/가입·글·댓글·공감 호출을 전부 생략하고
   * 글은 SQLite drafts에만 저장한다. 'false'로 명시했을 때만 실제 게시한다.
   */
  dryRun: process.env.DRY_RUN !== 'false',
  writer: {
    // 글 1편(주제 선정~이미지)의 전체 데드라인(ms). 초과하면 abort하고 discarded('deadline').
    deadlineMs: intEnv('WRITER_DEADLINE_MS', 40 * 60 * 1000, 1000),
    // 글 1편에서 허용하는 LLM(chat·vision) 호출 수 상한. 초과하면 abort하고 discarded('llm-limit').
    maxLlmCalls: intEnv('WRITER_MAX_LLM_CALLS', 150),
  },
  goodfriends: {
    baseUrl: process.env.GOODFRIENDS_BASE_URL || 'http://127.0.0.1:3011',
  },
  localLlm: {
    baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11234/v1',
    apiKey: process.env.LOCAL_LLM_API_KEY || '',
    model: process.env.LOCAL_LLM_MODEL || 'Qwen3.8-Flash-Next-oQ4e-mtp',
    temperature: parseFloat(process.env.LOCAL_LLM_TEMPERATURE || '0.7'),
  },
  llm: {
    // 글 생성처럼 오래 걸리는 호출용 타임아웃(ms). 사용처는 후속 작업에서 연결한다.
    longTimeoutMs: parseInt(process.env.LLM_LONG_TIMEOUT_MS || '600000', 10),
  },
  images: {
    // 글당 이미지 최대 장수(섹션당은 항상 1장)
    maxPerPost: Math.max(0, parseInt(process.env.IMAGE_MAX_PER_POST || '3', 10) || 0),
    // goodfriends 독자 브라우저가 보내는 Referer(origin). 핫링크 차단 확인에 쓴다.
    publicOrigin: process.env.GOODFRIENDS_PUBLIC_ORIGIN || 'https://goodfriends.co',
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
    // 기본 공급자. 'local'(이 서버의 로컬 OpenAI 호환 엔드포인트) 또는 'openrouter'.
    active: (process.env.LLM_PROVIDER === 'openrouter' ? 'openrouter' : 'local') as 'local' | 'openrouter',
    // active가 'local'이고 OPENROUTER_API_KEY가 설정돼 있으면, 로컬이 완전히 실패했을 때
    // OpenRouter로 자동 전환. 키가 없으면 자동으로 꺼짐(의도치 않은 과금 방지).
    fallbackToOpenRouter: process.env.LLM_FALLBACK_TO_OPENROUTER !== 'false',
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
};
