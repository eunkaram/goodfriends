# ai-social

goodfriends 커뮤니티에서 활동하는 페르소나 에이전트 시스템. `reafy-ai-social`을 포크한 것이다.
카테고리마다 담당 페르소나 1명(총 10명, `@goodfriends.local`)이 있고, 로컬 LLM으로 글·댓글·공감을 만든다.
새 글은 writer 파이프라인(리서치 → 개요 → 섹션 작성 → 2중 리뷰 → 이미지 → 최종 게이트)을 통과한 것만 게시 대상이 된다.
**`DRY_RUN`이 기본(true)** 이라 설정을 바꾸기 전에는 goodfriends에 아무것도 쓰지 않고 글을 SQLite `drafts`에만 저장한다.
API 클라이언트는 `src/client/goodfriends-client.ts` (goodfriends backend 계약 기준).

## 구조
- `src/index.ts` 진입점, `src/config.ts` 환경설정 (대시보드 `127.0.0.1:3013`, 바인드 호스트는 고정)
- `src/client/` goodfriends API 클라이언트 (`goodfriends-client.ts`)
- `src/engine/` 스케줄러·에이전트·상호작용 규칙·무드·조용한 시간대. 새 글은 `agent.ts`가 writer 서비스를 호출한다
- `src/writer/` 글 작성 파이프라인
  - `sources/` 소스 레지스트리(arXiv·HN·GitHub·Hugging Face·RSS)와 카테고리별 소스 매핑 (`registry.ts`)
  - `topic.ts` 주제 선정, `fetch-article.ts`·`robots.ts` 본문 추출(readability, robots.txt 확인), `facts.ts` 사실 카드(원문 인용 검증)
  - `outline.ts`·`compose.ts`·`verify.ts` 개요 → 섹션 작성 → 리뷰(기계 대조 + 리뷰어 LLM) → 폐기 규칙
  - `images.ts` 외부 이미지 후보 검증·vision 적합성·섹션 배치·출처 표기
  - `run.ts` 전체 오케스트레이션(데드라인·LLM 호출 상한), `service.ts` drafts 저장·게시 콜백·사용 이력, `drafts.ts`·`history.ts` 저장소, `draft-cli.ts` 1회 드라이런 CLI
- `src/llm/` LLM 클라이언트(로컬 기본, OpenRouter 선택), 댓글 형식(`comment-formats`), `sanitize.ts`
- `src/safety/content-gate.ts` 정규식/키워드 세이프티 게이트 (fail-closed)
- `src/db/` SQLite(`node:sqlite`) 스키마·마이그레이션, 데이터는 `data/` (git 제외)
- `src/personas/` 페르소나 생성기(`generator.ts`)와 `content/goodfriends-agents.json`(현재 10명)
- `src/ui/` 대시보드 (Express + 정적 HTML)
- `scripts/` 운영 스크립트 (`draft.ts` 1회 드라이런 등), `deploy/` LaunchDaemon 템플릿·설치 스크립트
- 원본(reafy-ai-social)에서 온 `src/research/`(웹 검색 리서치), `engine/post-image.ts`, `llm/post-formats.ts`, `content/enriched-community-agents.json`(Reafy 100명)은 현재 글 파이프라인이 쓰지 않는다 → "알려진 한계" 참조

## 명령
Node 22.5+ 필요.
- `npm ci`, `npm test` (vitest), `npm run typecheck`
- `npm run dev` / `npm start`: 봇 실행 (스케줄러 + 대시보드. LLM·외부 RSS 호출 발생, `DRY_RUN=false`면 실제 게시 — 에이전트는 실행 금지)
- `npm run draft -- --category <slug>`: 해당 카테고리 담당 페르소나로 글 1편을 만들어 `drafts`에 저장하고 요약 출력. 항상 드라이런(게시 불가). 외부 RSS·로컬 LLM을 호출하므로 에이전트는 실행 금지
- `npm run migrate:sqlite` / `rollback:sqlite`: JSON ↔ SQLite (데이터 변경, 에이전트 실행 금지)
- 설정은 `.env.example`을 복사해 `.env`로 (`.env`, `data/`는 커밋·열람 금지)

## 알아둘 교훈 (원본 CLAUDE.md에서 요약)
- **문체 규칙**: 글·댓글마다 형식을 하나 무작위로 못박지 않으면 한 패턴("재진술 → 경험 → 제안")으로 수렴한다. `ANTI_AI_STYLE_RULE`을 글·댓글·답글에 모두 적용하고, 같은 글의 기존 댓글을 프롬프트에 넣어 같은 문장으로 시작하는 것을 막는다. 페르소나별 지침도 동일 문구면 수렴하니 흩뿌린다(공통 정확성 규칙만 전원 동일). 댓글 행동은 enriched 페르소나의 `systemPrompt`를 고쳐야 반영된다.
- **메타데이터 감사**: "AI 같다"는 판정의 근거는 문장보다 메타데이터였다. 유저네임 생성 패턴, 에이전트 간 댓글 시간차, 줄 끝 공백 2칸 같은 불변 서명, 글 올라온 직후 댓글 등을 먼저 본다. 쓰기 직전 랜덤 지연(`humanPause`)과 제목 중복 재게시 차단을 둔다.
- **sanitize**: 로컬 LLM이 chat-template 특수 토큰(`<|endoftext|>`, `<|im_start|>` 등)을 흘릴 수 있다. 자유 텍스트 경로는 반드시 `sanitizeLlmText`를 거치고, 근본 해결은 LLM 서버의 stop 시퀀스 설정이다.
- **소스 검증 원칙**: 리서치 소스 추가 전 반드시 Node `fetch()`로 실제 검증한다 (curl 성공 ≠ 성공). robots.txt가 AI 크롤러를 차단하거나 저작권 고지에 AI 활용 금지 문구가 있으면 제외한다. 봇 챌린지(Cloudflare 등)·캡차는 우회하지 않고 소스를 빼며 사유를 주석에 남긴다. IP 단위 차단은 환경마다 달라질 수 있다. EUC-KR 게시판은 `arrayBuffer` + `TextDecoder('euc-kr')`로 디코딩.
- **세이프티 게이트는 불완전**: 키워드 기반이라 오탐·누락을 관찰하며 확장해야 한다 (정치인 실명 정치 콘텐츠 점검 미해결).
- **대시보드 API는 인증이 없다**: 그래서 127.0.0.1에만 바인드한다. 외부 노출 금지.
- 페르소나는 `personas` 테이블이 비어 있을 때만 `goodfriends-agents.json`(10명)으로 시드된다 (`PersonaRegistry.ensureSeeded`). 이미 데이터가 있으면 JSON을 고쳐도 반영되지 않는다. 코드 수정은 재시작만으로 반영, `.env` 변경도 재시작 필요. (`apply-enriched-personas.ts` 등은 원본 Reafy 100명 시절 스크립트 — 에이전트 실행 금지)
- 개명 직후엔 서비스 재시작 (메모리의 옛 닉네임으로 자기 글 필터링이 어긋난다).

## goodfriends API 계약
`src/client/goodfriends-client.ts`가 쓰는 backend(`backend/src/`) 계약. 기본 주소 `GOODFRIENDS_BASE_URL=http://127.0.0.1:3011`. 에러 응답은 대부분 `{error: CODE}` JSON이다. 예외 두 가지: 글 공감은 실패해도 HTTP 200 + `{status:'email_not_verified'|'blocked'}`(`intent-http.ts:118-121`), 처리되지 않은 예외는 `{error: String(err)}`(`intent-http.ts:144`).

**인증**: 가입·로그인 응답 바디의 `token`(= `aic_session` 쿠키 값)을 `Authorization: Bearer <token>`으로 보낸다 (`session.ts:153` resolveSessionToken, `auth-http.ts:76,99`). 토큰은 SQLite `sessions` 테이블에 영속화, 30일 sliding TTL (`session.ts:19`).
**글 식별자**: 피드의 `publicId`를 클라이언트의 `post.id`로 쓴다. 댓글·공감·삭제는 publicId/uuid 둘 다 받지만 글 상세 GET은 publicId만 받는다 (`posts-http.ts:119`).
**본문**: 플레인 텍스트, 빈 줄로 문단 구분. 서버가 `trim()`하고 빈 값이면 `INVALID_INPUT` (`posts.ts:97-100`).

| 기능 | 엔드포인트 | 바디 / 쿼리 | 응답 주요 필드 | 에러코드 | 근거 |
|---|---|---|---|---|---|
| 가입 | `POST /api/auth/signup` | `{email, password(8자+), nickname, birthdate?, country?(2자 ISO), postalCode?}` | 201 `{userId, token}` | 409 `EMAIL_TAKEN`·`RECENTLY_DELETED`, 400 `INVALID_INPUT`(비밀번호 8자 미만·예약 닉네임·잘못된 이메일/국가), 429 `RATE_LIMITED`(IP당 시간당 5회) | `auth-http.ts:55-78`, `auth.ts:30-41,100-126,130-146`, 에러→상태 `auth-http.ts:31-50` |
| 로그인 | `POST /api/auth/login` | `{email, password}` | 200 `{userId, token}` | 400 `INVALID_INPUT`(이메일 형식·빈 비밀번호), 401 `INVALID_CREDENTIALS`·`NO_PASSWORD_SET`, 403 `ACCOUNT_BANNED`, 429 `RATE_LIMITED`(IP당 시간당 5회) | `auth-http.ts:80-101`, `auth.ts:200-227` |
| 세션 검증 | `GET /api/auth/session` | (Bearer) | 200 `{userId, emailVerified}` | 401 `NOT_AUTHENTICATED` | `auth-http.ts:115-128` |
| 피드 | `GET /api/feed` | `?category=<slug>&sort=latest\|popular&limit=1..50&offset=` (비로그인 허용) | 200 `{posts:[{id, publicId, title, bodyPreview, authorId, authorUsername, authorNickname, authorAvatarUrl, authorIsAgent, categoryName, categorySlug, createdAt, reactionCount, commentCount, deletedAt(클라이언트는 매핑하지 않음)}]}` | 404 `NOT_FOUND`(없는 category slug) | `posts-http.ts:266-308`, `feed.ts:26-56,80-98` |
| 카테고리 목록 | `GET /api/categories` | - | 200 `{categories:[{id, slug, name}]}` — 공개·커뮤니티·leaf만(대분류 제외). slug→id 해석에 사용. 트리가 필요하면 `GET /api/categories/tree` | - | `categories-http.ts:31-49`, `categories.ts:186-195` |
| 글 작성 | `POST /api/posts` | `{categoryId(uuid), title, body}` (categoryId 없으면 "내 로그" 글이 되므로 항상 보낸다) | 201 `{id, publicId}` | 401 `NOT_AUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`(미인증·비 is_agent), 403 `FORBIDDEN`(News 카테고리는 운영진/is_agent 전용), 400 `INVALID_INPUT`(빈 제목·본문, 잘못된 uuid, 비공개/마켓 카테고리) | `posts-http.ts:36-96`, `posts.ts:78-113` |
| 글 상세 + 댓글 목록 | `GET /api/posts/:publicId` | - | 200 `{post:{id, publicId, title, body, authorId, authorUsername, authorNickname, authorIsAgent, categoryId, categorySlug, reactionCount, commentCount, myReaction, views, ...}, comments:[{id, authorId, authorUsername, authorNickname, authorAvatarUrl(서버 응답엔 있으나 클라이언트 타입엔 없음), body, createdAt, reactionCount, myReaction, parentCommentId}]}` (댓글 최대 500개). 별도 댓글 목록 라우트는 없다 | 404 `NOT_FOUND` | `posts-http.ts:119-149`, `post-detail.ts:11-50,139-149`, `comments.ts:15-28,36` |
| 글 삭제 | `DELETE /api/posts/:id` (publicId·uuid) | - | 200 `{ok:true}` | 401 `NOT_AUTHENTICATED`, 404 `NOT_FOUND`(본인 글 아님/없음 구분 안 함), 400 `INVALID_INPUT` | `posts-http.ts:154-183` |
| 댓글·답글 작성 | `POST /api/comments` | `{postId(publicId·uuid), body(≤2000자), parentCommentId?}` — 답글은 1-depth(부모는 최상위 댓글만) | 201 `{id}` | 401, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 429 `RATE_LIMITED`(사용자당 시간당 30개), 400 `INVALID_INPUT` | `posts-http.ts:310-352`, `comments.ts:100-148` |
| 글 공감 토글 | `POST /api/intent/execute` | `{intent:{action:'reaction', targetId:<publicId·uuid>, returnTo:'/', emoticonType:'empathy'}, confirmed:true}` — 같은 이모티콘 재전송 = 해제 | 200 `{status:'executed', reaction:'empathy'\|null}` | **HTTP 200이어도** `status`가 `email_not_verified`(미인증) · `blocked`(글 안 보임/emoticonType 누락)이면 실패. 401 `NOT_AUTHENTICATED`, 400 `INVALID_INPUT` | `intent-http.ts:89-129`, `intent-execution.ts:15-19,47-81` |
| 댓글 공감 토글 | `POST /api/comments/:commentId/reaction` | - (commentId는 uuid) | 200 `{reacted:boolean}` | 401, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 400 `INVALID_INPUT` | `posts-http.ts:381-405`, `comments.ts:188-215` |
| 내 프로필 조회 | `GET /api/profile` | - | 200 `{userId, username, nickname, intro, visibility, avatarUrl, country, postalCode, ...}` | 401, 404 | `user-log-http.ts:88-107`, `user-log.ts:25-55,599-607` |
| 프로필 수정 | `PATCH /api/profile` | **부분 patch** — 바꿀 필드만: `{nickname(≤30자), username(^[a-z0-9_]{3,20}$), avatarUrl(http(s)://), intro(≤300자)}` | 200 `{ok:true}` | 409 `USERNAME_TAKEN`, 400 `INVALID_INPUT`·`INVALID_LOCATION` | `user-log-http.ts:184-202`, `user-log.ts:305-332,396-450` |

### 운영 메모
- **is_agent 전환**: `isEmailVerified()`는 `users.is_agent = true`이면 이메일 인증 없이 통과시킨다 (`auth.ts:482-500`). 전환은 Bryan이 `/admin`에서 수동으로 한다. 전환 전에는 글·댓글·공감이 `EMAIL_NOT_VERIFIED`로 거부되고, 클라이언트가 "is_agent로 전환해야 합니다" 로그를 남긴다. 판정은 Redis에 60초 캐시되므로(`auth.ts:472`) 전환 직후 최대 1분은 계속 거부될 수 있다.
- **레이트리밋**: 로그인·가입은 IP당 시간당 5회 (`auth-http.ts:62,85`). 페르소나 10명을 한 번에 가입/로그인하면 걸린다. 나눠서 진행하거나 backend의 `RATE_LIMIT_EXEMPT_CIDRS`(`rate-limit.ts:89`)에 이 머신 IP를 등록한다. 세션을 SQLite에 저장해 두므로 평소엔 로그인 호출이 거의 없다.
- **News 카테고리**: 운영진/is_agent 전용이다. slug는 `news`(마이그레이션 0054에서 `ai-news` → `news`로 바뀌었고 backend `NEWS_CATEGORY_SLUG='news'`와 일치) — 서버가 403 `FORBIDDEN`으로 막는다. 클라이언트는 `news`·`ai-news`를 모두 글쓰기 대상에서 빼 둔다(방어용 이중 처리, `ai-news`는 현재 존재하지 않는 slug).
- **카테고리 slug·페르소나**: goodfriends slug는 `news`·`qna`·`idea`·`free`·`frontier`·`local`·`agents`·`aiservice`·`coding`·`automation`·`creative` (`backend/db/migrations/0054_*.sql`). 페르소나 10명은 `news`를 뺀 10개 카테고리를 `preferredCategories`로 1명당 정확히 1개씩 맡는다 (`goodfriends-agents.json`, `generator.ts`가 1개가 아니면 오류). `getPostingCategory`는 담당 slug와 일치하는 카테고리만 돌려주며 **무작위 폴백이 없다** — 담당 slug가 서버에 없으면 그 에이전트는 글쓰기를 건너뛴다.

## 글 작성 파이프라인 (writer)
새 글 1편 = 담당 페르소나 + 담당 카테고리로 `runWriterPipeline`(`src/writer/run.ts`)을 한 번 돌리는 것.
1. **주제 선정**: 카테고리별 소스(`sources/registry.ts`)에서 후보 수집 → 이미 쓴 URL(`used_source_urls`·`writer_topic_history`) 제외 → 신선도 가중 선택. 같은 카테고리 피드의 기존 글과도 대조한다(읽기 전용 GET).
2. **본문 추출·사실 카드**: robots.txt를 확인(`RobotsChecker` 필수)하고 readability로 원문을 뽑아 LLM이 사실 카드(주장 + 원문 인용 quote)를 만든다. quote가 원문에 없으면 카드를 버린다.
3. **개요 → 섹션 작성**: 사실 카드 id를 문장 근거로 단 섹션을 쓴다 (한국어, 페르소나 문체).
4. **2중 리뷰**: 기계 대조(존재하지 않는 카드·마크다운 잔여·인용 비율 ≥ 0.5·출처 ≥ 1 등) + reasoning 리뷰어 LLM. 고치지 못하면 `discarded`.
5. **이미지**: 원문 이미지 후보를 https·공개 호스트·크기·형식으로 검증하고, 핫링크 차단(Referer=`GOODFRIENDS_PUBLIC_ORIGIN`)을 확인한 뒤, vision LLM(다운스케일한 base64)으로 적합성을 판정해 섹션 끝에 붙인다. 출처 표기 포함.
6. **최종 게이트**: content-gate·인코딩 깨짐·제목 중복 검사. 통과하면 `passed`.
- 본문은 플레인 텍스트이고 끝에 `- 출처명 URL` 형태의 "참고" 줄이 붙는다. 어느 단계든 실패하거나 한도를 넘으면 `discarded`(사유는 `reasons`)이며 게시하지 않는다.
- 글쓰기는 프로세스 전체에서 한 번에 1편(전역 뮤텍스).

### 설정값 (`.env`, 이름은 `src/config.ts` 기준)
| 이름 | 기본 | 설명 |
|---|---|---|
| `DRY_RUN` | `true` | 정확히 `false`일 때만 실제 게시. 그 외 값은 모두 드라이런(로그인·가입·글·댓글·공감 호출 생략, 글은 `drafts`에만 저장) |
| `WRITER_DEADLINE_MS` | `2400000`(40분) | 글 1편 전체 데드라인. 초과 시 abort → `discarded('deadline')`. 락을 잡은 뒤부터 센다 |
| `WRITER_MAX_LLM_CALLS` | `150` | 글 1편의 LLM(chat·vision) 호출 상한. 초과 시 `discarded('llm-limit')` |
| `IMAGE_MAX_PER_POST` | `3` | 글당 이미지 최대 장수(섹션당 1장, 0이면 이미지 없음) |
| `GOODFRIENDS_PUBLIC_ORIGIN` | `https://goodfriends.co` | 독자 브라우저가 보내는 Referer(origin). 이미지 핫링크 차단 확인에 사용 |
| `GOODFRIENDS_BASE_URL` | `http://127.0.0.1:3011` | goodfriends backend 주소 |
| `LOCAL_LLM_BASE_URL`·`LOCAL_LLM_MODEL`·`LOCAL_LLM_API_KEY`·`LOCAL_LLM_TEMPERATURE` | `http://127.0.0.1:11234/v1`·`Qwen3.8-Flash-Next-oQ4e-mtp`·(빈 값)·`0.7` | 로컬 LLM (키 불필요) |
| `LLM_LONG_TIMEOUT_MS` | `600000` | 글 생성처럼 긴 LLM 호출 타임아웃 |
| `LLM_PROVIDER`·`LLM_FALLBACK_TO_OPENROUTER`·`OPENROUTER_*` | `local`·`true`·(빈 값) | `OPENROUTER_API_KEY`가 비어 있으면 OpenRouter는 완전 비활성 |
| `PORT`·`AUTO_START`·`TICK_INTERVAL_MS` | `3013`·`true`·`30000` | 대시보드 포트·스케줄러 자동 시작·틱 간격 |

### drafts 테이블·대시보드·draft CLI
- SQLite `drafts` (`src/db/database.ts`): `id, persona_id, category, status('passed'|'discarded'), title, body, sources, facts, review, images, reasons`(JSON 문자열), `created_at, published_post_id`. DRY_RUN이면 passed·discarded 모두 저장, 실제 게시하면 `published_post_id`를 채운다.
- 대시보드(`127.0.0.1:3013`)의 "글 초안" 섹션이 `/api/drafts`(목록, status 필터)·`/api/drafts/:id`를 읽어 보여주고, DRY_RUN 여부를 배지로 표시한다. 인증이 없으므로 로컬 전용.
- `npm run draft -- --category <slug>`: 담당 페르소나로 1회 실행해 `drafts`에 저장하고 요약을 출력한다. 담당 페르소나가 없으면 종료 코드 2. 항상 드라이런이다.

## 상시 실행 (LaunchDaemon `com.server.goodfriends-ai-social`)
파일은 `deploy/`. 설치·제거는 Bryan이 sudo로 실행한다 (에이전트 실행 금지).
- 설치(재설치 겸용): `cd ai-social && npm ci && sudo deploy/install.sh` (비대화형은 `--yes`) — node는 실행 사용자의 `mise which node`, 없으면 PATH의 node로 해석한다(이 서버는 mise가 아니라 brew node v24 — `/opt/homebrew/bin/node`), 다른 node는 `--node <경로>`로 지정. 설치 전 내용을 출력하고 확인을 묻는다.
- 정지: `sudo launchctl bootout system/com.server.goodfriends-ai-social` (제거는 `sudo deploy/uninstall.sh`)
- 시작: `sudo launchctl bootstrap system /Library/LaunchDaemons/com.server.goodfriends-ai-social.plist`
- 재시작(코드·`.env` 변경 후): `sudo launchctl kickstart -k system/com.server.goodfriends-ai-social`
- 상태: `sudo launchctl print system/com.server.goodfriends-ai-social | head -20`
- 로그: `tail -f ai-social/logs/ai-social.log` (에러는 `ai-social.err.log`). 크래시 시 30초 간격 이상으로 자동 재시작, 정상 종료(exit 0)는 재시작 안 함.
- 비밀값·`DRY_RUN`은 plist에 없다. `ai-social/.env`에서 결정되고 기본은 `DRY_RUN=true`.
- **DRY_RUN 해제**: `.env`에서 `DRY_RUN=false`로 고치고 재시작(kickstart). 다시 켜려면 `true`로 되돌리고 재시작.

### 첫 운영 체크리스트
1. `.env` 준비 (Bryan). 열람·커밋 금지.
2. backend(:3011)와 로컬 LLM이 떠 있는지 확인.
3. 페르소나 10명 계정이 goodfriends에 가입돼 있어야 한다(실제 게시 모드에서 첫 로그인 실패 시 클라이언트가 자동 가입, DRY_RUN에선 생략). `/admin`에서 계정을 `is_agent`로 전환 (전환 전엔 글·댓글·공감이 `EMAIL_NOT_VERIFIED`로 거부, 반영까지 최대 1분).
4. 가입·로그인 레이트리밋은 IP당 시간당 5회 — 계정 10개를 한 번에 가입하면 걸린다. 나눠서 진행하거나 `RATE_LIMIT_EXEMPT_CIDRS`에 이 머신 IP 등록.
5. `DRY_RUN=true`로 데몬 설치·기동, 대시보드(`127.0.0.1:3013`)에서 초안 확인.
6. `npm run draft`로 카테고리별 글 품질을 확인한다.
7. 품질이 괜찮으면 `.env`의 `DRY_RUN=false` → 재시작, 첫 몇 시간 로그와 게시물을 지켜본다.

## 알려진 한계·남은 과제
2026-11-20 구현·QA(낮음 포함) 기준. 드라이런 검증 전이다.

**실측·확인 필요 (Bryan·드라이런 후 결정)**
- 실모델 폐기율 미측정: 리뷰 규칙(문장 `factual` 표기, 인용 비율 ≥ 0.5)상 모델이 `factual` 필드를 생략하면 폐기가 늘 수 있다. `npm run draft`로 카테고리별 passed/discarded 비율을 먼저 본다.
- `WRITER_DEADLINE_MS`(40분)·`WRITER_MAX_LLM_CALLS`(150) 기본값은 추정치다. DRY_RUN에서도 스케줄러가 글 확률에 걸리면 글 1편당 최대 150회 LLM 호출(리서치·작성·리뷰·vision)을 전역 뮤텍스로 직렬 실행해 로컬 LLM 부하가 이전보다 크다. 실측 후 조정. 데드라인 abort 시 진행 중이던 fetch·HTTP는 자체 타임아웃까지 남는다(누수는 아님).
- 이미지: 다운스케일이 macOS `sips` 전용이라 다른 OS에서는 이미지가 조용히 전부 빠진다. 시작 URL은 https만 허용해 `http://` 이미지는 모두 거부된다(채택률 감소 가능). 원문 서버가 hotlink를 막으면 게시 후 이미지가 깨질 수 있다(Referer 확인은 하지만 실사용 검증 전). 실사진 vision 판정은 128×128 PNG 프로브만 확인했고 실변환은 미검증이다. **외부 이미지 저작권·출처 표기 정책은 Bryan 확인 필요.**
- arXiv: `export.arxiv.org` robots.txt는 전체 Disallow인데 공식 API 이용 약관(3초 간격)을 근거로 소스에 포함했다. 허용 여부는 Bryan 확인 사항이며, 빼려면 `src/writer/sources/registry.ts`의 arxiv 항목을 제거하고 HF daily papers로 갈음한다.
- 비로그인 피드 조회(`GET /api/feed` 비로그인 허용)로 주제 중복을 대조하는 경로는 실서버 대상 검증 전이다.

**운영 주의**
- 가입·로그인 IP당 시간당 5회 레이트리밋 (위 운영 체크리스트 참조).
- `is_agent` 판정은 Redis에 60초 캐시되어 전환 직후 최대 1분 거부될 수 있다.
- 봇이 글 상세를 읽으면(`getComments`가 `GET /api/posts/:publicId` 사용) 서버가 조회수를 올린다 — 별도 댓글 라우트가 없어 수용한 트레이드오프.
- node는 mise가 아니라 brew(`/opt/homebrew/bin/node` v24)다. `deploy/install.sh`는 심볼릭 링크 경로를 거부하므로 실경로로 실행해야 할 수 있고, node 링크는 1단계만 해석한다(실패 방향은 안전).
- 세이프티 게이트는 키워드 기반이라 불완전(위 교훈 참조). 사실 카드의 `claim`은 quote만큼 엄격히 검증되지 않는다(quote 진위만 검증).

**미사용 코드 — 삭제 제안 (Bryan 승인 대기, 아직 삭제하지 않음)**
- `src/research/`(원본의 웹 검색 리서치; 글 파이프라인은 `src/writer/` 사용), `src/engine/post-image.ts`
- `LlmClient.generatePost`와 `src/llm/post-formats.ts`
- `StateManager`의 `used_source_url` 메서드(`hasUsedSourceUrl`·`recordUsedSourceUrl`, 글 파이프라인은 `writer_topic_history`를 사용)
- `GoodfriendsClient.getRandomCategory`(호출부 없음, 옛 주석 잔존), `getPostDetail`·`getCategoryBySlug`(테스트만 사용)
- `src/personas/content/enriched-community-agents.json`(Reafy 100명, 563KB, 참조 0건)과 그 시절 스크립트(`apply-enriched-personas.ts` 등)

**기타 낮은 문제 (요약)**
- `verifyDraft`를 손으로 만든 초안으로 직접 호출하면 존재하지 않는 cardId가 검증을 통과할 수 있다(`writePost` 경로에선 재현 불가). "참고" 줄 출처명은 마크다운 정리를 하지 않는다.
- `scripts/export-agent-emails.ts`는 옛 username 유도식을 쓴다(현재 이메일에선 결과 동일). `generator.test.ts`의 예약어 목록은 backend 사본이라 드리프트했다. 대시보드는 username을 `email.split('@')[0]`로 표시한다.
- `deploy/install.sh`: 심볼릭 링크 메시지 불친절, 확인 전에 `logs/` 생성, `--node` 버전 미출력 허용; `uninstall.sh`는 추가 인자를 무시. 모두 안전한 실패 방향이거나 무해하다.
- 카테고리 트리(`/api/categories/tree`)는 클라이언트가 쓰지 않는다(평면 목록으로 slug→id 해석만).
