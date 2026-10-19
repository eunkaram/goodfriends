/**
 * 닉네임(표시 이름) 차단 — username과 달리 자유 텍스트라 한글도 그대로
 * 들어간다. `RESERVED_USERNAMES`(reserved-usernames.ts)와는 별도다:
 * username은 [a-z0-9_]만 허용해 애초에 한글이 불가능하고, 여긴 정반대로
 * 한글 문구가 주 대상이다.
 *
 * 두 카테고리는 매칭 방식이 다르다:
 *  - 사칭(RESERVED_NICKNAMES): 완전일치만 차단. "관리자김철수"처럼 정상
 *    닉네임에 우연히 포함된 경우까지 막으면 오탐이 너무 잦다.
 *  - 욕설(PROFANITY_SUBSTRINGS): 포함되면 차단. 욕설은 "안녕씨발하세요"처럼
 *    앞뒤에 글자를 붙여 우회하는 게 흔해서 완전일치로는 못 막는다 — "시발점"
 *    같은 무해한 단어까지 걸리는 오탐을 감수하는 쪽을 택했다(사용자 확인).
 */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

const RESERVED_NICKNAMES = new Set(
  [
    // 운영진 사칭 방지 (한글)
    '관리자', '운영자', '운영팀', '매니저', '모더레이터', '어드민', '고객센터', '고객지원', '공식', '공지', '공지사항', '시스템', '봇',
    // 브랜드 보호 (한글)
    '레피', '레피공식', '레피운영팀', '리피', '리피공식',
    // 의미 혼동
    '탈퇴한사용자', '알수없음', '익명',
    // 운영진 사칭 방지 (영문) — 닉네임은 자유 텍스트라 영문도 그대로 들어간다
    'admin', 'administrator', 'official', 'moderator', 'staff', 'support', 'system', 'reafy', 'reafyofficial',
  ].map(normalize),
);

// 시작 목록 — 필요하면 계속 추가한다. 완곡어·초성 우회(ㅅㅂ 등)는 다루지 않는다(오탐/유지비 대비 효과가 낮음).
const PROFANITY_SUBSTRINGS = [
  '씨발', '시발', '병신', '개새끼', '새끼', '좆', '지랄', '미친놈', '미친년', '걸레', '창녀', '개소리', '닥쳐', '꺼져',
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger',
].map(normalize);

export function isReservedNickname(nickname: string): boolean {
  const normalized = normalize(nickname);
  if (RESERVED_NICKNAMES.has(normalized)) return true;
  return PROFANITY_SUBSTRINGS.some((word) => normalized.includes(word));
}
