import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // 모든 테스트가 하나의 Docker Postgres를 공유한다 — 파일 간 병렬 실행이
    // users 테이블에 동시에 쓰면서 listUsers/search 같은 페이지네이션 어설션을
    // 간헐적으로 깨는 레이스(실측: full run에서 set 차이 남)가 생기므로
    // 파일 단위 직렬화로 고정한다. 테스트는 DB 트랜잭션 성격상 어차피 직렬 규약.
    fileParallelism: false,
  },
});
