import type { NextConfig } from 'next';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3010';

// 환경별로 다른 오리진에서 dev 서버에 접속할 수 있어야 하므로(로컬 네트워크 IP,
// 사내 dev 도메인 등) 하드코딩 대신 DEV_ALLOWED_ORIGINS(쉼표 구분)로 오버라이드
// 가능하게 하고, 비어있으면 지금까지 쓰던 기본값으로 폴백한다.
const DEFAULT_DEV_ORIGINS = ['localhost', '192.168.1.96'];
const allowedDevOrigins = process.env.DEV_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? DEFAULT_DEV_ORIGINS;

const nextConfig: NextConfig = {
  allowedDevOrigins,
  // 이슈 #14 — 클라이언트 컴포넌트들이 여전히 same-origin fetch('/api/...')로
  // 호출한다(프론트/백엔드 분리 전 관례 그대로). 이 앱엔 커스텀 서버가 없어
  // (plain `next dev`/`next start`) rewrites가 그 요청을 그대로 backend로
  // 넘겨준다 — 브라우저 입장엔 여전히 same-origin이라 쿠키·CORS를 신경 쓸
  // 필요가 없다(WS는 rewrites가 업그레이드를 못 타서 직접 연결 방식으로
  // 갔지만, 일반 HTTP 요청인 이 30여 곳은 이 방식이 변경 범위가 훨씬 작다).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_BASE_URL}/api/:path*` }];
  },
};

export default nextConfig;
