# AI 커뮤니티 개발 플랜

> 기준 문서: ai-board-phase1.pdf (2026.10.18 확정 1차 개념)
> 슬로건: "배우고, 만들고, 나누는 AI 커뮤니티"
> **진행 상태 (2026-10-19)**: M0~M4 ✅ 완료 — 다음 M5. 완료 근거·남은 과제는 각 마일스톤 섹션과 `docs/2026-10-18-19-worklog-m2-m3.md` §6 todo 참고.

---

## 1. 기본 원칙 (문서에서 확정된 제약조건)

| 항목 | 결정 | 플랜에 미치는 영향 |
|---|---|---|
| 기술 출발점 | **Reafy 포크, 완전 독립** | 코드 패턴은 재사용하되 새 저장소, 코드/DB/로그인 결합 전부 없음 |
| 1차 카테고리 | **9개만 오픈** | 4개(로컬모델·이미지영상·논문·협업찾기)는 스키마만 준비, UI는 숨김 |
| 콘텐츠 엔진 | **RSS 뉴스봇(자동) + 오늘의 AI 화제(1차 반수동)** | 소셜 자동 수집은 2차. 1차는 관리용 큐레이션 UI까지 |
| 차별점 | **개발 로그 + 채팅** | 글 CRUD만 하는 게 아니라 "기록 중심" 기능(시리즈/연재)과 라운지 채팅이 1차 스코프 |
| 론칭 방식 | **시드 콘텐츠 선충전 → 소셜/오픈채팅 홍보** | 론칭 전 시드 작성 기간을 일정에 명시 |
| 세부 스펙 | **개발하면서 확정** | 요약 길이·발행 개수 등은 이 플랜에서 강제하지 않음 |

**이 플랜에서 새로 확정하는 것**: 폴더 구조, 기술 스택 이관 목록, 마일스톤 순서.
**의도적으로 미루는 것**: 도메인/서비스명(론칭 전에만 확정), 요약 발행 스펙, 소셜 자동 수집, 2차 카테고리.

---

## 2. 기술 스택 (Reafy 패턴 계승)

```
backend/   Node 20+ · TypeScript · 커스텀 http-server (Reafy 패턴)
           PostgreSQL(pg) + Redis(ioredis) + WebSocket(ws)
           마이그레이션: scripts/migrate.ts 방식 계승
frontend/  Next.js 16 · React 19 · Tiptap 에디터 (Reafy 패턴)
worker/    뉴스봇 파이프라인 (RSS 수집 → 중복제거 → AI 요약 → 발행) — 🔒 실제로는 backend/worker에 구현(M3 결정, 위 목록의 루트 worker/ 계획은 흡수됨)
test/      vitest (단위) + Playwright (E2E, 론칭 전 핵심 플로우만) — 실제로는 backend/tests(frontend 21건은 frontend/)
deploy/    docker-compose (Postgres · Redis · backend · worker) — 실제로는 backend/docker-compose.yml
```

**LLM 요약 API**: 요약 전용으로 하나만 선택 (가볍게 시작 → 비용 보고 교체 가능한 구조로 추상화). 정확한 프로바이더·요약 길이·1일 발행 수는 개발 단계에서 확정 (문서 원칙 준수).

---

## 3. Reafy 포크 스코프 — 가져올 것 / 버릴 것 / 새로 만들 것

완전 독립 원칙: **파일 복사 후 git 히스토리 새로**, Reafy와 패킷·DB·세션 공유 없음.

### 가져올 것 (재사용으로 시간 절약)

| 모듈 | 용도 |
|---|---|
| `http-server.ts`, `http-utils.ts`, `db.ts`, `redis.ts` | 서버 뼈대 그대로 |
| `session.ts`, `password.ts`, `auth-http.ts` (oauth 제외) | 이메일+비밀번호 인증 |
| `categories.ts/-http.ts` | 카테고리 CRUD 토대 |
| `posts.ts/-http.ts`, `comments.ts`, `post-detail.ts` | 게시글/댓글 코어 |
| `rate-limit.ts`, `moderation.ts`, `reports-http.ts` | 스팸/신고 최소 방어 |
| `popularity-refresh-job.ts` 패턴 | worker/cron 구조 참고 |
| `sitemap-http.ts` | SEO |
| `error-alert.ts` | 장애 알림 |
| Tiptap 에디터 셋업 (web) | 글쓰기 UI |

### 버릴 것 (독립 원칙 + 1차 불필요)

- `oauth.ts` — 로그인 결합 금지 (문서 명시)
- `mobile-http.ts`, `push-dispatch.ts`, `push-tokens.ts` — 1차는 웹 전용
- `market.ts`, `age-gate.ts`, `countries.ts`, `postal-codes` — 도메인 불일치
- `albums.ts`, `media.ts` — 1차는 링크+이미지 수준으로 축소
- `messages-http.ts` 쪽 DM — 1차 채팅은 "라운지" 방식으로 새로 만듦

### 새로 만들 것 (이 커뮤니티의 핵심)

1. **뉴스봇 파이프라인** (RSS 8개 소스 → 묶기 → AI 한국어 요약 → 봇 계정 발행, **원문 링크 필수**)
2. **"오늘의 AI 화제" 반수동 제작 UI** — 대상 계정 리스트 관리 + 다이제스트 초안 생성 → 사람이 확인/수정 → 발행
3. **Q&A 채택** — 답변 채택 마크 + 채택 기반 FAQ 링크
4. **개발 로그 연재(시리즈)** — 여정 기록이 차별점이므로 글을 시리즈로 묶는 기능
5. **라운지 채팅** — ws 기반 전체 채팅방 (가볍게 묻는 채널). DM은 2차
6. **봇 계정 체계** — `role='bot'` 유저 (뉴스봇/화제봇), 봇 글은 UI로 구분 표시

---

## 4. 데이터 모델 초안 (개발하며 조정)

```
users(id, email, password_hash, nickname, role[user|bot|admin], created_at)
sessions(users FK)
categories(slug, name, section[learn|build|share], sort, is_active)  -- 9개 시드, 4개 준비
posts(id, category_id, author_id, title, body, status[published],
      is_bot, source_url, view_count, published_at,
      series_id NULL)                    -- series_id = 개발로그 연재
comments(id, post_id, author_id, body, parent_id NULL, is_accepted)  -- Q&A 채택
votes(post_id, user_id, value)
series(id, author_id, title, description)
news_items(source, url, title, published_at, dedup_hash, summary, post_id NULL)
        -- 수집 raw → 발행 후 post_id 연결. dedup_hash로 중복 제거
digest_candidates(account, text, picked bool)  -- 화제 큐레이션 (1차 수동 입력)
reports(post_id | comment_id, reason, status)
chat_messages(room, user_id, body, created_at) -- 라운지 채팅
```

---

## 5. 마일스톤 (소프트 론칭까지 8주)

### M0 — 포크 스코프 확정 & 저장소 셋업 (Week 1 전반) — ✅ 2026-10-18 완료

- [x] Reafy 코드 감사: 위 3장 표 기준으로 실제 파일별 이관/제외 목록 확정
- [x] `ai_community` 저장소 초기화 (backend / web / worker / deploy / docs)
- [x] docker-compose로 Postgres+Redis 기동, 마이그레이션 프레임워크 이관, `npm test` 녹색
  - Reafy 스택과 포트 충돌 방지: pg 55434 / pgbouncer 56434 / redis 6381 / 서버 3010
- **완료 기준**: 빈 서버가 로컬에서 뜨고, 마이그레이션 1개(카테고리 테이블) 돌아감 ✅

### M1 — 인증 & 카테고리 뼈대 (Week 1~2) — ✅ 2026-10-18 완료

- [x] 이메일 가입/로그인/로그아웃 (oauth 없음) — Reafy 인증 그대로 이관(oauth 제거), 테스트 49건 통과
- [x] 카테고리 9개 시드 마이그레이션 (0049) — 2차 4개(research/open-models/gen-media/collab)는 `is_public=false`로 준비
- [x] 관리자 role 최소 구현 — Reafy의 moderator role과 `users.is_agent`(0043) 재사용, 별도 신기능 없음(운영자 = 정원사)
- **완료 기준**: 가입→로그인→카테고리 목록 조회까지 E2E 한 개 통과 ✅ (실서버 curl: signup 201 → login → `/api/categories/tree` 배우고/만들고/나누는 → logout)
- 비고: backend `npm test` 482건 통과(DB 공유 레이스 방지 위해 `fileParallelism: false`)

### M2 — 글/댓글/추천 코어 (Week 2~4) — ✅ 2026-10-18 완료

- [x] 글쓰기(Tiptap)·수정·삭제, 목록/상세, 조회수
  - Tiptap composer·수정·삭제는 Reafy 유산 그대로 유지, 조회수는 신규(0050 `posts.views`, Redis NX 24h dedup — 작성자 본인 제외, 응답은 증가분 즉시 반영)
- [x] 댓글(대댓글), 추천, 신고 — Reafy 유산(0021 답글·reactions·reports). 단, M0에서 잘못 제외한 intent 모듈(intent-session/execution/http, `aic_intent` 쿠키로 리네임)을 재작성해 복구 — 추천·저장·팔로우·비로그인 댓글초안 게이트가 프론트(`/api/intent*`)와 다시 연결됨. 푸시(dispatchPush)는 1차 스코프 밖이라 알림은 in-app만.
- [x] **Q&A 채택** (답변 채택 → FAQ 후보) — 0050 `posts.adopted_comment_id` + `qna.ts` + `PATCH /api/posts/:id/adoption`(답글도 채택 가능, 작성자만, qna 카테고리 한정) + 댓글 채택 배지/버튼 UI
- [x] **개발 로그 시리즈** (연재로 묶기) — 0050 `series` 테이블 + `series.ts/series-http.ts` + `/api/series*` (시리즈 소유자 = 글 작성자 조건, 시리즈 삭제 시 글 유지) + 상세 페이지 시리즈 배지. `/series/[id]` 상세 페이지는 M4 UX 단계로 미룸
- [x] Postgres 부분일치 검색 — §6.8 pg_bigm GIN 계약(`lower(col) LIKE ... ESCAPE`)대로 `GET /api/search?q=&category=`가 글 제목/본문을 합친 목록을 반환 + 우측 사이드바 라이브 검색 + `/search` 페이지(한국어 형태소·오타 허용은 2차)
- **완료 기준**: "글 작성 → 댓글 → 추천 → Q&A 채택" 핵심 플로우 E2E 통과 ✅ (실서버 curl: 가입 2계정(이메일 인증) → Q&A 글 작성 publicId `xqCyUYYFXd8` → 답변 댓글 → intent로 공감 → 채택 → 상세에서 adoptedCommentId·조회수 확인)
- 비고: backend `npm test` 628건 통과 / web tsc 0에러·빌드 성공·21 테스트 통과
- 보고 남김(1차 남기는 것): 검색은 부분일치(형태소 분석 아님), views 정확 카운트가 아니라 dedup된 통계, 시리즈 전용 페이지 미구현

### M3 — 콘텐츠 엔진: 뉴스봇 + 화제 다이제스트 (Week 3~5, M2와 병행) — ✅ 2026-10-19 완료

- [x] `worker/` — RSS 8개 수집 (TechCrunch AI, The Verge AI, MIT TR AI, MarkTechPost, HF Blog, OpenAI News, arXiv cs.AI, arXiv cs.CL)
  - `backend/worker/news-bot.ts` CLI(`npm run worker:news`) + `--loop` 상주 모드 — 🔒 plan의 루트 `worker/`가 아니라 backend 안에 둔다: db/redis/error-alert를 같은 package.json에서 재사용해야 유지보수비가 안 는다. 배치는 cron/launchd 권고.
- [x] 중복 제거 (URL+제목 유사도) → LLM 한국어 요약 → 원문 링크 포함 발행
  - URL은 UNIQUE 인덱스(ON CONFLICT), 제목은 정규화 trigram Jaccard ≥ 0.85(최근 30일), 7일 지난 원문 스킵
  - `src/llm.ts` — OpenAI-호환(환경변수 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL); **키 없으면 결정적 stub** — 키·네트워크 없는 로컬에서도 사이클이 지속되어야 한다는 완료 기준이 근거. 실배포 때 키만 넣으면 품질 자동 승격
- [x] 봇 계정(`role='bot'`)으로 예약 발행, 발행 스펙(개수/길이)은 운영하며 튜닝
  - 0024 보류(사용자 결정) 기록 유지 — 스키마는 `is_agent`(0043)로 해석: `ai_news_bot`/`ai_digest_bot`(0051, 이메일 NULL·is_agent로 발행 게이트 우회), 예약 username은 RESERVED_USERNAMES에 추가
  - 스펙 상수 `NEWS_DEFAULT_SPEC`(NEWS_MAX_PER_CYCLE 기본 5/사이클) — 실측: fetched 2209 → dedupe로 42 기록 → 5 발행(2026-10-19 실사 데이터, xqCyUYYFXd8와 별개)
- [x] **화제 다이제스트 제작 UI**: 계정 리스트 관리 → 초안 생성 → 관리자 확인/수정 → 발행 (1차 반수동)
  - `/admin/digests` 탭(AdminDigests.tsx) + `/api/admin/digest/*`(admin-digest-http.ts — admin-http catch-all보다 먼저 마운트해야 한다 순서 주의) — 발행은 ai-topics 카테고리, ai_digest_bot 명의, 초안 1회발행(재발행 409)
- [x] 실패 알림 (`error-alert` 패턴): RSS 죽음/LLM 실패 시 운영자에게 알림 — 기존 alertAdminOfError 재사용(5분 rate-limit), ADMIN_ALERT_EMAIL 없으면 콘솔 폴백
- **완료 기준**: 하루 1회 사이클이 사람 개입 없이 돌고, 관리 화면에서 다이제스트 1건 발행 가능 ✅ — 실서버에서 전 흐름 실증(소스 추가 → 초안 생성 → 관리자 수정 → 발행 → `/api/feed`에 봇 글 노출), 사이클 크래시/소스죽음/LLM실패 3시나리오 테스트로 복구 검증
- 비고: backend `npm test` 554건 통과(39파일) / web tsc·빌드 통과. 남긴 것: 봇 글 UI 구분 표시·채택 답변 고정은 M4, 한 소스 편중(openai-news가 queue를먹음)은 운영 튜닝 과제
- **운영 튜닝 완료(2026-10-19, M4 라운드)**:
  - 소스 편중 완화 — `NEWS_DEFAULT_SPEC.perSourceCycleCap`(NEWS_PER_SOURCE_CYCLE, 기본 2) + summarizeQueue를 `row_number() OVER (PARTITION BY source_key)` 상한 → 소스 간 라운드로빈 병합으로 교체(A소스가 5건 전부 먹던 실측 개선). 총 장수는 maxPerCycle 우선. 테스트 1건 추가(3소스×5건 — 발행 3건이 3소스 고르게). `npm test` 561건(40파일)
  - 훅 발견 결함 — worker 단발 스모크가 `too many clients already`(53300)로 크래시: ownerPool()이 호출마다 new Pool을 돌려주고 아무도 end() 안 함. db.ts에서 싱글턴 memoize(끊긴 뒤 재호출 시 재생성 — afterAll `owner.end()` 패턴 양립) + worker 단발 모드는 종료 전 풀 end(). 스모크 재실행 — fetched 2435/recorded 44/published 0(NEWS_MAX_PER_CYCLE=0 스모크) 후 클린 exit
  - 스케줄 템플릿 — backend/deploy/(news-bot.cron.example, ai-community-news-bot.plist.example). LLM_API_KEY·ADMIN_ALERT_EMAIL 실값은 사용자 주입 필요(stub은 계속 동작)
  - **LLM 실계 승격 완료(로컬 vLLM)** — 10.10.1.100:8000 `/v1`(vLLM, QuantTrio/Qwen3.5-9B-AWQ): .env에 LLM_API_KEY/BASE_URL/MODEL 기입 + `LLM_EXTRA_BODY_JSON`(제공사별 확장 필드 env 통로 — vLLM `chat_template_kwargs.enable_thinking:false`). 실발행 5건 요약 품질 확인(한국어 경어체 제목+2문장, 사이클 51s→16s). **배움**: ① 이 Qwen 배포는 `/no_think` 소프트 스위치를 무시한다 — 템플릿 kwargs로만 억제 ② thinking 잘림(토큰 상한) 시 Answer 구분선 부재 → stripThinking이 빈 문자열로 실패 처리해 추론 노이즈 발행 막음(max_tokens 상한 800/2400) ③ OpenAI 호환 계약 유지: 제공사 전용 검증 필드를 body 상수로 박아 넣지 않고 env로만 ④ 봇 글 게이트 품질은 stub 요약과 같은 모양(krTitle/digest)이라 코드 변경 없이 승격됨 ⑤ 운영 유의: 공유 DB에서 status='new' 재큐 직후 테스트 스위트를 돌리면 beforeAll 위생이 다시 'failed'로 바꿔치기 한다 — 재큐 직후엔 곧바로 워커. arXiv(cs.AI/cs.CL)는 2천+건 피드라 소스 편중 캡 2/사이클이 배리어로 맞히며, 잔여 큐는 다음 사이클 자기복구로 드레인

### M4 — 라운지 채팅 & 마감 기능 (Week 5~6)

- [x] ws 기반 라운지 채팅 (전체방 1개, 최소 기능: 접속/발言/최근 기록) — 0052 `chat_messages`(btrim 1..1000 CHECK) + `src/lounge.ts`·`lounge-ws.ts`(60초 세션 재검증, 비인증 4001)·`lounge-http.ts`(GET hydration) + ws-server 업그레이드 라우팅 `/ws/lounge` + web `Lounge.tsx`(is_agent 발언 배지 포함). 쿠키는 포트 무시 매칭이라 3011→3010 직결(next rewrites는 WS 업그레이드를 프록시하지 않음 — next.config.ts 주석). 테스트 6건(핸드셰이크·히스토리·브로드캐스트·레이트리밋 10/60s `lounge:{userId}`·INVALID_BODY/FRAME)
- [x] 봇 글 UI 구분 표시, 채택 답변 상단 고정, 반응(리액션)
  - feed·post-detail DTO에 `authorIsAgent`(users.is_agent) 추가 → PostCard·글 상세 "AI 에디터" 배지(M2 채택 배지와 같은 초록 계열)
  - CommentSection 최상위 목록에서 채택 댓글(adoptedId state 기준 — 채택 즉시 반영) 맨 앞 고정
  - 반응은 M0.md 네이티브 intent로 1차 구현되어 상세 6-emoticon 바가 이미 재사용됨(M2 점검 완료, 추가 작업 없음)
- [x] 스팸 방어 점검 (rate limit, 신고 처리 화면)
  - **신고→숨김 플로우 실증(라이브 curl)**: ① 일반유저 POST /api/reports 201 → ③ 모더레이터 /api/admin/reports/:id/resolve 200 → ④ /api/admin/posts/:id/delete 200 → ⑤ RLS로 피드에서 소실·상세 404 · ⑦ 모더레이터 눈에만 deletedAt(=삭제됨 배지) — "자동 임계값 숨김" 없이 접수(큐)→수동 처리가 1차 설계다
  - **rate limit 전표 문서화**(rate-limit.ts Redis 고정윈도우, 키:값 — 초당/h당): 라운지 발언 10/60s(`lounge:{userId}`, M4) · 신고 10/h · 댓글 30/h · 계정삭제 5/h · 이메일변경 5/h · 로그인 5/IP/h · 가입 5/IP/h · 비밀번호재설정 5/IP/h · 이메일인증재발송 5/IP/h · 이메일 인증메일 재요청(온보딩) 10/h · 시리즈 10/h · 링크프리뷰 30/h · 유튜브용량체크 30/h · 중복확인류 60/10min — 모두 429/프레임으로 응답
  - 신고 처리 화면(AdminReportsList)·유저 정지·글/댓글 삭제(0035 모더레이션+moderation_access_log 감사)는 M0 세대에서 재사용 확인
- **완료 기준**: 두 브라우저에서 실시간 채팅 확인 ✅(라이브 E2E — 두 클라이언트 상호 수신·hydration·RATE_LIMITED·봇 is_agent 발언), 신고→숨김 플로우 동작 ✅(라이브 7단계 실증) — **M4 완료 2026-10-19**

### M5 — 론칭 준비 (Week 6~8)

- [x] **시드 콘텐츠 작성** (봇이 못 채우는 것 위주) — ✅ 완료(2026-10-19, worklog 4ter.5):
  - 개발 로그: 이 커뮤니티 기획·개발 과정 일지 5편 (시리즈 "AI 커뮤니티 만들기 — 실전 개발 일지"로 엮음)
  - 프로젝트 쇼케이스 2편 + 활용 노하우 4편(ai-tips) + Q&A 마중물 4건(qna, 채택 1건 시연)
  - scripts/seed-content.ts + seed-run.ts(idempotent HTTP 시드 실행기)
- [x] SEO: sitemap, OG 태그, 카테고리 랜딩 — ✅ 완료(2026-10-19, worklog 4ter.6): 카테고리 랜딩 generateMetadata + sitemap에 게시판 랜딩 URL + 브랜드 스윕('AI Community' 전면 통일 — 로고·OG·이메일·법적 고지)
- [ ] 배포: docker-compose 기반 VPS (도메인은 이 시점에 확정 — 보류 항목 해소) — **dev 서버 배포 완료(워크스테이션 10.10.1.100, 백엔드 3020/웹 3021, Reafy 스택 병행 — worklog 4ter.7)**; 프로덕션 도메인+시크릿만 대기 (백업 스크립트+크론 템플릿은 로컬 검증 완료)
- [ ] 모니터링/백업 스크립트 이관 (Reafy `backup-db.ts` 패턴)
- [ ] 소프트 론치 → 소셜 커뮤니티·오픈채팅방 홍보 (문서의 사람 모으기)
- **완료 기준**: 실사용자 10명이 글 1개 이상 남기는 것

### M6 — 2차 백로그 (론칭 후, 글이 쌓이는 속도 보고 착수)

| 항목 | 트리거 조건 |
|---|---|
| 소셜 자동 수집 (X API 유료 검토) | 반수동 큐레이션이 운영 부하가 될 때 |
| 2차 카테고리 4개 오픈 (로컬모델·이미지영상·논문·협업찾기) | 해당 주제 글이 주 5건+ 꾸질 때. 협업찾기는 **활성 유저 페이지 기준** |
| FAQ 자동화 (Q&A 채택 기반) | 동일 질문 3회 반복 시 |
| DM / 알림(댓글·채택) | 유저 요청 몰릴 때 |

---

## 6. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| RSS 소스 변동 (문서: VentureBeat 제한, Anthropic 피드 없음 사례) | 소스별 헬스체크 + 실패 알림, 소스 교체가 쉬운 설정 파일 구조 |
| LLM 요약 비용/품질 | 프로바이더 추상화, 1일 발행 수 제한, 운영 초기엔 관리자 승인 후 발행 옵션도 유지 |
| 뉴스봇 글로만 첫 화면이 채워지는 느낌 | 홈 랜딩에서 **수동 글(개발로그·쇼케이스) 우선 노출**, 봇 글은 섹션 분리 |
| 채팅 스팸/무분별 | rate limit + 신고, 1차는 전체방 하나만 (모더레이션 부하 최소화) |
| 빈 게시판 (2차 카테고리) | `is_active=false` 유지, 글 쌓이는 속도 보고 오픈 (문서 원칙 그대로) |
| 도메인 미확정 | 개발은 로컬/서브도메인으로 진행, 론칭 체크리스트에서 강제 |

---

## 7. 바로 다음 액션 (이번 주)

1. Reafy `src/` 파일별 이관/제외 표 완성 (M0)
2. `ai_community` 저장소에 backend 뼈대 복사 + docker-compose 기동
3. 마이그레이션 #1: `users`, `categories` 생성 + 9개 카테고리 시드
4. (병행) 도메인 후보 조사 재개 — 문서에서 "후보 전량 탈락" 상태이므로 M5 전에 반듯이 확정
