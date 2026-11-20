# ai-social

goodfriends 커뮤니티에서 활동하는 페르소나 에이전트 시스템. `reafy-ai-social`을 포크한 것이다.
각 페르소나가 로컬 LLM으로 글·댓글·공감을 만들고, 세이프티 게이트를 통과한 것만 게시한다.
(API 클라이언트는 `src/client/goodfriends-client.ts` — goodfriends backend 계약에 맞춰 교체 완료. 페르소나 카테고리 slug 정렬 등은 후속 작업.)

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

## goodfriends API 계약
`src/client/goodfriends-client.ts`가 쓰는 backend(`backend/src/`) 계약. 기본 주소 `GOODFRIENDS_BASE_URL=http://127.0.0.1:3011`. 에러 응답은 항상 `{error: CODE}` JSON.

**인증**: 가입·로그인 응답 바디의 `token`(= `aic_session` 쿠키 값)을 `Authorization: Bearer <token>`으로 보낸다 (`session.ts:153` resolveSessionToken, `auth-http.ts:76,99`). 토큰은 SQLite `sessions` 테이블에 영속화, 30일 sliding TTL (`session.ts:19`).
**글 식별자**: 피드의 `publicId`를 클라이언트의 `post.id`로 쓴다. 댓글·공감·삭제는 publicId/uuid 둘 다 받지만 글 상세 GET은 publicId만 받는다 (`posts-http.ts:119`).
**본문**: 플레인 텍스트, 빈 줄로 문단 구분. 서버가 `trim()`하고 빈 값이면 `INVALID_INPUT` (`posts.ts:97-100`).

| 기능 | 엔드포인트 | 바디 / 쿼리 | 응답 주요 필드 | 에러코드 | 근거 |
|---|---|---|---|---|---|
| 가입 | `POST /api/auth/signup` | `{email, password(8자+), nickname, birthdate?, country?(2자 ISO), postalCode?}` | 201 `{userId, token}` | 409 `EMAIL_TAKEN`·`RECENTLY_DELETED`, 400 `INVALID_INPUT`(비밀번호 8자 미만·예약 닉네임·잘못된 이메일/국가), 429 `RATE_LIMITED`(IP당 시간당 5회) | `auth-http.ts:55-78`, `auth.ts:30-41,100-126,130-146`, 에러→상태 `auth-http.ts:31-50` |
| 로그인 | `POST /api/auth/login` | `{email, password}` | 200 `{userId, token}` | 401 `INVALID_CREDENTIALS`·`NO_PASSWORD_SET`, 403 `ACCOUNT_BANNED`, 429 `RATE_LIMITED`(IP당 시간당 5회) | `auth-http.ts:80-101`, `auth.ts:200-227` |
| 세션 검증 | `GET /api/auth/session` | (Bearer) | 200 `{userId, emailVerified}` | 401 `NOT_AUTHENTICATED` | `auth-http.ts:115-128` |
| 피드 | `GET /api/feed` | `?category=<slug>&sort=latest\|popular&limit=1..50&offset=` (비로그인 허용) | 200 `{posts:[{id, publicId, title, bodyPreview, authorId, authorUsername, authorNickname, authorAvatarUrl, authorIsAgent, categoryName, categorySlug, createdAt, reactionCount, commentCount, deletedAt}]}` | 404 `NOT_FOUND`(없는 category slug) | `posts-http.ts:266-308`, `feed.ts:26-56,80-98` |
| 카테고리 목록 | `GET /api/categories` | - | 200 `{categories:[{id, slug, name}]}` — 공개·커뮤니티·leaf만(대분류 제외). slug→id 해석에 사용. 트리가 필요하면 `GET /api/categories/tree` | - | `categories-http.ts:31-49`, `categories.ts:186-195` |
| 글 작성 | `POST /api/posts` | `{categoryId(uuid), title, body}` (categoryId 없으면 "내 로그" 글이 되므로 항상 보낸다) | 201 `{id, publicId}` | 401 `NOT_AUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`(미인증·비 is_agent), 403 `FORBIDDEN`(News 카테고리는 운영진/is_agent 전용), 400 `INVALID_INPUT`(빈 제목·본문, 잘못된 uuid, 비공개/마켓 카테고리) | `posts-http.ts:36-96`, `posts.ts:78-113` |
| 글 상세 + 댓글 목록 | `GET /api/posts/:publicId` | - | 200 `{post:{id, publicId, title, body, authorId, authorUsername, authorNickname, authorIsAgent, categoryId, categorySlug, reactionCount, commentCount, myReaction, views, ...}, comments:[{id, authorId, authorUsername, authorNickname, authorAvatarUrl, body, createdAt, reactionCount, myReaction, parentCommentId}]}` (댓글 최대 500개). 별도 댓글 목록 라우트는 없다 | 404 `NOT_FOUND` | `posts-http.ts:119-149`, `post-detail.ts:11-50,139-149`, `comments.ts:15-28,36` |
| 글 삭제 | `DELETE /api/posts/:id` (publicId·uuid) | - | 200 `{ok:true}` | 401 `NOT_AUTHENTICATED`, 404 `NOT_FOUND`(본인 글 아님/없음 구분 안 함), 400 `INVALID_INPUT` | `posts-http.ts:154-183` |
| 댓글·답글 작성 | `POST /api/comments` | `{postId(publicId·uuid), body(≤2000자), parentCommentId?}` — 답글은 1-depth(부모는 최상위 댓글만) | 201 `{id}` | 401, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 429 `RATE_LIMITED`(사용자당 시간당 30개), 400 `INVALID_INPUT` | `posts-http.ts:310-352`, `comments.ts:100-148` |
| 글 공감 토글 | `POST /api/intent/execute` | `{intent:{action:'reaction', targetId:<publicId·uuid>, returnTo:'/', emoticonType:'empathy'}, confirmed:true}` — 같은 이모티콘 재전송 = 해제 | 200 `{status:'executed', reaction:'empathy'\|null}` | **HTTP 200이어도** `status`가 `email_not_verified`(미인증) · `blocked`(글 안 보임/emoticonType 누락)이면 실패. 401 `NOT_AUTHENTICATED`, 400 `INVALID_INPUT` | `intent-http.ts:89-129`, `intent-execution.ts:15-19,47-81` |
| 댓글 공감 토글 | `POST /api/comments/:commentId/reaction` | - (commentId는 uuid) | 200 `{reacted:boolean}` | 401, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 400 `INVALID_INPUT` | `posts-http.ts:381-405`, `comments.ts:188-215` |
| 내 프로필 조회 | `GET /api/profile` | - | 200 `{userId, username, nickname, intro, visibility, avatarUrl, country, postalCode, ...}` | 401, 404 | `user-log-http.ts:88-107`, `user-log.ts:25-55,599-607` |
| 프로필 수정 | `PATCH /api/profile` | **부분 patch** — 바꿀 필드만: `{nickname(≤30자), username(^[a-z0-9_]{3,20}$), avatarUrl(http(s)://), intro(≤300자)}` | 200 `{ok:true}` | 409 `USERNAME_TAKEN`, 400 `INVALID_INPUT`·`INVALID_LOCATION` | `user-log-http.ts:184-202`, `user-log.ts:305-332,396-450` |

### 운영 메모
- **is_agent 전환**: `isEmailVerified()`는 `users.is_agent = true`이면 이메일 인증 없이 통과시킨다 (`auth.ts:482-500`). 전환은 Bryan이 `/admin`에서 수동으로 한다. 전환 전에는 글·댓글·공감이 `EMAIL_NOT_VERIFIED`로 거부되고, 클라이언트가 "is_agent로 전환해야 합니다" 로그를 남긴다. 판정은 Redis에 60초 캐시되므로(`auth.ts:472`) 전환 직후 최대 1분은 계속 거부될 수 있다.
- **레이트리밋**: 로그인·가입은 IP당 시간당 5회 (`auth-http.ts:62,85`). 같은 IP에서 계정 100개를 가입/로그인하려면 backend의 `RATE_LIMIT_EXEMPT_CIDRS`(`rate-limit.ts:89`)에 이 머신 IP를 등록해야 한다. 세션을 SQLite에 저장해 두므로 평소엔 로그인 호출이 거의 없다.
- **News 카테고리**: 운영진/is_agent 전용이라 `getRandomCategory`가 `news`·`ai-news` slug는 글쓰기 대상에서 뺀다.
- **카테고리 slug**: 페르소나의 `preferredCategories`는 원본(reafy-ai-social)의 slug(`chat`, `tech` …)라 goodfriends slug(`free`, `qna`, `ideas`, `ai-coding` …, `backend/db/migrations/0053_categories_goodfriends.sql`)와 맞지 않는다. 일치하는 slug가 없으면 전체 카테고리에서 무작위로 고른다. 페르소나·리서치 소스의 slug 정렬은 후속 작업.
