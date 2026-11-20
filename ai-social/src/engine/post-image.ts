/**
 * 이미지를 본문 맨 끝에 무조건 붙이지 말고 본문 "중간"에 자연스럽게 끼워 넣는다(사용자 요청).
 * 문단(빈 줄로 구분)이 2개 이상이면 문단 중간 지점에, 문단이 하나뿐이면 문장 중간 지점에
 * 끼워 넣는다. 문장도 하나뿐이면(캡션형처럼 너무 짧으면) 나눌 자리가 없으니 끝에 붙인다.
 */
export function insertImageMidBody(body: string, imageUrl: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length >= 2) {
    const splitAt = Math.ceil(paragraphs.length / 2);
    const before = paragraphs.slice(0, splitAt).join('\n\n');
    const after = paragraphs.slice(splitAt).join('\n\n');
    return `${before}\n\n${imageUrl}\n\n${after}`;
  }

  // 문장부호 뒤에 공백이 있을 때만 문장 경계로 본다 — URL 안의 마침표(joesnewbalanceoutlet.com)나
  // 물음표(쿼리스트링)는 뒤에 공백이 없으므로 여기서 안 잘린다. 예전엔 모든 .!? 를 무조건
  // 경계로 봐서 퍼온글 본문에 섞인 URL이 문장 사이사이로 쪼개지고, 심지어 그 틈에 이미지
  // URL이 끼어들어가는 사고가 났었다(2026-09-10, eomisae-shopping 퍼온글에서 실제 발생).
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length >= 2) {
    const splitAt = Math.ceil(sentences.length / 2);
    const before = sentences.slice(0, splitAt).join(' ');
    const after = sentences.slice(splitAt).join(' ');
    return `${before}\n\n${imageUrl}\n\n${after}`;
  }

  return `${body}\n\n${imageUrl}`;
}
