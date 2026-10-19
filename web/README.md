# reafy_frontend

Next.js SSR/UI 레이어 — Reafy(Gomissy 리부트)의 프론트엔드. 2026-09-03 프론트/백엔드 분리 결정에 따라 [gomissy.com](https://github.com/eunkaram/reafy.com)에서 `app/`·`components/`·`assets/`·`styles/` 등을 그대로 이전했다. DB·Redis에 직접 접근하지 않고, 모든 데이터는 [reafy_backend](https://github.com/eunkaram/reafy_backend)의 HTTP API를 호출해서 받는다.

## 현재 상태 — 재배선 완료, 빌드 정상

`app/`·`components/`의 서버 컴포넌트가 쓰던 `../src/*.ts`(gomissy.com의 백엔드 코드, DB 직접 호출) import는 전부 `lib/`의 `reafy_backend` API 클라이언트 호출로 교체됐다. WS 클라이언트도 `reafy_backend`에 직접 연결하고, 클라이언트 컴포넌트의 same-origin `fetch('/api/...')`도 `next.config.ts` rewrites로 `reafy_backend`에 프록시된다(GitHub 이슈 #1~#14). 세션 쿠키 도메인 공유(배포 시 서브도메인 분리 대응)도 `reafy_backend`#8에서 끝나서, 로컬·배포 양쪽 다 인증 경계 이슈가 없다. `npx tsc --noEmit`/`npm run build`/`npm test`/`npm run test:e2e` 전부 통과하고, `npm run dev`로 실제 페이지가 `reafy_backend` 데이터로 정상 렌더링된다.

## 환경 설정

`.env.example`을 복사해 `.env.local`로 쓴다(Next.js가 자동으로 읽음, 커밋 금지). `API_BASE_URL`/`NEXT_PUBLIC_API_BASE_URL`(reafy_backend 주소), `APP_BASE_URL`(이 앱 자신의 공개 URL, robots/sitemap용), `PORT`, `DEV_ALLOWED_ORIGINS`까지 전부 여기서 환경별로 바꾼다 — 소스에 도메인·포트를 하드코딩하지 않는다.

```
cp .env.example .env.local
```

## 개발

```
npm install
npm run dev   # 기본 :3011 — reafy_backend(:3010)와 별도 포트, 로컬에서 둘 다 띄워야 함
```

## 테스트

```
npm test          # lib/*.ts 유닛 테스트(vitest) — 백엔드 없이 돔
npm run test:e2e  # 페이지 E2E(Playwright) — reafy_backend가 :3010에 떠 있어야 함
```
