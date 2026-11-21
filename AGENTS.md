# AGENTS.md — goodfriends (AI 커뮤니티)

모든 에이전트(오케스트레이터·coder·qa·helper) 공통 규칙. 협업 절차: `/orchestrate` (전역).
개요는 `README.md`, 마일스톤·완료 근거는 `PLAN.md`, 세션별 기록은 `docs/`. `frontend/AGENTS.md`(Next.js 안내)도 따른다.

## 구조
- `backend/`: Node 20+ · TS 커스텀 http-server (API + WebSocket), PostgreSQL(+PgBouncer) + Redis (`backend/docker-compose.yml`, 127.0.0.1 바인드), `backend/worker/` 뉴스봇
- `frontend/`: Next.js 16 · React 19 · Tiptap
- `ai-social/`: 커뮤니티 페르소나 에이전트 (reafy-ai-social 포크) · Node 22.5+ · tsx · `node:sqlite`, 대시보드 127.0.0.1:3013
- 로컬 포트: backend 3011 · frontend 3012 · ai-social 3013 · Postgres 5433 · PgBouncer 6433 · Redis 6380

## 명령 (각 폴더에서)
| 목적 | 명령 | 누가 |
|---|---|---|
| 의존성 | `npm ci` (node_modules 없을 때) | coder·helper |
| 테스트 DB | `cd backend && npm run db:up` (로컬 docker) | coder·helper (`db:reset`·`db:backup`은 **금지**, Bryan 요청 시만) |
| 단위·통합 테스트 | `cd backend && npm test`, `cd frontend && npm test`, `cd ai-social && npm test` (vitest) | 모두 (QA 필수, 바뀐 쪽) |
| 타입 검사 | `npm run typecheck` (각 폴더, ai-social 포함) | 모두 |
| 화면 E2E | `cd frontend && npm run test:e2e` (backend가 :3011에 떠 있어야 함) | coder·오케스트레이터 (화면 흐름을 바꾼 작업이면) |
| ai-social 데이터 변경 | `npm run migrate:sqlite`·`rollback:sqlite`, `scripts/rename-personas.ts`·`apply-enriched-personas.ts` 등 | **에이전트 실행 금지** (봇 계정·데이터 변경) |
| 뉴스봇 실행 | `npm run worker:news` | **에이전트 실행 금지** (외부 RSS·LLM 호출) |
| ai-social 실행·1회 드라이런 | `cd ai-social && npm run dev` / `npm start` / `npm run draft -- --category <slug>` | **에이전트 실행 금지** (외부 RSS·로컬 LLM·goodfriends 호출). 검증은 `cd ai-social && npm test && npm run typecheck`(모킹) |

## 코드 규칙
- 기존 스타일 유지. 새 의존성 추가는 계획 단계에서 Bryan 승인
- Reafy에서 포크한 독립 프로젝트 — reafy 저장소 코드·DB와 섞지 않는다
- 새 함수엔 테스트, 버그 수정엔 회귀 테스트. 기존 테스트를 깨는 커밋 금지
- push는 Bryan 승인 (에이전트는 push 금지, 오케스트레이터도 커밋까지만). push해도 자동 배포는 없다 (GitHub Actions 워크플로 없음)
- 인프라 설정(`backend/docker-compose.yml`, `backend/deploy/`, 배포 스크립트) 변경은 계획에 명시

## 배포 (수동, Bryan 승인 필요)
- dev: 서버 계정(Mac Studio)에서 Bryan이 직접 처리 — 에이전트는 신경 쓰지 않는다
- 운영: 오라클 `ubuntu@129.159.47.244` (Reafy와 같은 서버), 저장소 체크아웃 `/opt/goodfriends`
  1. `cd /opt/goodfriends && git pull --ff-only`
  2. backend 변경: (의존성 바뀌면 `cd backend && npm ci`) → (마이그레이션 있으면 `npm run db:migrate`) → `sudo systemctl restart goodfriends-backend` → `curl -sf http://localhost:3020/api/health`
  3. frontend 변경: `cd frontend && (npm ci) && npm run build` → `sudo systemctl restart goodfriends-frontend` (:3021)
  - 뉴스봇·DB 백업은 운영 cron이 `/opt/goodfriends/backend` 소스를 직접 실행 → pull만으로 반영
  - 운영 `.env`·`.env.local`은 열지 않는다. Reafy 서비스(`/opt/reafy_*`, `reafy-*`)는 건드리지 않는다
- 사용자에게 보이는 문구는 한국어

## 비밀값 — 모든 에이전트가 열지 않는다 (구 "QA에 보내면 안 되는 파일")
- 기준(2026-11-14): 외부 모델(Claude·coder·qa)과 로컬 helper 모두 열지 않고, 프롬프트·`--file`에 넣지 않는다. 그 외 코드·로그·데이터는 모든 에이전트가 읽어도 된다
- `.env`, `.env*`(`.env.example` 제외), `*api_key*`, `ai-social/data/`(봇 계정·비밀번호·세션), DB 백업 파일(실사용자 개인정보 — 비밀값과 같이 취급)
- 이런 파일이 꼭 필요한 작업은 멈추고 Bryan에게 넘긴다 (helper도 대신하지 않는다)

## 읽지 않아도 되는 것
- `node_modules/`, `frontend/.next/`
