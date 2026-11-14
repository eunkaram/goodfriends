# AGENTS.md — goodfriends (AI 커뮤니티)

모든 에이전트(오케스트레이터·coder·qa·helper) 공통 규칙. 협업 절차: `/orchestrate` (전역).
개요는 `README.md`, 마일스톤·완료 근거는 `PLAN.md`, 세션별 기록은 `docs/`. `frontend/AGENTS.md`(Next.js 안내)도 따른다.

## 구조
- `backend/`: Node 20+ · TS 커스텀 http-server (API + WebSocket), PostgreSQL(+PgBouncer) + Redis (`backend/docker-compose.yml`, 127.0.0.1 바인드), `backend/worker/` 뉴스봇
- `frontend/`: Next.js 16 · React 19 · Tiptap
- 로컬 포트: backend 3011 · frontend 3012 · Postgres 5433 · PgBouncer 6433 · Redis 6380

## 명령 (각 폴더에서)
| 목적 | 명령 | 누가 |
|---|---|---|
| 의존성 | `npm ci` (node_modules 없을 때) | coder·helper |
| 테스트 DB | `cd backend && npm run db:up` (로컬 docker) | coder·helper (`db:reset`·`db:backup`은 **금지**, Bryan 요청 시만) |
| 단위·통합 테스트 | `cd backend && npm test`, `cd frontend && npm test` (vitest) | 모두 (QA 필수, 바뀐 쪽) |
| 타입 검사 | `npm run typecheck` (각 폴더) | 모두 |
| 화면 E2E | `cd frontend && npm run test:e2e` (backend가 :3011에 떠 있어야 함) | coder·오케스트레이터 (화면 흐름을 바꾼 작업이면) |
| 뉴스봇 실행 | `npm run worker:news` | **에이전트 실행 금지** (외부 RSS·LLM 호출) |

## 코드 규칙
- 기존 스타일 유지. 새 의존성 추가는 계획 단계에서 Bryan 승인
- Reafy에서 포크한 독립 프로젝트 — reafy 저장소 코드·DB와 섞지 않는다
- 새 함수엔 테스트, 버그 수정엔 회귀 테스트. 기존 테스트를 깨는 커밋 금지
- push는 Bryan 승인 (에이전트는 push 금지, 오케스트레이터도 커밋까지만). 자동 배포는 아직 없음 — VPS 배포는 `PLAN.md` M5
- 인프라 설정(`backend/docker-compose.yml`, 추후 생길 `.github/`·배포 스크립트) 변경은 계획에 명시
- 사용자에게 보이는 문구는 한국어

## 비밀값 — 모든 에이전트가 열지 않는다 (구 "QA에 보내면 안 되는 파일")
- 기준(2026-11-14): 외부 모델(Claude·coder·qa)과 로컬 helper 모두 열지 않고, 프롬프트·`--file`에 넣지 않는다. 그 외 코드·로그·데이터는 모든 에이전트가 읽어도 된다
- `.env`, `.env*`(`.env.example` 제외), `*api_key*`, DB 백업 파일(실사용자 개인정보 — 비밀값과 같이 취급)
- 이런 파일이 꼭 필요한 작업은 멈추고 Bryan에게 넘긴다 (helper도 대신하지 않는다)

## 읽지 않아도 되는 것
- `node_modules/`, `frontend/.next/`
