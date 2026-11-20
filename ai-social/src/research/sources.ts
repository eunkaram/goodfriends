/**
 * 외부 리서치 소스 레지스트리. 여기 추가/수정/enabled 토글만으로 리서치 소스를 관리한다.
 *
 * 각 소스는 사이트별 로그인·연령인증 필요 여부, robots.txt(특히 AI 크롤러 명시 차단 여부),
 * 저작권 고지(예: "AI 학습 및 활용 금지" 같은 명시적 문구)를 2026-08-21에 직접 확인한 뒤에만
 * 등록했다. 새 소스를 추가할 때도 같은 기준으로 먼저 검증할 것 — 특히 한국 커뮤니티 대부분이
 * robots.txt에 GPTBot/ClaudeBot/CCBot 등을 이름으로 차단해두는 추세라(오늘의유머, 네이트판,
 * FM코리아, MLB파크, 클리앙, slrclub 전부 이 이유로 제외됨) robots.txt 확인은 필수.
 */

export interface ResearchSource {
  id: string;
  name: string;
  type: 'rss' | 'html_board';
  url: string;
  /** AgentPersona.interests / preferredCategories 값과 매칭되는 카테고리 태그 */
  categories: string[];
  enabled: boolean;
  encoding: 'utf-8' | 'euc-kr';
  /**
   * html_board 전용 — 게시글 목록에서 (링크, 제목, 있으면 썸네일 이미지)를 뽑는 정규식.
   * named capture group 사용: href(상대/절대 모두 가능), title(<a>...</a> 내부 원본 HTML —
   * 제목이 <font>/<img> 등으로 감싸져 있어도 됨, parseHtmlBoard가 태그를 벗겨냄), image(선택).
   */
  listPattern?: RegExp;
  /** html_board 전용 — listPattern이 상대경로를 캡처할 때 절대경로로 만들기 위한 prefix */
  linkBaseUrl?: string;
  /**
   * 개별 글/기사 페이지에서 실제 본문 컨테이너만 잘라내는 정규식. named capture group "body"
   * 하나만 씀 — 그 안의 텍스트/이미지/동영상을 원래 순서 그대로 뽑아 "퍼온글" 본문으로 쓴다
   * (parseArticleBody). 없으면 <meta name="description"> 발췌로 폴백.
   */
  bodyPattern?: RegExp;
  /**
   * true면 원문(또는 meta description 폴백)을 절대 "퍼온글"로 그대로 안 쓰고 항상 LLM이 새로
   * 써서(제목/본문 다 한국어로 번역+각색) 올리게 한다. 영어권 소스(slickdeals 등)용 — 그대로
   * 퍼오면 한국 커뮤니티에 영어 본문이 그대로 올라가버린다.
   */
  disallowVerbatim?: boolean;
}

export const RESEARCH_SOURCES: ResearchSource[] = [
  // --- RSS (표준 RSS 2.0, UTF-8, robots.txt에 AI 크롤러 차단 없음 확인됨) ---
  {
    id: 'etnews-rss',
    name: '전자신문',
    type: 'rss',
    url: 'https://rss.etnews.com/Section901.xml',
    categories: ['tech'],
    enabled: true,
    encoding: 'utf-8',
    // bodyPattern이 없으면 <meta name="description">로 폴백하는데, 전자신문은 그 description
    // 자체가 CMS에서 문장 중간에 잘려 있어(직접 확인함) 포스팅이 "...이" 같은 식으로 끊겼다.
    // 실제 기사 페이지 확인: <div class="article_body " itemprop="articleBody" id="articleBody">
    // 바로 다음 </div>가 정확히 본문 끝(광고/연관기사는 그 밖에 있음), 안에 <figure><img></figure>가
    // 사진 위치에 그대로 섞여 있어서 parseArticleBody가 순서 보존해서 뽑아낸다.
    bodyPattern: /itemprop=["']articleBody["'][^>]*>(?<body>[\s\S]*?)<\/div>/i,
  },
  // 한국경제(hankyung.com) RSS 3종(IT/경제/연예)은 robots.txt는 허용이지만 실제로는 Cloudflare
  // 봇 차단(JS Challenge, "Just a moment...")에 걸려 curl은 통과해도 Node fetch는 403을 받는다.
  // 이 챌린지를 우회하는 시도(TLS/헤더 스푸핑 등)는 하지 않기로 해서 소스에서 제외했다.
  // (2026-08-21 직접 확인: 표준 브라우저 Accept/Accept-Language 헤더를 추가해도 동일하게 403.)

  // --- 커뮤니티 게시판 HTML ---
  // 뽐뿌는 EUC-KR 인코딩이라 반드시 TextDecoder('euc-kr')로 디코딩해야 한다 — UTF-8로 그냥 읽으면
  // 한글 제목이 전부 깨진다(직접 확인함). robots.txt는 /zboard/ 경로 전체 허용, AI 크롤러 차단 없음.
  // 마크업이 지저분해서(공지/광고 행은 class="baseList-title" 큰따옴표, 실제 게시글 행은
  // class='baseList-title' 작은따옴표를 섞어 쓰고 제목이 <font>로 감싸져 있음) 정규식이 둘 다
  // 허용하고 <a>...</a> 내부 전체를 캡처해서 parseHtmlBoard에서 태그를 벗겨내는 방식으로 짰다.
  //
  // 2026-09-07: prod(오라클 클라우드) IP에서 홈페이지부터 403이 남(UA를 브라우저로 바꿔도 동일,
  // curl/WebFetch 양쪽에서 재현) — robots.txt/UA 문제가 아니라 IP/ASN 단위 차단으로 추정.
  // 이 소스는 원래 한국 IP(사내망)에서 검증됐던 거라, 그때는 됐고 지금 prod에선 안 되는 상황.
  // 계속 켜둬봤자 매번 타임아웃만 날리니 비활성화 — 대체 핫딜 소스는 eomisae-shopping 참고.
  {
    id: 'ppomppu-free',
    name: '뽐뿌 자유게시판',
    type: 'html_board',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?id=freeboard',
    categories: ['chat', 'humor'],
    enabled: false,
    encoding: 'euc-kr',
    listPattern: /<a\s+class=['"]baseList-title['"]\s+href=["'](?<href>view\.php\?id=freeboard[^"']*)["'][^>]*>(?<title>[\s\S]*?)<\/a>/,
    linkBaseUrl: 'https://www.ppomppu.co.kr/zboard/',
    // 실제 글 페이지에서 확인함: <td class='board-contents' ...>내용</td> — 첫 </td>가 정확히
    // 본문 끝(그 다음부터 댓글/네비게이션). 안에 <p>로 문단 구분, <img>/<video><source>가
    // 사진·동영상 위치에 그대로 섞여 있어서 parseArticleBody가 순서 보존해서 뽑아낸다.
    bodyPattern: /class=['"]board-contents['"][^>]*>(?<body>[\s\S]*?)<\/td>/i,
  },
  // 최근 글 표본 확인 결과 정치 시사 비중이 매우 높음. 정규식 기반 세이프티 게이트로 걸러내기
  // 어려운 카테고리라 기본 비활성화 — 켜기 전에 content-gate.ts 확장을 먼저 검토할 것.
  {
    id: 'ppomppu-issue',
    name: '뽐뿌 이슈게시판',
    type: 'html_board',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?id=issue',
    categories: ['issue'],
    enabled: false,
    encoding: 'euc-kr',
    listPattern: /<a\s+class=['"]baseList-title['"]\s+href=["'](?<href>view\.php\?id=issue[^"']*)["'][^>]*>(?<title>[\s\S]*?)<\/a>/,
    linkBaseUrl: 'https://www.ppomppu.co.kr/zboard/',
    bodyPattern: /class=['"]board-contents['"][^>]*>(?<body>[\s\S]*?)<\/td>/i,
  },
  // UTF-8, robots.txt AI 크롤러 차단 없음. RSS는 못 찾아서 뉴스 리스트 HTML 직접 파싱.
  // 목록에 썸네일(class="cols thumb" 안의 <img>)이 같이 나와서 image 그룹으로 같이 캡처한다.
  {
    id: 'inven-news',
    name: '인벤 웹진뉴스',
    type: 'html_board',
    url: 'https://www.inven.co.kr/webzine/news/',
    categories: ['hobby', 'tech'],
    enabled: true,
    encoding: 'utf-8',
    listPattern:
      /href="(?<href>https:\/\/www\.inven\.co\.kr\/webzine\/news\/\?news=\d+)"[\s\S]{0,100}?class="cols thumb"><img[^>]*src="(?<image>[^"]+)"[\s\S]{0,300}?class="cols title">(?<title>[^<]{4,120})/,
    // 실제 기사 페이지에서 확인함: <div ... itemprop="articleBody">내용</div> 바로 뒤에
    // <script>가 옴 — 그 경계로 자른다. <figure><img></figure>가 본문 중간중간에 섞여 있음.
    bodyPattern: /itemprop=["']articleBody["'][^>]*>(?<body>[\s\S]*?)<script/i,
  },
  // 여행/레저 카테고리용(2026-09-07 추가). WAUG(와그, 한국 여행 액티비티/투어 플랫폼)는
  // robots.txt에 ClaudeBot/GPTBot 등을 이름으로 명시하면서 오히려 Allow(전용 /llms.txt까지
  // 제공) — AI 크롤링을 환영하는 몇 안 되는 사이트. 매거진 콘텐츠는 Next.js CSS 모듈이라
  // class명이 배포마다 바뀌는 해시(예: MagazineCard-module-scss-module__leKYta__card)라 그걸
  // 정규식에 직접 안 쓰고, 안 바뀌는 <a title="..." href="/ko/magazines/숫자"> 구조만 잡는다.
  {
    id: 'waug-magazine',
    name: 'WAUG 매거진',
    type: 'html_board',
    url: 'https://www.waug.com/ko/magazines',
    categories: ['travel'],
    enabled: true,
    encoding: 'utf-8',
    listPattern: /<a[^>]*title="(?<title>[^"]{4,150})"[^>]*href="(?<href>\/ko\/magazines\/\d+)"/,
    linkBaseUrl: 'https://www.waug.com',
  },
  // 핫딜/쇼핑 카테고리용(2026-09-07 추가). 뽐뿌는 이 서버(오라클 클라우드) IP에서 아예 403이 나서
  // (홈페이지부터 차단, UA 바꿔도 동일 — IP/지역 차단으로 추정) 대체 소스로 검증함.
  // UTF-8, robots.txt 일반 크롤링 허용(AI 크롤러 이름 차단 없음, Crawl-delay: 5만 지정),
  // 저작권 고지에 AI 학습 금지 문구 없음. 남성 패션·해외직구 중심 커뮤니티라 일반 잡화보다는
  // 신발/의류/직구 핫딜이 많다.
  {
    id: 'eomisae-shopping',
    name: '어미새 쇼핑정보',
    type: 'html_board',
    url: 'https://eomisae.co.kr/fs',
    categories: ['hotdeals'],
    enabled: true,
    encoding: 'utf-8',
    listPattern: /<a class=["']pjax["']\s+href="(?<href>\/fs\/\d+)">(?<title>[^<]{4,120})<\/a>/,
    linkBaseUrl: 'https://eomisae.co.kr',
  },
  // 미국 핫딜/아마존 소스(2026-09-07 추가). robots.txt가 RSS 전용 경로(/deal-feed/*,
  // newsearch.php?*rss=*)만 막고 프론트페이지 자체는 안 막음 — sitemap.xml도 공개돼 있고 AI
  // 크롤러 이름 차단도 없음. 영어 소스라 본문을 그대로 퍼오면 한국 커뮤니티에 영어 글이 올라가
  // 버리니 disallowVerbatim으로 항상 LLM이 한국어로 새로 쓰게 한다(제목/스니펫만 재료로 사용).
  {
    id: 'slickdeals-frontpage',
    name: 'Slickdeals 프론트페이지',
    type: 'html_board',
    url: 'https://slickdeals.net/',
    categories: ['hotdeals'],
    enabled: true,
    encoding: 'utf-8',
    listPattern: /<a href="(?<href>\/f\/\d+-[a-zA-Z0-9-]+)\?src=frontpage" target="_self" class=["']dealCard__title["'][^>]*>(?<title>[^<]{5,150})<\/a>/,
    linkBaseUrl: 'https://slickdeals.net',
    disallowVerbatim: true,
  },
];

/**
 * 검증했지만 이번 1차 구현에서 제외한 소스 (사유는 각 항목 참고, 재검토 시 참고할 것):
 * - 네이버 뉴스: RSS 서비스 자체 종료, 무료 대안 없음.
 * - 연합뉴스 RSS: 실제로 작동하지만 <copyright> 태그에 "AI 학습 및 활용 금지"가 명시돼 있어 제외.
 * - 한국경제(hankyung.com) RSS 3종: robots.txt는 허용이지만 Cloudflare JS Challenge에 막혀 Node
 *   fetch로는 항상 403 — 우회 시도(TLS/헤더 스푸핑, 헤드리스 브라우저로 챌린지 통과 등)는 하지 않음.
 * - 클리앙 자유게시판 / slrclub 자유게시판: robots.txt가 anthropic-ai/Claude-Web/GPTBot/CCBot 등
 *   AI 크롤러를 이름으로 차단(slrclub은 사이트 전체 Disallow: /). 우회하지 않음.
 * - 오늘의유머 / 네이트판 / FM코리아 / MLB파크 (클리앙 대체 후보로 조사): 전부 동일한 이유로 탈락.
 * - missyusa 연예게시판: robots.txt는 허용이지만, 로그인 없이 요청하면 실제 게시글 목록 대신
 *   로그인 폼만 담긴 셸 페이지가 내려옴 — 세션/쿠키 없이는 스크래핑 불가로 판단, 보류.
 * - 유튜브 트렌드: 키 없는 트렌딩/검색 스크래핑은 YouTube ToS 위반 소지, Google Trends RSS도
 *   폐기됨(404) — 무료·키 불필요 조건을 만족하는 대안 없음.
 */
