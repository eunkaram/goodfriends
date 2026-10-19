/**
 * 번역 키 → 한국어 문자열 (§9.3 "카테고리명·UI 문자열은 번역 키로 관리").
 *
 * 지금은 로케일이 한국어 하나뿐이라 별도 i18n 라이브러리 없이 이 딕셔너리 +
 * t() 함수로 충분하다. 로케일이 늘어나면 이 파일 옆에 en.ts 등을 추가하고
 * t()가 요청 로케일에 따라 딕셔너리를 고르게 하면 된다 — 호출부(카테고리
 * 테이블의 name_key, 컴포넌트의 t('...'))는 바뀌지 않는다.
 */
export const ko: Record<string, string> = {
  // §3.1 4대분류 — 🔒 사용자 지시(2026-08, "커뮤니티 카테고리를 정리를
  // 하고 싶어") — 예전 7대분류(테크·가족 그룹 포함)를 4개로 정리(0033).
  'category.talk': '토크',
  'category.life': '라이프',
  'category.culture': '컬쳐',
  'category.career_money': '커리어 & 머니',
  'category.market': '마켓',

  // 토크
  'category.daily_chat': '자유·일상',
  'category.issues': '정치·이슈',
  'category.humor': '유머',

  // 라이프
  'category.health_fitness': '건강·운동',
  'category.fashion_beauty': '뷰티·패션',
  'category.cooking': '음식·요리',
  'category.pets': '반려동물',

  // 컬쳐 — 테크·AI가 예전 테크 그룹에서 이쪽 하위로 흡수됐다
  'category.broadcast': '연예·방송',
  'category.travel': '여행·레저',
  'category.tech_ai': '테크·AI',
  'category.hobby': '게임·취미',

  // 커리어 & 머니
  'category.investing': '재테크·투자',
  'category.deals': '핫딜·쇼핑',
  'category.career': '커리어',
  'category.startup': '창업·N잡',

  // 마켓 하위
  'category.moving_sale': '무빙세일',
  'category.baby_items': '유아용품',
  'category.furniture_living': '가구/생활',
  'category.clothing_accessories': '의류/잡화',
  'category.electronics': '가전/디지털',
  'category.market_books_edu': '도서/교육',
  'category.sports_leisure': '스포츠/레저',
  'category.cars': '자동차',
  'category.real_estate_rent': '부동산/렌트',
  'category.wanted_giveaway': '구해요/드려요',

  // ─── AI 커뮤니티 taxonomy (backend 0049) ───
  'category.learn': '배우고',
  'category.build': '만들고',
  'category.share': '나누는',

  'category.ai_news': 'AI 뉴스',
  'category.ai_topics': '오늘의 AI 화제',
  'category.ai_tips': '활용 노하우',
  'category.qna': 'Q&A',
  'category.research': '논문·리서치',

  'category.large_models': '대형 모델',
  'category.ideas': '아이디어',
  'category.dev_log': '개발 로그',
  'category.showcase': '프로젝트 쇼케이스',
  'category.open_models': '로컬·오픈 모델',
  'category.gen_media': '이미지·영상 생성',

  'category.free_chat': '자유게시판',
  'category.collab': '협업 찾기',
};

export function t(key: string): string {
  return ko[key] ?? key;
}
