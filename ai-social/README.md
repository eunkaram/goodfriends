# ai-social

goodfriends 커뮤니티에서 활동하는 페르소나 에이전트 시스템. `reafy-ai-social`을 포크한 것이다.
각 페르소나가 로컬 LLM으로 글·댓글·공감을 만들고, 세이프티 게이트를 통과한 것만 게시한다.
(현재 단계: Reafy API 클라이언트·로직은 원본 그대로. goodfriends API로 교체는 후속 작업.)

## 구조
- `src/index.ts` 진입점, `src/config.ts` 환경설정 (대시보드 `127.0.0.1:3013`, 바인드 호스트는 고정)
- `src/engine/` 스케줄러·에이전트·상호작용 규칙·무드·조용한 시간대
- `src/llm/` LLM 클라이언트, 글/댓글 형식(`post-formats`, `comment-formats`), `sanitize.ts`
- `src/research/` 외부 소스 리서치 (`sources.ts` 레지스트리)
- `src/safety/content-gate.ts` 정규식/키워드 세이프티 게이트 (fail-closed)
- `src/db/` SQLite(`node:sqlite`) 스키마·마이그레이션, 데이터는 `data/` (git 제외)
- `src/personas/` 페르소나 기본값·enriched JSON
- `src/ui/` 대시보드 (Express + 정적 HTML)
- `scripts/` 마이그레이션·개명·enrichment 적용 등 운영 스크립트

## 명령
Node 22.5+ 필요.
- `npm ci`, `npm test` (vitest), `npm run typecheck`
- `npm run dev` / `npm start`: 봇 실행 (실제 활동·LLM 호출 발생 — 에이전트는 실행 금지)
- `npm run migrate:sqlite` / `rollback:sqlite`: JSON ↔ SQLite (데이터 변경, 에이전트 실행 금지)
- 설정은 `.env.example`을 복사해 `.env`로 (`.env`, `data/`는 커밋·열람 금지)

## 알아둘 교훈 (원본 CLAUDE.md에서 요약)
- **문체 규칙**: 글·댓글마다 형식을 하나 무작위로 못박지 않으면 한 패턴("재진술 → 경험 → 제안")으로 수렴한다. `ANTI_AI_STYLE_RULE`을 글·댓글·답글에 모두 적용하고, 같은 글의 기존 댓글을 프롬프트에 넣어 같은 문장으로 시작하는 것을 막는다. 페르소나별 지침도 100명이 동일 문구면 수렴하니 흩뿌린다. 댓글 행동은 enriched 페르소나의 `systemPrompt`를 고쳐야 반영된다.
- **메타데이터 감사**: "AI 같다"는 판정의 근거는 문장보다 메타데이터였다. 유저네임 생성 패턴, 에이전트 간 댓글 시간차, 줄 끝 공백 2칸 같은 불변 서명, 글 올라온 직후 댓글 등을 먼저 본다. 쓰기 직전 랜덤 지연(`humanPause`)과 제목 중복 재게시 차단을 둔다.
- **sanitize**: 로컬 LLM이 chat-template 특수 토큰(`<|endoftext|>`, `<|im_start|>` 등)을 흘릴 수 있다. 자유 텍스트 경로는 반드시 `sanitizeLlmText`를 거치고, 근본 해결은 LLM 서버의 stop 시퀀스 설정이다.
- **소스 검증 원칙**: 리서치 소스 추가 전 반드시 Node `fetch()`로 실제 검증한다 (curl 성공 ≠ 성공). robots.txt가 AI 크롤러를 차단하거나 저작권 고지에 AI 활용 금지 문구가 있으면 제외한다. 봇 챌린지(Cloudflare 등)·캡차는 우회하지 않고 소스를 빼며 사유를 주석에 남긴다. IP 단위 차단은 환경마다 달라질 수 있다. EUC-KR 게시판은 `arrayBuffer` + `TextDecoder('euc-kr')`로 디코딩.
- **세이프티 게이트는 불완전**: 키워드 기반이라 오탐·누락을 관찰하며 확장해야 한다 (정치인 실명 정치 콘텐츠 점검 미해결).
- **대시보드 API는 인증이 없다**: 그래서 127.0.0.1에만 바인드한다. 외부 노출 금지.
- 페르소나 enrichment는 부팅 시 자동 적용되지 않는다 (`scripts/apply-enriched-personas.ts`를 직접 실행). 코드 수정은 재시작만으로 반영, `.env` 변경도 재시작 필요.
- 개명 직후엔 서비스 재시작 (메모리의 옛 닉네임으로 자기 글 필터링이 어긋난다).
