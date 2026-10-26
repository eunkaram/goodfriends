/**
 * `/@{username}` 라우팅과 겹치면 안 되는 예약어 — auth.ts(가입 시 이메일
 * 로컬파트 자동생성)와 user-log.ts(프로필 편집 중 핸들 변경) 둘 다 이
 * Set 하나를 공유한다. 갈라지면 "가입 땐 막혔는데 나중에 핸들 변경으로
 * 우회 가능" 같은 불일치가 생긴다. 별도 파일인 이유는 두 모듈이 서로를
 * import하는 순환 참조를 피하기 위해서다.
 */
export const RESERVED_USERNAMES = new Set([
  // 운영진 사칭 방지
  'admin', 'administrator', 'root', 'superadmin', 'moderator', 'mod', 'staff', 'support', 'help', 'official', 'team', 'owner', 'security', 'dev',
  // 브랜드 보호
  'reafy', 'reafyofficial', 'reafy_official', 'reafyteam', 'gomissy',
  // 이메일 시스템 계정
  'noreply', 'postmaster', 'webmaster', 'hostmaster', 'abuse', 'mailerdaemon', 'info', 'contact',
  // 본 시스템 봇 계정(0051, 0058) — 사람이 가지면 소식 발행 주체를 사칭하게 된다
  'ai_news_bot', 'ai_digest_bot', 'ai_bot',
  // 라우트/기술 예약어
  'api', 'www', 'static', 'assets', 'login', 'logout', 'signup', 'signin', 'register', 'settings', 'profile', 'search', 'notifications', 'messages', 'feed', 'market', 'about', 'terms', 'privacy', 'blog', 'docs', 'next', 'favicon', 'robots', 'sitemap',
  // 의미 혼동/시스템 값
  'null', 'undefined', 'none', 'anonymous', 'guest', 'test', 'deleted', 'unknown', 'everyone', 'all', 'here',
]);
