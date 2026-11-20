/**
 * 콘텐츠 세이프티 게이트 — 1차 구현은 정규식/키워드 기반만(LLM 판정 제외, Eng 리뷰 결정).
 * 이유: 게이트 자체를 로컬 LLM(32% 에러율)으로 판정하면 게이트 신뢰성이 검증 안 된 채로
 * 남고, LLM 필터를 거친 "안전한" 말투가 페르소나 목소리를 서로 비슷하게 만듦(homogenize).
 * 정규식/키워드는 결정론적이라 테스트하기 쉽고 오탐률을 관찰하며 확장 가능.
 */

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

const PII_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: '전화번호', regex: /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/ },
  { name: '이메일', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  { name: '주민등록번호 형식', regex: /\d{6}[-\s]?[1-4]\d{6}/ },
  { name: '카드번호 형식', regex: /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/ },
];

// 독성 키워드 — 시작점(정규식/키워드 기반, LLM 판정 제외). 오탐/누락 관찰하며 팀이 직접 확장할 것.
const TOXIC_KEYWORDS: string[] = ['시발', '개새끼', '병신', '지랄', 'ㅅㅂ', 'ㅄ'];

// 브랜드세이프티: 커뮤니티 톤과 안 맞는 민감 주제 예시. 필요에 맞게 조정.
const BRAND_UNSAFE_KEYWORDS: string[] = ['자살', '마약', '도박'];

/**
 * fail-closed 설계: 이 함수 내부에서 예외가 나면 항상 safe:false를 반환한다.
 * 세이프티 체크가 고장났을 때 콘텐츠를 통과시키는 게 아니라 막는 쪽으로 기울어야 함.
 */
export function checkContentSafety(text: string): SafetyCheckResult {
  try {
    if (!text || text.trim().length === 0) {
      return { safe: false, reason: '빈 콘텐츠' };
    }

    for (const pattern of PII_PATTERNS) {
      if (pattern.regex.test(text)) {
        return { safe: false, reason: `PII 감지: ${pattern.name}` };
      }
    }

    for (const word of TOXIC_KEYWORDS) {
      if (text.includes(word)) {
        return { safe: false, reason: `독성 키워드 감지: ${word}` };
      }
    }

    for (const word of BRAND_UNSAFE_KEYWORDS) {
      if (text.includes(word)) {
        return { safe: false, reason: `브랜드세이프티 키워드 감지: ${word}` };
      }
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, reason: `세이프티 게이트 내부 오류로 차단(fail-closed): ${err.message}` };
  }
}
