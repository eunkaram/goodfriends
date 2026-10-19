/** 이 앱(reafy_frontend) 자신의 공개 URL — robots.ts/sitemap.ts의 절대경로 조립에 쓴다. */
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3011';
}
