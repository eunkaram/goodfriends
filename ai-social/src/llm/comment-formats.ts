/**
 * 댓글도 글과 똑같은 문제를 겪는다 — 아무 지시 없이 두면 모델이 통계적으로
 * 가장 흔한 형태("원글 내용 재진술 → 내 비슷한 경험 → 다음엔 ~해보세요" 3줄)로 수렴한다.
 *
 * 2026-09-14 prod 피드 감사에서 실측: 댓글 50개 중 34개가 정확히 3줄, 43개가 줄 끝에 마크다운
 * 개행용 공백 2칸을 달고 있었고, 한 글에 달린 댓글 7개 중 6개가 같은 문장("그 물병을 들어 올린
 * 손이 얼마나 무거웠을지…")으로 시작했다. 그래서 글과 동일하게 매번 형식을 하나 못박는다.
 */
export interface CommentFormat {
  id: string;
  label: string;
  /** systemPrompt에 그대로 삽입되는 한국어 지시문 */
  instruction: string;
}

export const COMMENT_FORMATS: CommentFormat[] = [
  {
    id: 'one-liner',
    label: '한줄반응',
    instruction:
      '한 문장으로만 쓰세요. 20자 안팎이면 충분합니다(예: "이거 진짜 공감", "아 나도 어제 똑같은 일 겪음"). 설명이나 부연을 붙이지 마세요.',
  },
  {
    id: 'me-too',
    label: '경험맞장구',
    instruction:
      '본인이 겪은 비슷한 일을 한두 문장으로 툭 던지세요. 교훈이나 정리로 마무리하지 말고 그냥 겪은 얘기만 하고 끝내세요.',
  },
  {
    id: 'question',
    label: '질문',
    instruction: '글에서 궁금한 지점 딱 하나만 짧게 물어보세요. 칭찬이나 공감 인사말을 앞에 붙이지 마세요.',
  },
  {
    id: 'pushback',
    label: '딴지',
    instruction:
      '가볍게 다른 의견을 내거나 토를 다세요. 한두 문장이면 됩니다. 인신공격은 하지 말되, 억지로 동의해주지도 마세요.',
  },
  {
    id: 'add-info',
    label: '정보추가',
    instruction: '원글에 없는 구체적인 정보나 팁을 딱 하나만 보태세요. 공감 표현 없이 바로 본론으로 들어가세요.',
  },
  {
    id: 'joke',
    label: '드립',
    instruction: '가벼운 농담이나 드립 한 줄로 받아치세요. 진지한 해석이나 감상은 붙이지 마세요.',
  },
  {
    id: 'quote-react',
    label: '부분반응',
    instruction:
      '글 전체가 아니라 특정 구절 하나에만 반응하세요. 그 부분을 짧게 언급하고 거기에 대해서만 한두 문장 쓰세요.',
  },
  {
    id: 'tangent',
    label: '곁가지',
    instruction:
      '글의 main 주제가 아니라 지나가듯 언급된 사소한 부분(장소, 물건, 시간대 같은 것) 하나만 붙잡고 그 얘기만 하세요. 정작 글쓴이가 하려던 말에는 반응하지 마세요. 실제 커뮤니티에서 아주 흔합니다.',
  },
  {
    id: 'off-topic',
    label: '딴소리',
    instruction:
      '글을 읽다가 떠오른 본인 얘기로 새세요. 원글과 느슨하게만 연결돼도 됩니다. 마지막에 원글로 돌아와 정리하지 마세요.',
  },
];

export function pickCommentFormat(): CommentFormat {
  return COMMENT_FORMATS[Math.floor(Math.random() * COMMENT_FORMATS.length)];
}
