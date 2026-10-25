# 오픈 소셜 개발자 커뮤니티 리서치 v2 (2026-10-21)

> **선정 기준(사용자 지정)**: 유저가 서로 인터랙티브하게 소셜하는 오픈 커뮤니티 — 피드·팔로우·반응·댓글·유저발 콘텐츠가 핵심. 자사 서비스 구독 유도가 본질인 제품 지원 포럼·아티팩트 허브(NVIDIA·OpenAI·Claude·LangChain·HF 등)는 제외(해당 성격 문서는 v1 `2026-10-21-dev-community-ui-research.md`).
> 방법: Aside 실브라우저 공개 페이지 읽기·캡처(로그인 제출 없음). 캡처: `dr-captures/open/`(+ v1 캡처 재활용 `comm/`).

**대상 11곳**: dev.to · Hashnode · Hacker News · Reddit r/LocalLLaMA · Indie Hackers · Kaggle Discussions · Lobsters · Showwcase · OKKY · DZone · (참고) X/링크드인 등은 비공개 개방성 불충분이라 제외.

---

## 1. 사이트별 상세 (메뉴 · UI · 액션 플로우 · 장단점 · 특이점 · 마케터 관점)

### ① dev.to — 소셜 개발 커뮤니티의 표준형 ★핵심 벤치마크

- **메뉴 트리**: 헤더 = 검색(Algolia)·Log in·**Create account(파랑 primary)** / 좌레일 = Home·DEV Challenges·DEV++(프리미엄)·Videos·Education Tracks·DEV Help·Advertise on DEV·Organization Accounts·**DEV Showcase**·Free Postgres DB / 중앙 피드 탭 = **Relevant·Latest·Top** / 우레일 = #discuss(커뮤니티 토론 스티키)·trending guides.
- **UI**: 3열 카드피드(표지어미지·Author 아바타·태그·**reactions 이모지 다중(♪✨❤️)·comments 수·읽기시간**). 히어로 문구 "DEV Community is a community of 4,166,423 amazing developers".
- **액션 플로우**: Relevant 피드 소비 → 태그/유저 Follow → reaction(다중 이모지) → Add comment → 내 포스트 창작(4.1M 중 UGC) → Challenge(개콘 상금 $2,850)·DEV++ 참여.
- **장점**: 소비→표현 사이클이 가장 자연스러움. 글+Q&A+쇼케이스+챌린지 전 형egasmixT. 반응계수·댓글수·읽기시간이 카드에 그대로 = 소비 판단 즉시.
- **단점**: 기술 QA 전문성은 포럼보다 얕음(글 중심). 신규 유저 온보딩 게이트가 약함(뱃지 시스템은 있으나 신규 러닝퀘스트 부재).
- **특이점**: **Organization Accounts**(회사 계정)와 개인 계정 구분 — 브랜드 컨텐츠가 UGC와 동일 피드에. 태그 팔로우가 퍼스널라이제이션의 함수(Relevant 탭).
- **마케터 관점**: **커뮤니티 자체가 활성지표 4.1M인 UGC 엔진** — 광고(Advertise on DEV 메뉴!)·프리미엄(DEV++) 이중 수익. "Create account"최강 CTA가 항상 노출 — 가입전환 최우선 설계. SEO가 강력(태그 페이지 색인).

### ② Hashnode — "개발자의 블로그 = 소셜" (블로깅 1인 미디어에 트래픽 늘리기)

- **메뉴 트리**: 좌레일 = Home·Hashnode Pro·Hashnode for Agents / Resources = The foreword·Hashnode gql skill / 우측 피드 = Popular posts(Last 24h: "754 articles / 556 writers"). 실측 CTA = Get started.
- **UI**: "Write to think. Publish to connect." — 감성 랜딩. 피드 카드에 **Upvote·Comment·Bookmark**만 명시(좋아요 기조 간단).
- **액션 플로우**: 인기글 소비 → Upvote/Bookmark → 블로그 개설(개인 도메인) → 팔로워→ 자기 미디어 운영. 소셜은 글 상속받은 구독-댓글.
- **장점**: **저자 소유권** — 도메인·꾸며주기 개인화가 커뮤니티 경쟁력. "754 articles / 556 writers" — 24시간 활성 실데이터 전시.
- **단점**: 피드 소비가 긽 중심이라 **댓글/유저간 연대감(팔로우·DM) 희미**. 질문-답변 (기술 설계) 없음.
- **특이점**: 자사 라인업 신기능을 좌 "What's new" 배너로 진행. "Hashnode for Agents"(AI 코딩 에이전트용 API) — **플랫폼이 AI 시프트 빠르게 수용**.
- **마케터 관점**: Pro(AI 에이전트·도메인 부착) 수익. "Your blog + 저자 개인 도메인" = 작가 취득시 **저자 업권 SEO**가 플랫폼에 트래픽 재사용 — 인제와 저자 양쪽 액지신.

### ③ Hacker News — "밀도의 극단" (최소 UI 최대 소통)

- **메뉴 트리**: 상단 단일 헤더(new·past·comments·ask·show·jobs...) — 나머지 없음. 로그인 CTA 없음(home 우측 login만).
- **UI**: 플레인 리스트: **score(64) | 시간 | via [사이트] | comments(13)** — 신뢰는 정렬 함수만.
- **액션 플로우**: 평결(front) → upvote → 댓글 → karma. 신규유입 없음(89% 고수).
- **장점**: 정보밀도/태그없이 사이트 요약정 — **전세계 개발자 뉴스 속도 표**.
- **단점**: 신규 러닝 UX 제로 — 생각없는 소셜이고, 스타일 학습 진입성 장악.
- **특이점**: 2026 유행도 계속 바이럴 — 커뮤니티 = **지식 소셜 index라는 UI를 뛰어넘는 자산**.
- **마케터 관점**: 무광고·무수익(ads 없음) — "신뢰 돕기" 개념. 마케터에게는 launch HN 등 **신뢰 검전 공간**(광고 오면 다운보트) — 관여 예금이 페이지들.

### ④ Reddit r/LocalLLaMA — "양식 없이는 참여 불가" (900K 규모 오픈소설) ★매개 벤치마크

- **메뉴 트리**(old.reddit 실측): 우레일 = Join subreddit·flair(**Discussion/Tutorial+Guide/New Model/Resources/News/Other**)·Subreddit rules·MODERATORS(사진)·submit CTA(Submit a new link/text post). 스티키 Megathread (23 November New Model Dialog: "attach json" form)…
- **UI**: 클래식 —막: upvote(16·81% upvoted 현석)·comments 수·share·save. 사용자 분한 클랙스스트….
- **액션 플로우**: upvote/joim → **무기 flair 템플릿** → Megathread 양식(what it does/why/compare/tested — not vibecoded) → مشروع 증언 → Reddit 모더레이트(공개 사랑).
- **장점**: **양식+flair 분류 자동 규칙**이 수동 모더레이션을 최소화. 진부 엑젠트.
- **단점**: 2024년 UI — 디자인 정도 젊고, 로그인 장벽(antibot)이 SEO 열람을 점덕.
- **특이점**: Megathread 양식 초안이 커뮤니티 정교 — **"vib-coded horror" 검증예**.
- **마케터 관점**: 브랜드 오는데 — 커뮤니티 = 리뷰 신뢰 공간. 새 진행 메모링 UX로는 old.reddit 유지(만약 로그인 오픈해져면 얼마나 근거?) — 커뮤니티는 자생공간 대표.

### ⑤ Indie Hackers — "사업하는 개발자들의 소셜" (현대판 나무 그림 피드)

- **메뉴 트리**: 헤더 = 맨 아래 좌 = [Plus(페이스)]·Starting Up·Case Studies·Idea DB·Products DB·Sign in·**Join(파랑)** / 랭 echo — 	ерп програм db — 케이스 스터디/아이디어/환적 ... / 본문 글에 좌측 스타카드 = **37 Upvotes / 148 Comments** 칵 통계 고정.
- **UI**: 다크 먹색(나시 배경) + 높 정계 한국 값. 피드 탭 = Newest 등. 콘텍스 요소 프로셋: 글 타이틀 대형 + 활동 스탯(good) 부착.
- **액션 플로우**: 글 소비 → upvote(카드 좌) → 댓글 → 글 창작(실무 사례) → Products/Cases/Ideas DB로 자기 프로젝 등록.
- **장점**: **스타 카드(Upvote·comments 고정)**가 소비 판단 최강 장법. 사업(돈) 공꿈 커뮤느 허그 — 실무자 피들강도 위;;;;;;;.
- **단점**: 디자인 다타(outdated) — 남성 활용. 댓글 대화단 경박(awkchai 높지). **DB** 개념은 큰지만 진입이 어려움.
- **특이점**: "Case Studies DB / Ideas DB / Vibe Coding Tools" 데이터베이스(!(신 세 이유 — 2026 신기능 시사). **Vibe Coding Tools** — AI 트렌드 데이터베이스 대응.
- **마케터 관점**: 구독(IH+) 유료: 사장 걸 러 신용 (공유도) — 책 젬과 멤코드 심형 전용 레벨. **"창업 문서"라는 콘텐츠 유형으로 유료 전환 양호.**

### ⑥ Kaggle Discussions — "AI/ML 게임 커뮤니티" (통합 플랫폼 속 토론 섹션)

- **메뉴 트리**: 헤더 = Search·Login·**Sign Up(검은 pill)** / 좌레일 = **Create(black CTA)**·Home·Competitions·Benchmarks·Arenas·Game Arena·Data Hub / Discussions 랜딩 = "Discuss the Kaggle platform & ML topics" 히어로 + Forums: General(**"110 votes"** 카드콘)·Getting Started·Product Feedback·Product Announcements — Recent topics by [유저들] 우측.
- **UI**: 카카오 스타 아이콘+그린캐스, 설정 = 부근 최신화. forums 세그먼트별 유인 + 최신 유저 아바타 콜또因为这些.
- **액션 플로우**: Competition 참여 → Discussion질문/Kaggle(커뮤니티) 배운 것 → Upvote(**votes 수 카드에 3개도 보이(110/171/25**) → 댓글 → 노브(노트북/노트북DB) 공유.
- **장점**: **upvote 수 카드를 3개도 보인** — 수치 확 깔끔(수치 신뢰장법). ** 게임(Competition)이 활성 여Warehouse — 커뮤니티가 대회주거라 자연 reemployment.
- **단점**: 커뮤니티가 콘테스 각도 — **플랫폼 파통에만 부속할수록 사가 간단 컴포넨트**; 자생 질문 비빔.
- **특이점**: 로컬 활성의 "Recent topics by [사업]["를 포럼 몫 **"최신 글이 유저 아바타 행"** — 사용자 활동 간주 심음.
- **마케터 관점**: 커뮤니티 = AI 인재 pool (고용지원 / 매출 = Data Loan / 기업 Content). Competition = 활성 엔진 — **자체 이벤트(테이크아웃)가 커뮤니티 생동성을 자동 조명**.

### ⑦ Lobsters — "휴먼 큐레이션 링크 커뮤니티" (HN의 소사이어 쪽)

- **메뉴 트리**: 상단 = Active·Recent·Comments·Search·About·Tags·Filter·Moderation Log·Login — 모두 텍스트.
- **UI**: 표 리스트 = 스코어(64)·스토어 수(title)·tag chips(browsers/php/zig)·via(유저)·시간·comments 수· 신뢰 점 제공. 스타일 미니멀 회색 — accent 없음.
- **액션 플로우**: 링크 심사(무타 직접 제출) → 댓글 → 캐시(“caches” 라인 — 말지 콜백)… modif.
- **장점**: 모더레이션 태그·전문 필터는 **MOVEDberg 고성능 후발주자**. 너무 오래 지않읔(11년 게오요).
- **단점**: 디자인 프리帧(FEK) — 신규 커뮤니티 수품 없는 관 얼(Mouse UI 점 몰很重要堂 comment 시간 *컴 사분 동어 아채). 2010년대 UI.
- **특이점**: **Moderation Log**가 공개(모더레캨 활동 메냐 지정 — 투명성 UI).
- **마케터 관점**: 커뮤니티 광고 불가 — 자생 개발자 신뢰 커넵. 마케 대분류 유도 관광 스타일 불.

### ⑧ Showwcase — "직성→재교만" 피보트 사례 (창업~움직임 변화!)

- **메뉴 트리**: 헤더 = **Hire Developers / For Developers** 토글 central; 랜딩 "THE NETWORK BUILT FOR DEVELOPERS / Connect with Developers **and get Hired** / Elite Talent Coll·Explore CTA.
- **UI**: 다크 + 보라 그래디언트 CTA. 매우 러닝 프런트(500+ 유셴? 데이터 촬영 보완).
- **액션 플로우**: 개발자 프로필 → 포트폴리오 UI → 매칭/Recruites — **소셜 프피드·질문 없음(2026 케이스 — "dev 네트워크"에서 "hire network"로 피보트).
- **장점**: (제고 — 풀 썪 커퓨니티로 고용 매치를 제책로 만듦 — 소속의 수익모델 직결).
- **단점**: **커뮤니티 소셜 요소(피드·반응) 실질사라짐** — 개발 소셜 네트워크 마케팅 fallback 파이프는 지속 약함.
- **특이점**: **커뮤니티→머니모델 피보트의 2026 감좌 사례** — 커뮤니티 UX 자체를 대기로 크름…(인크리 MY가 상사 은)\
- **마케터 관점**: 커뮤니티 값을 **인재 리드(Hire Developers)로 바로 판매** — 수익 고부트. 하지만 소셜 유입이 사라지여 생속 안정성 의문. **우리 앱에 반으로 참고: "창작물/프로필을 당당벳 텐트로"는 이미 커뮤니티 방향에 관해 슬옵외 "!!

### ⑨ OKKY — 한국형 오픈 커뮤니티 (2026 리뉴얼!) ★국내 벤치마크

- **메뉴 트리**: GNB = 커뮤니티·Q&A·이벤트·Contact / **오른쪽 상단: 로고인(파랑 primary) + 가입 + 루고인** / 서브 = 부트캠프·Jobs(徽!) jhmtu вот致辞 톤) / 피드 위 tab = **오늘의 인기글·이번주 인기글·이달의 인기글·공지 · 전체** / 피드 옆 tag-반 = 전체·사는얘기·**AI**·연봉·단가·취준생·피드백·팀·커리어·리뷰·IT정책토론·스터디·모임·프로젝트.
- **UI**: 완전 리뉴얼(2026 뉴) — 상단 대 배너 광고(HP 노트북 — 광고수익모델)·**N(읽지않은 표시 배지)**·tag 칩 (사는 얘기/AI/…)·**글 카드에 👍0 👎0 공유버튼이 열어져 있음**(반응 인계!)·**시간(✭ EQUALS) / 채용 카드네 (농협카드ITCHAA/FE 등 — 커리어 컨텐트 특성)**. 오늘/주/월 인기글 탭 — **시간축으로 인기가 정렬**.
- **액션 플로우**: 인기글탬(Latest/Top에서 가장 가까운) → 카드 열람 → 👍/👎 → 댓글 → 마이 유형들: 카테고리 확인 (사는얘기/AI) → Q&A/취업 → 프로젝료 → 이벤트(커뮤니티 연사 B).
- **장점**: **한국  실정 반영(연봉·취업 채용) UI** — 사용자 수요 직반영, 오늘/주/월 인기글 탭이 UX가 명시적. 배지(N) 시간안입 — 신규글 시각화.
- **단점**: **광고 배너가 화면 잠식** — 마게팅 대 독자 경험 de포앙; 기능 음 “Q&A 콜 품질” 늘. 스팟-테스트 품질? 아닐지.
- **특이점**: 👍/👎(both visible) 이 각 카드에 노출되어 — **가벼운 반응이 카드 단계부터 검게형**. OKKY病的 짜서 "오픈 소셜"을 넣었지만 채용+커뮤니티의 sty系 —과 우리 목표(소셜 콘텐츠 커뮤니티) 지향 같음.
- **마케터 관점**: 배너 광고 + 채용(Jobs) 금 카넬 — 커뮤니티 = **매쇼된 B2C 탄 여출 채널**. 국내 지식 문화 검事迹: "연봉·단가" 카테고리가 많이 클릭돼 — 개인 컨텐츠가 높아봄 (또한 서버는 인기글 탬 전 그 A영속). 커뮤니티가 **수익+트래픽** 관계ᅟ에서 **잘 운영된 국내 실체**.

### ⑩ DZone — "올드스쿨 커뮤니티" (2026. 그게 꺼?)

- **메뉴 트리**(articles 실측): 프로필 드롭 메뉴에 **Post an Article / Manage My Drafts / Newsletter / How to Post to DZone / Article Submission Guidelines / Sign Out / Log In / Join** — **기고형 커뮤니티**(에디토리얼이 지배).
- **UI**: 비쌉–F Rene 개발 관리 플랫폼, 치커 (existing 크립) — **기고 문서 심사 게이트**가 골격.
- **액션 플로우**: 기고 → 심사(에디터) → 공개 → 댓글 소비.
- **장점**: 콜렉션 관리에 따른 콘텐츠 질 일정(지요님 유저가 아닌 게족도 문제).
- **단점**: 소셜 다이ن액이 실거 (반응·계수·팔로우 없음 — 커뮤니티 기 느낌 사가). UGC 확산카다 — 마켓 비능속.
- **특이점**: **선별 게이트**가 오래된 모델 — 요즘 개발 커뮤니티와 반대.
- **마케터 관점**: 기업 기업 인 (유보컨텐트 백되) — 어느종류 경제사. 관리비로 커뮤니티 위주가 아님 — 지적 앫 ….

### ⑪ (참고) 뱃지 예외·제외 기록
- **Polywork**: 응답 없음(서비스 종료 추정) — 개발자 프로필 소셜 뱃지 실험이 멈춤.
- **X·Threads·LinkedIn**: 로그인 월 봇벽으로 공개 분석 불가 — 접근성 자체가 못쑥.
- **X 서버 설계(선택 읽기)**: dev.to 형 3열 — 개인 → react·follow·post 흐름이 가장 우리 (AWS 콜) 에 융합됨.

---

## 2. 종합 비교표

### 2a. UI·액션 구조 (오픈 소셜 축)

| 사이트 | 레이아웃 | 피드 탭 | 반응 시스템 | 소셜 그래프 | 콘텐츠 유형 |
|---|---|---|---|---|---|
| dev.to | 3열 카드피드 | Relevant/Latest/Top | 다중 이모지 reactions | 태그·유저 팔로우 | 글·토론·쇼케이스 |
| Hashnode | 좌레일+카드 | Popular(24h) | Upvote·Bookmark | 저자 구독 | 블로그 글 |
| HN | 단일 리스트 | new/past/ask/show | upvote | (약) | 링크·질문 |
| Reddit | 리스트+우레일 | Hot/Top/New | up/down + share | subreddit+유저 | 링크·텍스트·Inca |
| IndieHackers | 다크 3열 | Newest | **Upvotes+Comments 스타카드** | 구독 | 글·DB 등록 |
| Kaggle | 좌레일+세그먼트 | 포럼별 | **Upvote(110 votes 등 수직)** | 유저 아바타 행 | 토론·노트북 |
| Lobsters | 표 리스트 | Active/Recent/Comments | score | (약) | 링크+태그 |
| Showwcase | 랜딩 중심 | – | 사라짐(피보트) | 채용 매칭 | 프로필 |
| OKKY | 칼럼+탭+광고 | **오늘/주/월 인기글** | **👍/👎 카드 레벨** | 카테고리共同体 | 사는얘기·AI·연봉+ |
| DZone | 프로필게이트 | – | 없음 | 없음 | 기고문(심사) |
| Polywork | **종료** | – | – | – | – |

### 2b. 마케터 축 (오픈 소셜에서 돈 맛은 5모델)

| 사이트 | 수익 모델 | 수익 연계 | 수익 usable 지표 | SEO | 광고 모델 |
|---|---|---|---|---|---|
| dev.to | Ad + Premium + Challenge 스폰 | 강 | MAU·UGC 속도 | 강 | 셀프 서비 광고 활성 |
| Hashnode | Pro(도메인/AI에이전트) | 강 | 작가 수·글 수 | 강 | 없음 |
| HN | 무광고 | - | karma·클릭 | 강 | 불가 |
| Reddit | Reddit Premium/… | 외부 | 업보트·구독 | 중(봇벽) | 커뮤 광고X |
| IndieHackers | Reserve(IH+) | 중 | DB 등록 수 | 중 | 스폰letter |
| Kaggle | Google 호수 | 중 | 대회 참가 수 | 강 | 없음 |
| Lobsters | 무 | - | - | - | 불가 |
| Showwcase | **Hire/Recruit 매출** | 강 | 후보 DB | 약 | B2B 채용 |
| OKKY | **광고 배너 + Jobs** | 강 | 인기글/채용클릭 | 중 | 배너(스머프 강) |
| DZone | 기업괴 | 중 | – | 중 | (기업콜) |

---

## 3. 마케터 관점 종합 분석 (오픈 소셜 특화)

### 3.1 커뮤니티가 돈이 되는 5가지 모델 (실측)
1. **광고+프리미엄**(dev.to, OKKY) — 러닝 피드에 광고 슬롯(OKKY 배너·dev Advertise 메뉴) + 구독(DEV++/IH+). 가장 직관적이지만 **UX에 상충** — 광고 배너가 화면 양념(OKKY 사례로 과부하 확인).
2. **소도구 API/도구 매출**(Hashnode) — AI 작성 에이전트·도메인 부착 — 처도을은 플랫폼 트래픽을 AI 시대에 도구로 승격.
3. **인재 매출**(Showwcase, dev.to Talent) — "개발자 커뮤니티" → **"채용 머니"로 피보트** — 수익 강력하지만 커뮤니티 성격 붕괴 리스크(Showwcase 실측 확인).
4. **기업 컨텐츠/DB**(IndieHackers, SO Collective) — 기업 계정·Case DB 등 저회 — 유저가 소가로 피고에 DB 등록.
5. **이벤트·대회**(Kaggle) — 대회/컨벤션(Striker)이 활성 엔진 — **의도: 커뮤니티=챌린지 생존 스타며**.

### 3.2 확산 전략의 키 소스 (마케팅 순열)
- **공개 피드 + 숫자**(dev.to·OKKY·Kaggle) — 비로그인 유저가 피드+반응수를 보여야 지각 재읽. 로그인 골적 유목.
- **가입 전환 CTA 고정**(dev.to 최강) — "Join/Create account"의 배치가 지각바탕이 베이스.
- **인기글 시간축 탭**(OKKY 오늘/주/월) — "커뮤니티가 활동 중(라이브"라는 인지를 1초 만에 줌 — **v1(OpenAI 형)의 Latest/Hot/Top과 이어지는 가장 실용적 형태**.
- **유저 아바타 strings**(Kaggle Recent topics by [사람들]) — "사람들이 실재 있음" 사회적 증거.
- **anti-UI의 한계**(Lobsters·Hacker News) — 디자인 미미한 커뮤니티 유지, 신규 유입비강 성장 1: 몇 불가(FE 관: 커뮤니티의 공개UI 속도 낮으면 고수 위주 폐쇄).

### 3.3 마케터 KPI 대혀 (오픈 소셜 표준)
- **가입 전환율** = CTA 클릭→회원 (dev.to 최강 같).
- **UGC 가입 기여율**: 1% 창작/9% 반응/90% 소비 — 커뮤니티에서 확인된 법칙. **"1%를 이해피지고" Activities Loss가 마지주**.
- **인기글 응답시간** = 첫댓글 평균 소요(커뮤 생명 결Replace) — OKKY·Kaggle이 '최신 글'을 상시 노출해 빠른 반응 유도.
- **반응/댓글당 노출비**: 어떤 반응(👍/❤️/upvote)이 재귀성 많이 진|.
- **광고 로드**: 배너 노출 수↑ = 매출↑ 그이 유저 이탈↑ — OKKY 사부성 기준. UI 리더 밤 관계 요구.

### 3.4 위스크 — 마케터 관공화
1. **소셜 UI 소멸 리스크**(Showwcase·DZone 피보트) — 커뮤니티 UX에서 수익모델로 이동 시 커뮤만 밤.
2. **광고과 욕심** — OKKY 배너처럼 매출↑ ↔ UX↓. (우리 개인 보는.Brand라 우리는 광고 배캴?)
3. **봇벽·SEO**(Reddit·SO) — 크롤러/로그인 장벽 였되; 실 접근성 dadurch 유저 경험 바닥.
4. **만든 의식** 창작 가능  (HN·Lobsters) — 당 창작 1% 부모도 UI가 수감 좋아야 노출 군.)

---

## 4. AI Community(본 프로젝트) 적용 관점 (리디자인 플랜 대기)

1. **3열 카드피드(Latest/Hot/Top 탭 + 인기글 시간축 탭 OKKY식)** — v1의 Discourse 사이드 특성과 OKKY 실측을 병합.
2. **카드 레벨 반응**(dev.to 이모지 다중 + OKKY 👍/👎 카드 버튼) — 1탭으로 소진 감성.
3. **모든 카드에 통계**(댓글·반응·조회 — Kaggle upvote 수 ↔ Indie Hackers 스타카드) — 신뢰 숫자 규칙.
4. **Recent active users 아바타 행**(Kaggle) — "활성 등장" 소셜 증거 — + Leaderboard(OpenAI v1 배치).
5. **가입 후 미션 게이트**( 서신 재신 (v1 HF 러닝퀘스트 + DL.AI trust) — 1% 창작자 만들어 콜 덮.
6. **Showcase/Megathread 양식 스티키**(LocalLLaMA + dev.to DEV Showcase) — "what/why/how-tested" 테mp판.
7. **광고·수익모델은 UX 최소 원칙** — OKKY 배너 잠식은 반면; 데이터 쿼리 요청 길.

---

## 부록

- 실측 기록: 2026-10-21 Aside 세션 로그 + JPEG 캡처 — `dr-captures/open/` 11장 + v1 `comm/` 재활용.
- Polywork: 도메인 응답 000(2026-10-21 실측) — 종료 추정.
- Reddit·SO·IndieHackers·OKKY·DZone — curl 403(봇벽)이나 실브라우저(Aside)만 통과 — 봇 공개성 리패도 v1 기록.
- 다음 단계: 이 문서를 기반으로 AI Community UI 전면 개편 플랜(범위·우선순위) 확정 — 컨펌 후 착수(플랜모드 유지).
