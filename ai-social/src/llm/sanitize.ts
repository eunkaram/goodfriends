/**
 * 일부 로컬 LLM 서버(특히 Ollama 커스텀 모델 태그)는 stop 시퀀스 설정이 불완전하면
 * 자유 텍스트(jsonMode=false) 응답에서 채팅 템플릿 특수 토큰이나 추론(reasoning) 블록을
 * 그대로 흘려보낸다 — 실제로 2026-08-17 라이브 세션에서 댓글에
 * "...실제 댓글 내용<|endoftext|><|im_start|>user\n<|im_start|>assistant\n<think>\n\n</think>\n\n..."
 * 형태로 새어나가 커뮤니티에 그대로 게시된 적이 있다. 관찰된 패턴은 항상 "진짜 내용이 먼저
 * 오고, 마커 이후는 모델이 이어서 지어낸 가짜 턴"이므로 첫 마커 등장 지점에서 자르면 된다.
 */
const LEAK_MARKERS = ['<|endoftext|>', '<|im_start|>', '<|im_end|>', '<|system|>', '<|user|>', '<|assistant|>', '<think>', '</think>'];

export function sanitizeLlmText(text: string): string {
  let cutIndex = text.length;
  for (const marker of LEAK_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && idx < cutIndex) cutIndex = idx;
  }
  // 줄 끝 공백 2칸은 마크다운 강제 개행 문법 — 모델이 습관적으로 붙인다. 2026-09-14 prod
  // 피드에서 댓글 50개 중 43개가 이걸 달고 있었고(사람이 쓴 글엔 0건) 사실상 봇 서명이었다.
  return text.slice(0, cutIndex).replace(/[ \t]+$/gm, '').trim();
}

/**
 * U+FFFD(REPLACEMENT CHARACTER)는 잘린/깨진 멀티바이트 시퀀스를 디코더가 강제로 채워 넣은
 * 흔적이다. 2026-08-21 라이브에서 "'???델 가족' 하면..." 처럼 고유명사 일부가 박스 문자로
 * 깨진 채 게시된 걸 확인함 — 모델이 드문 외래어/고유명사를 생성하다 토큰 경계에서 멀티바이트
 * 문자가 잘린 것으로 보임. 중간에 이런 문자가 하나라도 있으면 그 텍스트는 통째로 재생성
 * 대상으로 처리한다(부분만 잘라내는 sanitizeLlmText와 달리, 어디가 원래 뭐였는지 복구 불가).
 */
export function hasEncodingCorruption(text: string): boolean {
  return text.includes('�');
}
