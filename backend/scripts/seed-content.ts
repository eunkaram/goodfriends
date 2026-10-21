/**
 * M5 시드 콘텐츠 — 개발 로그 시리즈 5편 + 쇼케이스 2편 + 꿀팁 4편 + Q&A 마중물 4건.
 * 1차 소스: docs/2026-10-18-19-worklog-m2-m3.md — 실제 배움·실측 수치에서만 쓴다.
 * 가짜 댓글·가짜 추천 다수는 만들지 않는다(마중물 답 1건만).
 */
export type SeedPersona = {
  key: 'kiryun' | 'noah' | 'dawn';
  nickname: string;
  email: string;
  password: string;
  birthdate: string;
};

export const PERSONAS: SeedPersona[] = [
  { key: 'kiryun', nickname: '기륜', email: 'kiryun@reafy-ai.dev', password: 'seed-dev-2026!ka', birthdate: '1992-03-14' },
  { key: 'noah', nickname: '노아', email: 'noah@reafy-ai.dev', password: 'seed-dev-2026!nb', birthdate: '1990-08-02' },
  { key: 'dawn', nickname: '새벽', email: 'dawn@reafy-ai.dev', password: 'seed-dev-2026!dc', birthdate: '1994-11-27' },
];

export type SeedPost = {
  key: string;
  author: SeedPersona['key'];
  categorySlug: string;
  title: string;
  body: string;
};

export const SERIES = {
  owner: 'kiryun' as const,
  title: 'AI 커뮤니티 만들기 — 실전 개발 일지',
  description:
    '4년 묵은 포크를 벗겨내고 바닥부터 다시 심은 기록. 권한 모델, 뉴스봇 파이프라인, 설정 하나가 프로세스를 죽이는 결함들까지 — 화면 뒤에서 무엇이 일어났는지.',
  postKeys: ['dev1', 'dev2', 'dev3', 'dev4', 'dev5'],
};

export type SeedAnswer = {
  postKey: string;
  author: SeedPersona['key'];
  body: string;
  adopt: boolean;
};

export const QNA_ANSWERS: SeedAnswer[] = [
  {
    postKey: 'q1',
    author: 'kiryun',
    adopt: true,
    body:
      '리밋 로직 자체는 src/rate-limit.ts의 Redis 고정윈도우 한 종류라 확장 요구는 없습니다. 진짜 문제는 키 문법(`lounge:{userId}`, `signup:{ip}` 같은 것)이 파일마다 흩어져 잊어먹게 되는 겁니다.\n' +
      '그래서 저희 방식: 전부 grep으로 끌어모아 표 하나로 문서화 — 지금 16개 키(라운지 10/60s, 댓글 30/h, 가입·로그인·비번재설정 각 5/IP/h 등). 새 리밋 넣을 때 표 한 줄 추가를 강제하는 게 리듬입니다.\n' +
      '보너스로 이 표가 장애 대응 때도 유용했어요 — "왜 429를 뿜지?" 질문이 들어오면 전표에서 10초 만에 정책을 역추적할 수 있습니다.',
  },
];

export const POSTS: SeedPost[] = [
  {
    key: 'dev1',
    author: 'kiryun',
    categorySlug: 'dev-log',
    title: '(1) 무에서 다시 서비스까지 — 4년 묵은 포크를 새로 심는 결정',
    body:
      '시작은 "어차피 고쳐 쓸 텐데?"였다. 이전에 운영하던 커뮤니티 프레임웍(Reafy)은 4년 동안 운영과 패치가 쌓여 있었고, fork를 뜯어보는 30분이면 결론이 나왔다 — 거기서 바꿔 쓰는 것보다 벗겨내는 게 노력이 덜 든다.\n\n' +
      '그래서 내린 결정 하나: 스키마(모델)와 배움은 이어받고, 코드는 한 줄도 이어받지 않는다. 테이블 정의와 운영 배움(작동 원리, 실패 이력, 테스트 전략)은 그대로 끌어오고, 논리·라우트·화면은 전부 새로 썼다. 유지보수 비용이 안 늘게 의존성을 backend/ 한 폴더 안에 밀어 넣었다.\n\n' +
      '차이가 가장 담백한 곳은 마이그레이션이다. 이전 프로젝트의 마이그레이션은 돌릴 때마다 20분씩 기다렸고 종종 터졌는데, 이번엔 52개를 몇 초에 심고 끝난다.\n\n' +
      '이 일지는 5편으로 쓴다 — RLS(2편), 뉴스봇 파이프라인(3편), 설정성 결함들(4편), 지금 배양 중(5편).',
  },
  {
    key: 'dev2',
    author: 'kiryun',
    categorySlug: 'dev-log',
    title: '(2) RLS부터 심는다 — 권한이 화면 뒤에서 일어나려면',
    body:
      '커뮤니티 서비스는 게시글 하나에 조회 권한이 얽힌다 — 팔로우/친구/차단/모더레이터 등. 이걸 화면 코드에 분기로 심으면 사고 대열이 무한하다. 이 프로젝트는 Postgres RLS를 제일 먼저 심었다 — 화면은 권한을 몰라도 조회 자체가 필터된 채 돌아온다. 화면이 실수하면 침묵으로 막힌다. "화면이 맞는데 권한이 뚫리는" 실수가 더 큰 사고다.\n\n' +
      '규칙 한 개는 깨지 않는다: 세션 변수는 반드시 트랜잭션 안에서 set_config(..., true)(is_local)로 주입한다. 세 번째 인자 true가 없으면 PgBouncer 트랜잭션 모드에서 다음 요청이 앞 사용자의 권한을 상속한다 — 화면상 아무 증상이 없다.\n\n' +
      '커넥션 역할도 격리시켰다 — 앱은 비소유 롤풀(app_exists/app_arrays)로만 붙는다. 소유자(community_owner)로 붙으면 FORCE ROW LEVEL SECURITY마저 무력화되어 조회는 필터 없이 넘어간다. owner 롤은 마이그레이션·배치 전용으로 고립했다. "화면이 멀쩡한데 권한이 파열된다" 실무 사례는 전부 실물 관찰이었다.\n\n' +
      '아쉬운 것 — 정책이 두 세트(배열 변형·EXISTS 변형)로 유지된다. 같은 논리를 두 곳에서 유지하는 건 부담이지만, 동일 SQL을 두 방식으로 쓰는 선택은 성능 트레이드오프 문제라 운영 실험으로만 해소될 문제다.',
  },
  {
    key: 'dev3',
    author: 'kiryun',
    categorySlug: 'dev-log',
    title: '(3) RSS → 중복제거 → 요약 → 발행: 하루 한 번의 자기복구 파이프라인',
    body:
      '커뮤니티의 제일 뿌리는 고민은 "빈 페이지에 글을 쓸 글러리를 모으는 것"이다 — 그래서 자동 콘텐츠로 뉴스봇을 심었다. 파이프라인: 8개 RSS 소스 수집 → 중복 제거(URL UNIQUE + 제목 trigram 유사도 문턱 0.85) → 7일 오래 원문 스킵 → 한국어 요약(LLM) → 봇 계정 발행.\n\n' +
      '실측하나: 어느 하루 사이클에서 fetched 2,435건 → 기록 44건 → 발행 5건. 절반 이상이 유사도 문턱에서 버려졌다. RSS는 과거 번들을 다시 주고, 같은 소식을 여러 소스가 따로 접수한다 — "같은 소식 다른 소스" 문제가 중복 제거의 본질이다.\n\n' +
      "설계의 뿌리 3개: ① LLM 키 없는 환경에서도 사이클은 돈다 — 결정적 stub 요약으로 유효, 후에 실제 LLM을 붙였을 때도 요약 출력 모양(krTitle/digest)이 stub과 같게 맞춰둬서 전환 시 후속 코드 변경 0. ② 소스 하나가 죽어도 사이클은 죽지 않는다 — failures만 세고, 실패는 기록, 운영자에게 알림(5분 이율)을 보낸다. ③ status = 'new'가 자기복구 — 이전 사이클 실패 항들도 다음 사이클에서 처리된다. \"소스 장애·LLM 실패가 있어도 다음 날 자기복구\"가 되는 이유.\n\n" +
      '튜닝 상수 2개: NEWS_MAX_PER_CYCLE, NEWS_PER_SOURCE_CYCLE. 배리어였던 실제 현상 — 한 소스(arXiv의 2천+ 건 피드)가 큐를 독식하면 다른 모든 소스가 기아. 소스당 캡 + 라운드로빈 병합으로 고쳤고, 테스트로 골고루 분산되는 것 검증. 단 arXiv 같은 초대형 소스는 캡으로만 드레인을 못해서 소스 축소/샘플링은 후속 운영 과제다.',
  },
  {
    key: 'dev4',
    author: 'kiryun',
    categorySlug: 'dev-log',
    title: '(4) 설정 하나가 프로세스를 죽인다 — 실전 크래시 3건의 해부',
    body:
      '이번 편은 실제 크래시 3건의 정리 — 전부 논리 버그가 아니라 설정/라이프사이클 문제였다.\n\n' +
      '① Postgres 커넥션 소진 — error 53300. DB 접근 팩토리가 Pool을 호출마다 돌려주고 아무도 안 끊는 설계에서, 워커가 RSS 아이템마다 호출하는 순간 커넥션 한도가 붕괴했다 — sorry, too many clients already. 고쳐주는 게 싱글턴 memoize + 워커 종료 시 풀 end(). 배움: "팩토리 함수가 리소스를 뱉는다"는 설계는 호출자가 반드시 되돌림 책임을 지지 않으면 그대로 누수가 된다.\n\n' +
      '② WS 프레임 리플레이 없음. 두 브라우저 테스트에서 A가 말해서 broadcast를 한 뒤 B가 웨이터를 붙이면 그 발言을 영영 지나친다 — 소켓은 새로 들어오는 프레임만 내보낸다. 이 때문에 히스토리(REST hydration)와 실시간 프레임의 양 경로가 따로 있어야 하고, 테스트는 발송 전에 모든 웨이터를 붙여야 한다. 무작위 실패처럼 보이는 것의 대부분이 타이밍이다.\n\n' +
      '③ next rewrites는 WebSocket upgrade를 프록시하지 않는다. 채팅 화면(:3011)과 ws 연결(:3010 직접)이 따로 간다. 쿠키는 포트 무시 매칭이라 통과했지만, 배포 TLS 뒤에서 쿠키 도메인 규칙이 달라질 수 있으므로 체크포인트는 문서에 별도 남긴다.',
  },
  {
    key: 'dev5',
    author: 'kiryun',
    categorySlug: 'dev-log',
    title: '(5) 씨앗을 심는 순간 — 시드 콘텐츠와 운영 전략',
    body:
      '개발은 "완성"에서 끝나지 않는다. 서비스가 처음 열릴 때 가장 중요한 건 빈 페이지를 보여주지 않는 것 — 그래서 이번 라운드는 시드 콘텐츠였다: 개발 일지 시리즈 5편, 쇼케이스 2편, 꿀팁 4편, Q&A 마중물 4건.\n\n' +
      '씨앗 규칙은 셋이다. ① 가짜 인기를 만들지 않는다 — 가짜 댓글과 추천 몰아주기는 신뢰를 부순다. 시드 계정은 일지를 쓸 3명뿐이다. ② 결함과 실측 수치는 숨기지 않는다 — 2,435→44→5, 53300, WS 프레임 스킴 같은 실제 배움만 기록한다. 성공 위주의 글은 일지가 아니라 광고다. ③ 마중물 질문은 답을 남겨둔다 — Q&A 4건 중 실제 답은 1건(채택 기능 시연)뿐, 나머지는 커뮤니티에 남긴 것이다.\n\n' +
      '다음 이슈는 배포다 — VPS에 docker-compose를 올리고 TLS를 붙이고, 백업 cron을 등록하고, 에러 알림을 실제 이메일로 받는 것까지. 이 일지는 여기서 잠시 쉰다. 커뮤니티는 이제 사용자 몫이다.',
  },

  {
    key: 'show1',
    author: 'kiryun',
    categorySlug: 'showcase',
    title: '서버 한 대로 돌리는 AI 뉴스 에디터 — 로컬 vLLM 붙인 파이프라인',
    body:
      'RSS 8개 소스를 수집 → 중복 제거(trigram 유사도 0.85) → 로컬 LLM 한국어 요약 → 커뮤니티에 자동 발행하는 파이프라인을 서버 한 대 위에서 돌리고 있습니다.\n\n' +
      '핵심 3단 — ① 수집기: 하루 fetched 2,435건 규모에서 기록 44건만 남기고 2,391건 버린다("같은 소식 다른 소스" 방어). ② 요약기: OpenAI 호환 /chat/completions만 말하는 프록시 — 현재 로컬 vLLM(Qwen3.5-9B-AWQ)에 물려 있고, LLM_BASE_URL/LLM_MODEL만 바꾸면 클라우드(OpenRouter 등)로 즉시 교체됩니다. 코드 변경은 전혀 없다. ③ 발행자: 소스당 캡 2건 + 사이클 상한 5건 — 소스 간 라운드로빈으로 고르게.\n\n' +
      ' 왜 로컬인가 — 클라우드 LLM은 매달 요금, rate limit, 데이터 외부 이동이 다 붙는다. 9B 양자화(4비트 AWQ) 모델은 요약 태스크에 충분했고, 요약 1건 실측 2~16초. thinking 모델의 추론 토큰 폭주를 max_tokens 상한 + 템플릿 kwargs(thinking off)로 잘 막아둔 것이 파이프라인이 깔끔하게 돌아가는 핵심 트릭이다.\n\n' +
      '현재 하루 발행 5~10건이다. 붙일 것 — 운영자 알림(ADMIN_ALERT_EMAIL), 소스 추가/축소 튜닝. 조절 요청은 댓글로.',
  },
  {
    key: 'show2',
    author: 'noah',
    categorySlug: 'showcase',
    title: 'Reafy 포크해서 소모임 커뮤니티 3주 운영한 회고',
    body:
      '저는 3주 전부터 Reafy 포크를 기반으로 스터디 소모임 커뮤니티를 운영하고 있습니다. 3주는 짧지만 운영만으로도 배울 점이 많았습니다.\n\n' +
      '1주차 — 온보딩이 절반이었다. 초대 링크를 준 뒤 참여자가 어디에 뭘 써야 할지 몰랐습니다. 참여자 5명 기준으로 카테고리를 공지·자유·Q&A·자료 4개만 남기고 나머지는 비공개로 덜었습니다. 작은 커뮤니티는 목록을 줄여야 산다.\n\n' +
      '2주차 — 알림 설정이 실 서비스의 밸런스다. 댓글 알림은 꺼도되는데 공지 알림은 필수였습니다. 기본값을 공지 필수, 댓글 꺼짐, DM은 친구에게만 세 가지로 고정했습니다.\n\n' +
      '3주차 — 백업은 언제나 무서운 것. 회의 도중 DB 컨테이너가 갑자기 재시작이 필요해져서 backup-db 스크립트를 cron에 넣었습니다. dump 주기는 하루 1회, 보존 7일이 5명 규모에는 충분합니다.\n\n' +
      '정리하자면 — 운영에서 겪는 문제는 코드보다 사람쪽입니다. 커뮤니티 소모임 운영의 실제 경험을 쓸 기회가 있으면 댓글로 주세요.',
  },
  {
    key: 'tip1',
    author: 'kiryun',
    categorySlug: 'ai-tips',
    title: 'Postgres RLS 실전 꿀팁 5가지 — 대부분은 FORCE 하나로 잡힌다',
    body:
      '멀티테넌 커뮤니티에서 RLS를 실제로 심어보며 얻은 것들, 다섯 개다.\n\n' +
      "1) FORCE ROW LEVEL SECURITY부터 걸어라 — 걸지 않으면 테이블 소유자에게는 정책이 적용되지 않는다. \"소유자 롤은 런타임에 절대 안 쓴다\"는 규칙과 함께 소유자 누설을 봉쇄한다.\n\n" +
      '2) 세션 주입은 set_config(..., true) — 트랜잭션 내 is_local로만. PgBouncer 트랜잭션 모드에서 다음 요청이 앞 사용자의 권한을 상속하는 사고(§: 화면엔 아무 증상이 없다)를 막는다.\n\n' +
      '3) owner 롤은 마이그레이션·배치 전용 — 런타임이 쓰면 정책이 소유자에게 무력화되어, 화면은 정상인데 권한이 통째로 열린다. 실무에서 이 사례가 꾸준히 나온다.\n\n' +
      '4) 직결 경로로 테스트 — 배치 테스트가 pgbouncer 우회로 직결하면 트랜잭션 모드의 G1 성격을 운영 환경에서만 터뜨리게 된다. 테스트도 반드시 같은 접근 경로.\n\n' +
      '5) 정책 서명은 SELECT/INSERT/UPDATE/DELETE 각각 분기해둔다 — 하나로 합치면 보완이 필요한 변경 때 다른 정책까지 실수로 풀린다.',
  },
  {
    key: 'tip2',
    author: 'noah',
    categorySlug: 'ai-tips',
    title: 'next rewrites가 WebSocket upgrade를 프록시하지 못하는 이유와 해결',
    body:
      'Next.js rewrites는 일반 HTTP는 흘려보내 주는데, WebSocket handshake(HTTP Upgrade 요청)는 통과시키지 못한다 — 따라서 프록시만 있으면 ws 연결이 안 만들어지고, 증상은 "채팅 접속이 안 된다"나 "가끔 끊긴다"다.\n\n' +
      '해결 패턴: UI와 REST는 프록시, 웹소캣만 백엔드 직결. ws://backend:port/ws/...로 프론트에서 직접 붙인다 — 쿠키는 포트를 무시하고 도메인만 보는 매칭이라 세션 검증이 그대로 통한다.\n\n' +
      '두 가지 여운: 로컬 HTTP에서는 문제가 잘 안 보이다(Secure 쿠키는 HTTPS 전용이라 RN fetch에서 쿠키가 아예 안 실린다). 배포 때 HTTPS가 붙으면 Secure 플래그가 켜진 쿠키에 ws 직결 경로가 통과할 수 있는지(도메인 매칭)를 반드시 점검하자.',
  },
  {
    key: 'tip3',
    author: 'dawn',
    categorySlug: 'ai-tips',
    title: 'RSS 중복 제거를 trigram Jaccard 0.85로 하는 이유',
    body:
      "봇 파이프라인이 원문을 하루에 어마무시한 양(실측: fetched 2,435 → 기록 44 → 발행 5)으로 줄여 나갈 때, 제일 큰 관문은 \"같은 소식, 다른 소스\"를 걸러내는 일이다.\n\n" +
      '전통적인 notch 방식(URL 등 가입 분석)은 같은 소식이 다른 제목·URL로 오면 실패하지만, 정규화된 제목 trigram Jaccard(=3-gram 토큰 교합도)에서는 0.85 이상이면 같은 소식으로 간주한다. 실제로 이 문턱에서 같은 소식 여러 소스가 걸려내어 소스 별 개별 기록이 44건 정도만 남았다.\n\n' +
      '주의사항이 하나 있다 — "Item #0"과 "Item #1"처럼 한 글자 차이인 합성 제목은 유사도 0.85 이상이 되어 중복으로 잘려나간다. 테스트 제목은 실제 문장처럼 서로 달라야 의미가 있다(실제 겪은 함정).',
  },
  {
    key: 'tip4',
    author: 'dawn',
    categorySlug: 'ai-tips',
    title: '로컬 vLLM을 OpenAI 호환으로 끼우기 — /no_think가 안 억제될 때',
    body:
      'Qwen 계열을 로컬 vLLM으로 띄울 때 제일 먼저 마주하는 구덩이: OpenAI 표준 body만으로는 thinking을 억제하지 못한다. /no_think를 시스템 프롬프트에 넣는 소프트 스위치는 이 배포가 무시했다 — 실측으로 확인했다.\n\n' +
      '해결 — 템플릿 kwargs: body에 chat_template_kwargs: {"enable_thinking": false}. vLLM 전용 확장 필드라 OpenAI 등 다른 서버는 거부할 수 있다 — 그래서 코드에 상수로 박는 게 아니라 env(LLM_EXTRA_BODY_JSON)로 주입한다(제공사별 확장 여부를 한 줄로 갈아끼운다).\n\n' +
      '그 다음 트릭 — max_tokens 상한: thinking 모델은 추론 토큰 폭주 시 60초 타임아웃으로 전 건 실패한다. 요약 1건은 800토큰이면 넉넉하다. 주의: thinking이 max_tokens로 잘리면 "Answer:" 구분선 없이 끊긴다 — 출력 파서가 구분선을 못 찾으면 빈 문자로 처리해 발행을 막는다(추론 노이즈는 절대 발행 금지).',
  },
  {
    key: 'q1',
    author: 'dawn',
    categorySlug: 'qna',
    title: 'rate-limit 키 전표(레저)는 어떻게 관리하고 계신가요?',
    body:
      "Redis 고정윈도우 리밋은 src/rate-limit.ts 하나라서 로직은 심플합니다. 진짜 문제는 쓰이는 키 문법(`signup:{ip}`, `lounge:{userId}` 등 16종)이 파일마다 흩어져서 \"어디에 무슨 리밋이 있지?\"가 무한 순환되는 것. 전표로 문서화하고 유지하는 리듬을 어떻게 세우고 계신지 공유 부탁드립니다.",
  },
  {
    key: 'q2',
    author: 'dawn',
    categorySlug: 'qna',
    title: '개인 서비스 Postgres 백업 — dump 주기와 보존 정책은?',
    body:
      '개인 서비스 Postgres 백업 — dump 주기(하루 1회?)와 보존(7일/30일/로컬+원격?)을 어디까지 해보셨나요? backup-db 스크립트는 이미 있고 cron 등록이 남았습니다. 특히 실패 시(데이터베이스가 안 뜰 경우 덤프가 자동적으로 admin 에러 알림과 결합되는 방식)의 실전 경험이 궁금합니다.',
  },
  {
    key: 'q3',
    author: 'dawn',
    categorySlug: 'qna',
    title: '배치 작업 cron vs 상주 --loop — 어느 쪽으로 갔나요?',
    body:
      'RSS 봇 같은 하루 1회 배치를 cron(외부 스케줄러)과 상주 --loop(인터벌) 중 어느 쪽으로 구성하셨나요? cron은 매 실행마다 프로세스와 커넥션을 새로 만들고, 상주는 설정 하나 잘못되면 몇일 동안 모르게 과부하가 늘어납니다. 실제 운영에서 어떤 이유로 무엇을 선택하셨는지 궁금합니다 — 장단점을 공유해주세요!',
  },
  {
    key: 'q4',
    author: 'noah',
    categorySlug: 'qna',
    title: 'RLS 환경에서 통계/캐시 연산 처리 — 어느 방식 추천?',
    body:
      'RLS 세션 주입이 걸려 있는 트랜잭션 안에서 통계성 연산(조회수 증가, 피드 카운트, 캐시용 집계)을 돌리면 성능이 자주 걸립니다. RLS 콘텍스트 내에서 캐시를 붙이려면 세션 변수가 캐시에 미치는 영향을 따로 결정해야 할 것 같은데, 어디까지 허용할 수 있는지 감이 없습니다. 조회수 같은 정적 쿼리는 캐시가 되는지, 통계 대상은 어떻게 분리(별도 통계 테이블이나 앱 메모리)하셨는지 — 경험을 정리해 주시면 많은 도움이 됩니다.',
  },
];
