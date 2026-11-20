# TASKS

`/orchestrate`가 관리. 상태: 제안 → 승인 → 진행(N회차) → 완료(<sha>) | 넘김(사유)

| ID | 요약 | 상태 | QA | 보고서 |
|---|---|---|---|---|
| ai-social-port | reafy-ai-social을 `ai-social/`로 이식 (뼈대·테스트 통과, Reafy 전용 배포물 제외) | 완료(c461c8a) | qa | .agents/qa/ai-social-port-1.md |
| ai-social-client | `ReafyClient` → `GoodfriendsClient` (goodfriends backend 소스와 API 계약 대조) | 완료(커밋 참조) | qa | .agents/qa/ai-social-client-1.md |
| ai-social-personas | 카테고리별 페르소나 10명 (`@goodfriends.local`), 설정 기본값을 goodfriends·로컬 LLM에 맞춤 | 승인 | qa | |
| ai-social-research | `src/writer/` 주제 선정 + 소스 수집 + 본문 추출(readability) + 사실 카드 | 승인 | qa | |
| ai-social-review | 개요 → 섹션 작성 → 2중 리뷰(기계 대조 + reasoning 리뷰어) → 폐기 규칙 | 승인 | qa | |
| ai-social-images | 이미지 후보 추출·HTTP/형식/크기 검증·vision 적합성·배치·출처 표기 | 승인 | qa | |
| ai-social-integrate | 에이전트 세션의 글쓰기를 writer 파이프라인으로 교체 + 드라이런 모드 + 대시보드 초안 보기 | 승인 | qa | |
| ai-social-daemon | LaunchDaemon plist 템플릿·설치 스크립트 (`ai-social/deploy/`, 실행은 Bryan) | 승인 | qa | |

## 작업 상세

### ai-social-port
- 요구: `~/src/reafy.com/reafy-ai-social`의 `src/`, `scripts/`(sqlite 마이그레이션·rename·export·apply-enriched·scale-intervals), `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`를 `ai-social/`로 복사. 제외: `data/`, `.env`, `.github/`, `scripts/deploy/`(Reafy 오라클용), `.agents/`, `CLAUDE.md`/`AGENTS.md`/`TODOS.md`/`docs/`(요점은 `ai-social/README.md`로 새로 정리). `ai-social/.gitignore`(`node_modules/ dist/ .env data/ *.log`). 패키지명 `goodfriends-ai-social`. 이 단계에선 Reafy 클라이언트·로직을 그대로 둬도 됨(다음 작업에서 교체). 대시보드 기본 포트 3013, `127.0.0.1` 바인드. 루트 `AGENTS.md` 구조·명령 표에 `ai-social/` 추가 (`npm test`·`npm run typecheck`는 모두, `npm run dev/start`·마이그레이션 스크립트는 **에이전트 실행 금지**, `ai-social/data/`는 비밀값 취급).
- 완료: `cd ai-social && npm ci && npm test && npx tsc --noEmit` 통과(원본 테스트 수 유지), `ai-social/data/`·`.env` 미포함, `typecheck` 스크립트 존재.

### ai-social-client
- 요구: `src/client/goodfriends-client.ts` 작성, 호출부 전환, Reafy 클라이언트 삭제(이식본 내부라 git 추적 대상 — 신규 파일 교체). 계약은 `backend/src/*-http.ts`·`auth.ts`·`session.ts`·`posts.ts`·`comments.ts`·`intent-*.ts`·`feed.ts`·`categories-http.ts` 소스를 읽고 맞춘다(추측 금지): 가입(`/api/auth/signup`)·로그인·세션 검증·쿠키(`aic_session`) 또는 Bearer, 피드·카테고리 트리, 글 작성(`/api/posts`, categoryId), 글 상세·댓글 목록, 댓글·답글 작성, 공감(실제 리액션 계약), 글 삭제, 프로필 조회/수정. `ensureAuthenticated` 폴백 순서 유지. 계약 표(엔드포인트·바디·응답·에러코드·소스 위치)를 `ai-social/README.md`에 기록.
- 완료: 엔드포인트별 fetch 모킹 단위 테스트(성공·401·에러코드) 통과, Reafy 문자열/URL 잔존 없음(`grep -ri reafy ai-social/src` 결과는 주석의 출처 언급만), 기존 테스트 통과.

### ai-social-personas
- 요구: `defaults.ts`·enriched JSON을 goodfriends용으로 교체 — news 제외 10개 카테고리(qna, idea, free, frontier, local, agents, aiservice, coding, automation, creative)마다 1명, `preferredCategories`로 담당 카테고리 고정. 이메일 `<username>@goodfriends.local`, 유저네임은 reafy 교훈대로 정형 패턴 피함. 페르소나 systemPrompt: 담당 분야 실무자 말투, 사람 커뮤니티 회원처럼, **지어낸 사용 경험·벤치마크 금지**(문서·릴리스·논문을 읽고 정리하는 입장). 설정 기본값: `GOODFRIENDS_BASE_URL`(기본 `http://127.0.0.1:3011`), LLM `http://127.0.0.1:11234/v1` / `Qwen3.8-Flash-Next-oQ4e-mtp`, 글 생성 타임아웃 분 단위. `.env.example` 갱신. 비밀번호는 코드에 하드코딩하지 않고 생성(기존 generator 방식) 후 SQLite에만.
- 완료: 페르소나 10명·카테고리 1:1 매핑 테스트, 설정 기본값 테스트, 전체 테스트 통과.

### ai-social-research
- 요구: 의존성 `@mozilla/readability` + `linkedom` 추가(Bryan 위임 결정). `src/writer/sources/`: arXiv API, HN Algolia, GitHub releases(무인증), Hugging Face API, 공식 블로그 RSS — 카테고리별 매핑, robots.txt·우회 금지 원칙 유지. `topic.ts`: 후보 수집 → goodfriends 최근 글(카테고리 피드)과 제목·URL 중복 제외 → 1개 선택. `fetch-article.ts`: 원문 본문 추출(readability), 이미지 후보(본문 img·og:image) 같이 반환. `facts.ts`: 원문 3~8건에서 LLM JSON으로 사실 카드 `{claim, quote, url, publishedAt}` 추출, `quote`가 원문에 실제로 있는지 검사해 없으면 버림.
- 완료: 네트워크 없는 픽스처 기반 단위 테스트(파서·중복 제외·quote 검증·LLM 응답 파싱 실패), 전체 테스트·타입 검사 통과.

### ai-social-review
- 요구: `outline.ts`(길이·구성 결정, 섹션별 사실 카드 배정, 상한 없음), `compose.ts`(섹션 단위 생성, 페르소나 말투 + `ANTI_AI_STYLE_RULE`, 짧게 쓰기·링크 금지 규칙은 적용 안 함, 본문 끝 참고 링크 허용), `verify.ts`(a. 숫자·버전·날짜·가격·모델명 토큰 추출 → 사실 카드 원문에 존재 검사, b. reasoning 리뷰어 LLM이 문장별 근거 판정 JSON), 수정 1회 → 남으면 `discarded`(사유 기록). LLM 클라이언트에 reasoning on/off·thinking 출력 제거·긴 타임아웃 옵션 추가(mlx-serve 파라미터는 `127.0.0.1:11234`에 소규모 프로브 호출로 확인 허용, 결과는 handoff에).
- 완료: 기계 대조 단위 테스트(누락 숫자 검출·허용 케이스), 리뷰 결과 → 수정 → 폐기 흐름 테스트(LLM 모킹), 전체 테스트 통과.

### ai-social-images
- 요구: `images.ts` — 사실 카드 원문의 이미지 후보 → GET으로 200·`image/*`·최소 크기(예: 300px 또는 20KB)·핫링크 차단 검사 → vision(로컬 모델)으로 섹션 적합성 판정 → 섹션 사이에 URL 한 줄 + 다음 줄 `(이미지: 출처명)`. goodfriends 본문 렌더 규칙(`frontend/lib/link-detect.ts` 독립 URL 줄)과 맞는지 확인.
- 완료: 픽스처·모킹 테스트(차단·형식 오류·부적합 제외, 배치 형식), 전체 테스트 통과.

### ai-social-integrate
- 요구: `agent.ts`의 신규 글 경로를 writer 파이프라인으로 교체(댓글·공감·답글 흐름은 유지). `DRY_RUN=true`(기본값)면 게시하지 않고 SQLite `drafts` 테이블에 초안·사실 카드·리뷰 결과·폐기 사유 저장. 대시보드에 초안 목록/상세 보기 추가(127.0.0.1 전용). 1회 드라이런 CLI `npm run draft -- --category local`(실제 게시 없음, 로컬 LLM만 호출 — 에이전트가 실행하지 않음).
- 완료: DRY_RUN 기본값에서 게시 API가 호출되지 않음을 테스트로 검증, drafts 저장 테스트, 전체 테스트·타입 검사 통과.

### ai-social-daemon
- 요구: `ai-social/deploy/com.server.goodfriends-ai-social.plist`(LaunchDaemon, UserName=server, WorkingDirectory=ai-social, 로그 경로) 템플릿과 `install.sh`(sudo로 Bryan이 실행, 복사·load만). 에이전트는 실행 금지. 서버 setup 스크립트·install_summary 기록은 모든 작업 후 오케스트레이터가 남김.
- 완료: `plutil -lint` 통과, 스크립트 `bash -n` 통과, README에 설치·정지 절차.
