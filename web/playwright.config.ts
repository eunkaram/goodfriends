import { defineConfig } from '@playwright/test';

/**
 * 이슈 #13에서 정한 방향 — 페이지 레벨(서버 컴포넌트 데이터 페칭 + 실제 API
 * 통합)은 E2E로 검증한다. `lib/*.ts` 유닛 테스트(vitest, tests/lib/)와 달리
 * 이 테스트들은 실제 backend가 로컬(:3010)에 떠 있어야 한다 — README의
 * 로컬 개발 전제(둘 다 띄워야 함)와 같다. Playwright가 알아서 띄워주는 건
 * web(webServer)이고 backend는 동일 repo의 backend/ 디렉터리라 여기서
 * 기동시키지 않는다(개발자가 미리 띄워둔다고 가정).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.APP_BASE_URL || 'http://localhost:3011',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: process.env.APP_BASE_URL || 'http://localhost:3011',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
