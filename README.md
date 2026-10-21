# AI 커뮤니티

> 배우고, 만들고, 나누는 AI 커뮤니티 — 기획 기준: `PLAN.md` (concept: ai-board-phase1.pdf)

Reafy를 포크해 **완전 독립**(코드·DB·세션 공유 없음)으로 만든 프로젝트의 1차 개발 출발점입니다.

**현재 상태 (2026-10-19)**: 마일스톤 M0~M4 완료 — 인증·카테고리·글/댓글/반응(Q&A 채택, 시리즈, 조회수, 검색)· 뉴스봇+다이제스트 엔진·라운지 채팅·모더레이션(신고→숨김). 테스트 560(backend)/21(web). 다음: M5(론칭 준비).

## 저장소 구조

```
backend/    Node 20+ · TS 커스텀 http-server (API + WebSocket 단일 프로세스)
            PostgreSQL(+PgBouncer) + Redis — docker-compose는 backend/에
backend/worker/  뉴스봇 파이프라인 CLI (npm run worker:news, --loop 상주)
web/        Next.js 16 · React 19 · Tiptap 에디터
PLAN.md     개발 플랜 (마일스톤 M0~M6) — 마일스톤 상태·완료 근거는 여기
docs/       세션별 작업 문서 (결함/교훈/잔여 과제)
```

## 주요 화면·API (1차 구현분)

- 인증: 이메일 가입(인증 메일 없으면 서버 로그 `[email:stub]`에서 토큰 확인)·로그인·비밀번호 재설정, 쿠키 세션 `aic_session`
- 카테고리 9개 중 5개 오픈 + 홈 피드(최신/인기)·검색(`/api/posts/search`, prefix 계약)
- Q&A: 글 채택(용자 배지)·조회수(Redis dedup)·개발 로그 시리즈
- 콘텐츠 엔진: 뉴스봇(8 RSS 소스 → 중복 제거 → 한국어 요약 → 발행, OpenAI 호환 LLM — 미설정 시 결정적 stub) + `/admin/digests` 다이제스트 반수동 발행
- 라운지: `/lounge` 전체방 실시간 채팅(`ws://<backend>:3010/ws/lounge`, 분당 10발 레이트리밋)
- 관리: `/admin` 대시보드(신고 처리·유저 정지·공지·다이제스트)

## 1차 스코프에서 제외 (Reafy에서 제거한 것)

- 소셜 로그인(oauth) — 로그인 결합 금지 원칙
- 모바일 앱 지원(mobile-http, 푸시, well-known/딥링크)
- 마켓(market), 앨범(albums), 미디어 업로드(media/object-storage), 1:1 쪽지(메시지API는 스텁만 유지)
- Intent 시스템(로그인 직후 의도 보존), 연령 게이트, 광고(AdSense)

## 로컬 실행

```bash
# 1) DB (백엔드 디렉터리에서)
cd backend
npm run db:up        # Postgres + PgBouncer + Redis (docker compose)
npm run db:migrate
npm run dev          # :3010 (http + ws)

# 2) 웹
cd ../web
npm run dev          # :3011, /api/* 프록시 → :3010 (WS는 프록시 안 됨 — /lounge가 :3010 직결)
```

테스트: `backend` — `npm test`(DB 필요) · `npx tsc --noEmit`(DB 불필요)
`web` — `npm test`(DB 불필요) · `npm run build`(DB 불필요, sitemap/llms.txt는 dynamic)

## 다음 단계

`PLAN.md`의 M5(론칭 준비) — 시드 콘텐츠 작성, SEO(sitemap·OG), VPS 배포(compose 이관 + 도메인 확정), 백업 스크립트 이관, 소프트 론치. 세부적으로 남은 todo(P0~P2)는 `docs/2026-10-18-19-worklog-m2-m3.md` §6.
