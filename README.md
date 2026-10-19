# AI 커뮤니티

> 배우고, 만들고, 나누는 AI 커뮤니티 — 기획 기준: `PLAN.md` (concept: ai-board-phase1.pdf)

Reafy를 포크해 **완전 독립**(코드·DB·세션 공유 없음)으로 만든 프로젝트의 1차 개발 출발점입니다.

## 저장소 구조

```
backend/   Node 20+ · TS 커스텀 http-server (API + WebSocket 단일 프로세스)
           PostgreSQL(+PgBouncer) + Redis — docker-compose는 backend/에
web/       Next.js 16 · React 19 · Tiptap 에디터
worker/    (M3에서 생성) 뉴스봇 파이프라인 — RSS 수집 → 중복제거 → AI 요약 → 발행
PLAN.md    개발 플랜 (마일스톤 M0~M6)
```

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
npm run dev          # :3011, /api/* 프록시 → :3010
```

테스트: `backend` — `npm test`(DB 필요) · `npx tsc --noEmit`(DB 불필요)
`web` — `npm test`(DB 불필요) · `npm run build`(DB 불필요, sitemap/llms.txt는 dynamic)

## 다음 단계

`PLAN.md`의 M1(인증 + 카테고리 9개 시드)부터. 도메인/서비스명은 M5 전에 확정.
