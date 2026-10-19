import { existsSync } from 'node:fs';
const env = process.env.NODE_ENV || 'development';
// 우선순위 순서대로 목록 정의 (Next.js 표준 규칙)
const files = [
  `.env.${env}.local`,
  `.env.${env}`,
  '.env.local',
  '.env',
];
for (const file of files) {
  if (existsSync(file)) {
    try {
      // Node 내장 loadEnvFile은 이미 주입된 환경변수를 덮어쓰지 않으므로
      // 우선순위가 높은 파일부터 순서대로 로드하면 됩니다.
      process.loadEnvFile(file);
    } catch {
      // 로드 실패 시 무시
    }
  }
}