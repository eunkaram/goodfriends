/** writer 테스트 공용 픽스처. */
import type { AgentPersona } from '../types.js';
import type { ChatMessage, ChatOptions } from '../llm/llm-client.js';
import type { ResearchBundle } from './types.js';
import type { WriterLlm } from './write-types.js';

export const persona = {
  id: 'p1', name: '테스터', nickname: '테스터', bio: 'b', interests: [], tone: '담백한 말투',
  systemPrompt: '당신은 테스터입니다.', communityBehavior: undefined,
} as unknown as AgentPersona;

export function makeBundle(): ResearchBundle {
  const textA = 'Ollama v0.12.3 was released on November 4, 2026. It adds support for GPT-OSS models. The download is 1,200 MB.';
  const textB = 'The paper reports a 12% improvement on MMLU with the new method.';
  return {
    category: 'local',
    topic: { title: 'Ollama 0.12.3', url: 'https://a.example/post', sourceId: 'github:ollama/ollama', publishedAt: null },
    sources: [
      { url: 'https://a.example/post', title: 'Ollama release', text: textA, images: [], ogImage: null, siteName: null, publishedAt: '2026-11-04', sourceId: 's1' },
      { url: 'https://b.example/paper', title: 'Paper', text: textB, images: [], ogImage: null, siteName: null, publishedAt: '2026-10-01', sourceId: 's2' },
    ],
    facts: [
      { claim: 'Ollama v0.12.3이 2026년 11월 4일에 나왔다', quote: 'Ollama v0.12.3 was released on November 4, 2026.', url: 'https://a.example/post', sourceTitle: 'Ollama release', publishedAt: '2026-11-04' },
      { claim: 'GPT-OSS 모델 지원이 추가됐다', quote: 'It adds support for GPT-OSS models.', url: 'https://a.example/post', sourceTitle: 'Ollama release', publishedAt: '2026-11-04' },
      { claim: '새 방법이 MMLU에서 12% 향상됐다고 보고한다', quote: 'The paper reports a 12% improvement on MMLU with the new method.', url: 'https://b.example/paper', sourceTitle: 'Paper', publishedAt: '2026-10-01' },
    ],
  };
}

export type Responder = (messages: ChatMessage[], jsonMode: boolean, options: ChatOptions) => string | undefined;

/** responder들을 순서대로 시도해 처음 string을 돌려준 응답을 쓴다. 호출 기록을 calls에 남긴다. */
export function mockLlm(...responders: Responder[]): WriterLlm & { calls: { messages: ChatMessage[]; jsonMode: boolean; options: ChatOptions }[] } {
  const calls: { messages: ChatMessage[]; jsonMode: boolean; options: ChatOptions }[] = [];
  return {
    calls,
    async chat(messages, jsonMode = false, options = {}) {
      calls.push({ messages, jsonMode, options });
      for (const r of responders) {
        const out = r(messages, jsonMode, options);
        if (out !== undefined) return out;
      }
      throw new Error('mockLlm: 처리되지 않은 호출 ' + messages[0].content.slice(0, 40));
    },
  };
}

export const sys = (m: ChatMessage[]) => m[0].content;
export const usr = (m: ChatMessage[]) => m[m.length - 1].content;
