/**
 * reasoning(thinking) 출력 처리.
 *
 * 로컬 mlx-serve(Qwen3.8) 프로브 결과(2026-11-20):
 * - `chat_template_kwargs: { enable_thinking: true }` → 응답 message에 `reasoning_content` 필드가 별도로 붙고
 *   `content`는 최종 답만 담긴다(<think> 태그는 content에 안 섞임). enable_thinking 생략/false → reasoning_content 없음.
 * - max_tokens가 작아 thinking 도중 끊기면 `content: ""`, `finish_reason: "length"`, reasoning_content만 있음.
 * - 다른 서버(vLLM 일부 템플릿)는 content에 `<think>…</think>`를 섞어 보내므로 그것도 제거한다.
 * 교훈(backend/src/llm.ts stripThinking): thinking이 잘린 응답을 본문으로 쓰면 추론 스케치가 발행된다 → 실패로 처리.
 */

export class ReasoningTruncatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReasoningTruncatedError';
  }
}

export interface ChatChoiceLike {
  message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
  finish_reason?: string | null;
}

/** content에서 <think>…</think> 블록을 제거. 닫는 태그가 없는 <think>가 남으면 잘린 것으로 보고 throw. */
export function stripThinkTags(content: string): string {
  let text = content;
  // 여는 태그 없이 </think>만 있는 경우(템플릿이 <think>를 프롬프트에 넣음): 마지막 </think> 뒤만 취한다.
  if (!/<think>/i.test(text) && /<\/think>/i.test(text)) {
    text = text.slice(text.search(/<\/think>(?![\s\S]*<\/think>)/i) + '</think>'.length);
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (/<think>/i.test(text)) {
    throw new ReasoningTruncatedError('reasoning이 닫는 태그 없이 끝났다(토큰 상한 가능성)');
  }
  return text.trim();
}

/**
 * 응답 choice → 최종 답 텍스트.
 * reasoning=true일 때만 <think> 제거 + 답이 비었거나 finish_reason이 length면 thinking 잘림 → throw.
 * reasoning이 아니면(옵션 생략 포함) content를 그대로 돌려준다(기존 호출 동작 불변).
 */
export function extractChatContent(choice: ChatChoiceLike | undefined, reasoning: boolean): string {
  // reasoning이 아니면 이전 동작 그대로(content를 trim만). <think> 제거·잘림 throw는 reasoning=true에서만.
  if (!reasoning) return (choice?.message?.content || '').trim();
  const content = stripThinkTags(choice?.message?.content ?? '');
  {
    if (!content) {
      throw new ReasoningTruncatedError('reasoning 모드 응답이 비었다(thinking 잘림 가능성)');
    }
    if (choice?.finish_reason === 'length') {
      throw new ReasoningTruncatedError('reasoning 모드 응답이 토큰 상한(length)에서 끊겼다');
    }
  }
  return content;
}
