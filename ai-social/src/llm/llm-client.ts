import { config } from '../config.js';
import type { AgentPersona, CommunityPost } from '../types.js';
import { resolveProviders, type LlmProviderConfig } from './provider.js';
import { sanitizeLlmText } from './sanitize.js';
import { pickCommentFormat } from './comment-formats.js';
import { buildPersonaPromptPrefix } from './persona-prompt.js';
import { extractChatContent } from './thinking.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** 요청 타임아웃(ms). 생략하면 30초. 글 생성 같은 긴 호출은 config.llm.longTimeoutMs를 넘긴다. */
  timeoutMs?: number;
  /** 완성 토큰 상한. 생략하면 2048. */
  maxTokens?: number;
  /**
   * reasoning(thinking) 모드. 생략=서버 기본(off, 기존 동작 불변). true면 로컬 공급자에
   * chat_template_kwargs.enable_thinking=true를 보내고, 응답의 <think>/reasoning_content는 버리며,
   * thinking이 잘려 답이 비면 throw한다(thinking.ts 참고). max_tokens는 thinking 분량까지 넉넉히 줄 것.
   */
  reasoning?: boolean;
}

const CHAT_TIMEOUT_MS = 30000;
const CHAT_RETRY_DELAY_MS = 1000;

/**
 * 원래 글 생성 프롬프트에만 있던 "AI 티 나는 문체" 금지 규칙. 2026-09-14 prod 피드 감사 결과
 * 실제로 AI임을 들킨 결정적 증거는 전부 댓글 쪽이었는데(3줄 정형, 원글 재진술 도입부, 제안형
 * 마무리) 정작 댓글 프롬프트엔 이 규칙이 없었다 — 글/댓글 비대칭을 없애려고 상수로 뺐다.
 */
export const ANTI_AI_STYLE_RULE =
  'AI가 쓴 것처럼 보이는 상투적 패턴을 피하세요: "~를 통해", "~에 대해" 같은 번역투, "결론적으로", ' +
  '"시사하는 바가 크다", "~라고 할 수 있습니다" 같은 상투어, "첫째/둘째/셋째"나 번호·불릿 나열, ' +
  '"~것 같습니다/~일 수도 있습니다"를 문장마다 붙이는 헤징 남발, "것이다/점/수"로 어색하게 끝나는 ' +
  '형식명사 과다 사용, 볼드체나 대시(—)로 과하게 꾸미는 것. 문장 길이를 짧고 길게 들쭉날쭉 섞고, ' +
  '종결어미도 매번 똑같이 반복하지 마세요.';

/**
 * 같은 글에 여러 에이전트가 동시에 댓글을 달면 전부 같은 문장으로 시작하는 문제가 실측됨
 * (한 글의 댓글 7개 중 6개가 "그 물병을 들어 올린 손이 얼마나 무거웠을지…"로 시작).
 * 이미 달린 댓글을 프롬프트에 넣어 겹치지 않게 한다.
 */
function buildExistingCommentsBlock(comments: { authorNickname: string; body: string }[]): string {
  if (comments.length === 0) return '';
  const lines = comments.slice(-6).map((c) => `- ${c.authorNickname}: ${c.body.replace(/\s+/g, ' ').slice(0, 120)}`);
  return (
    `\n\n[이미 달려 있는 댓글]\n${lines.join('\n')}\n` +
    '위 댓글들과 같은 표현·같은 도입부·같은 관점을 반복하지 마세요. 이미 나온 얘기면 다른 각도로 쓰거나 더 짧게 쓰세요.'
  );
}

/**
 * 로컬 LLM(Ollama 등)과 OpenRouter를 둘 다 지원하는 OpenAI 호환 chat completion 클라이언트.
 * 어느 쪽이 주(primary)인지는 LLM_PROVIDER로 정하고, active='local'일 때 OPENROUTER_API_KEY가
 * 있으면 로컬이 완전히 실패한 뒤 OpenRouter로 자동 폴백한다(provider.ts 참고).
 */
export class LlmClient {
  private primary: LlmProviderConfig;
  private fallback: LlmProviderConfig | null;
  private temperature: number;

  constructor() {
    const { primary, fallback } = resolveProviders({
      active: config.llmProvider.active,
      fallbackToOpenRouter: config.llmProvider.fallbackToOpenRouter,
      local: config.localLlm,
      openRouter: config.openRouter,
    });
    this.primary = primary;
    this.fallback = fallback;
    this.temperature = config.localLlm.temperature;

    console.log(
      `[LlmClient] 주 공급자: ${this.primary.name} (${this.primary.model})` +
        (this.fallback ? ` | 폴백: ${this.fallback.name} (${this.fallback.model})` : '')
    );
  }

  private async chatOnce(
    messages: ChatMessage[],
    jsonMode: boolean,
    provider: LlmProviderConfig,
    options: ChatOptions = {}
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;
    const payload: any = {
      model: provider.model,
      messages,
      temperature: this.temperature,
      // 명시 안 하면 일부 OpenRouter 백엔드(예: gpt-oss-20b:free의 GMICloud)가 완성 토큰 상한을
      // 모델의 전체 컨텍스트 길이로 잡아버려서 "입력+출력이 컨텍스트 초과"로 항상 400이 남
      // (2026-09-06 prod에서 실제로 겪음). 우리 응답은 길어야 포스트 몇 문단이라 2048이면 충분.
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.reasoning !== undefined && provider.name === 'local') {
      payload.chat_template_kwargs = { enable_thinking: options.reasoning };
    }

    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          ...provider.extraHeaders,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`LLM Error [${provider.name}] (${res.status}): ${errorText}`);
      }

      const data = (await res.json()) as any;
      return extractChatContent(data.choices?.[0], options.reasoning === true);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${timeoutMs}ms [${provider.name}]`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 주 공급자에 타임아웃 적용 + 1회 재시도(백오프). 그래도 실패하고 폴백 공급자가
   * 설정돼 있으면 폴백으로 1회 시도. 전부 실패하면 마지막 에러를 던짐.
   * 호출부(evaluatePostInterest는 휴리스틱 폴백, generateComment/generateReply는
   * 뻔한 대체 문구 대신 null을 반환해 이번 턴을 스킵)는 각자 실패 처리 방식을 가지고 있음.
   */
  public async chat(messages: ChatMessage[], jsonMode = false, options: ChatOptions = {}): Promise<string> {
    try {
      return await this.chatOnce(messages, jsonMode, this.primary, options);
    } catch (firstErr: any) {
      console.error(`[LlmClient:${this.primary.name}] Chat completion failed (attempt 1):`, firstErr.message);
      await new Promise((resolve) => setTimeout(resolve, CHAT_RETRY_DELAY_MS));
      try {
        return await this.chatOnce(messages, jsonMode, this.primary, options);
      } catch (secondErr: any) {
        console.error(`[LlmClient:${this.primary.name}] Chat completion failed (attempt 2):`, secondErr.message);

        if (!this.fallback) throw secondErr;

        console.warn(`[LlmClient] ${this.primary.name} 실패 → ${this.fallback.name}로 폴백 시도`);
        try {
          return await this.chatOnce(messages, jsonMode, this.fallback, options);
        } catch (fallbackErr: any) {
          console.error(`[LlmClient:${this.fallback.name}] Fallback also failed:`, fallbackErr.message);
          throw fallbackErr;
        }
      }
    }
  }

  /**
   * 피드 글을 보고 관심도 및 반응 여부 결정
   */
  public async evaluatePostInterest(
    persona: AgentPersona,
    post: CommunityPost
  ): Promise<{ interested: boolean; shouldReact: boolean; shouldComment: boolean; reason: string }> {
    // 이 판단 호출은 세션당 최대 15번(피드 후보 글마다 한 번씩) 불려서 실제 글쓰기보다 훨씬
    // 잦다 — buildPersonaPromptPrefix로 전체 systemPrompt(1000자 안팎)를 매번 붙이면 세션당
    // 가장 비싼 호출을 15배로 곱하는 셈이라 토큰 사용량이 크게 뛴다(2026-09-08 실제로 겪음,
    // 중복 제거만으론 부족했음). 아래 identity 블록이 이미 있어서 systemPrompt는 안 붙이고
    // 활동 기준(communityBehavior.reaction)/활동 여력만 한 줄씩 가볍게 더한다.
    const reactionRule = persona.communityBehavior?.reaction;
    const socialEnergy = persona.persona?.socialEnergy;
    const systemPrompt = `당신은 다음 페르소나를 가진 소셜 커뮤니티 사용자입니다:
- 이름: ${persona.nickname} (${persona.name})
- 자기소개: ${persona.bio}
- 주요 관심사: ${persona.interests.join(', ')}
- 성향 및 말투: ${persona.tone}
${reactionRule ? `- 공감/댓글 판단 기준: ${reactionRule}\n` : ''}${socialEnergy ? `- 오늘 활동 여력: ${socialEnergy}\n` : ''}
주어진 게시글을 읽고, 당신의 페르소나 관점에서 이 글에 흥미가 있는지, 공감(하트)을 누를지, 댓글을 달지 결정하세요.
모든 글에 기계적으로 반응하지 마세요 — 정말 도움이 됐거나 취향·경험·감정이 닿을 때만 공감하고, 주제가 안 맞거나 지금 활동 여력이 낮으면 interested를 false로 두세요.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "interested": true | false,
  "shouldReact": true | false,
  "shouldComment": true | false,
  "reason": "한 줄 이유"
}`;

    const userPrompt = `[게시판]: ${post.categoryName}
[작성자]: ${post.authorNickname}
[제목]: ${post.title}
[미리보기 내용]:
${post.bodyPreview}

위 게시글을 당신의 페르소나 입장에서 평가해주세요.`;

    try {
      const response = await this.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        true
      );

      // JSON 파싱 (마크다운 코드블록 제거)
      const cleanJson = response.replace(/^```json\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return {
        interested: Boolean(parsed.interested),
        shouldReact: Boolean(parsed.shouldReact),
        shouldComment: Boolean(parsed.shouldComment),
        reason: sanitizeLlmText(String(parsed.reason || '')),
      };
    } catch (err) {
      // 로컬 LLM JSON 모드 미지원 시 폴백
      return {
        interested: Math.random() < 0.6,
        shouldReact: Math.random() < persona.reactionProb,
        shouldComment: Math.random() < persona.commentProb,
        reason: 'Fallback heuristic decision',
      };
    }
  }

  /**
   * 게시글에 달 댓글 생성
   */
  public async generateComment(
    persona: AgentPersona,
    post: CommunityPost,
    moodModifier = '',
    recentTexts: string[] = [],
    existingComments: { authorNickname: string; body: string }[] = []
  ): Promise<string | null> {
    const format = pickCommentFormat();
    const systemPrompt = `${buildPersonaPromptPrefix(persona, 'comment', recentTexts)}

당신은 goodfriends 커뮤니티의 활동 멤버 '${persona.nickname}'입니다.
당신의 정체성:
- 페르소나 설명: ${persona.bio}
- 관심사: ${persona.interests.join(', ')}
- 말투/성향: ${persona.tone}
${moodModifier ? `- 오늘의 기분: ${moodModifier}` : ''}

규칙:
1. 반드시 당신의 말투(${persona.tone})를 완벽하게 유지하세요.
2. AI인 척하지 말고, 진짜 사람처럼 자연스럽고 생생하게 대화하듯이 댓글을 작성하세요.
3. 이번 댓글의 형식: ${format.instruction} 매번 같은 형식으로 쓰지 말고, 이번엔 반드시 이 형식을 따르세요.
4. 원글 내용을 요약하거나 되풀이하면서 시작하지 마세요("~하셨다니", "~라는 장면이 참" 같은 재진술 도입부 금지). 하고 싶은 말부터 바로 시작하세요.
5. "다음엔 ~해보는 건 어때요", "저도 ~해봐야겠어요" 같은 제안·다짐으로 끝맺지 마세요. 실제 커뮤니티 댓글은 대부분 덕담 없이 그냥 끝납니다.
6. "원글 재진술 → 내 경험 → 제안" 3단 구성으로 쓰지 마세요. 길이도 매번 다르게 — 한 줄짜리 댓글이 제일 흔합니다.
7. 이모지·자모(ㅋㅋ, ㅠㅠ 등)는 위 페르소나의 글쓰기 버릇에 적힌 대로만 쓰세요. 안 쓰는 성격이면 하나도 쓰지 말고, 쓰는 성격이면 억지로 절제하지 마세요 — 전원이 똑같이 절제된 문체로 쓰면 그 자체가 부자연스럽습니다.
8. ${ANTI_AI_STYLE_RULE}
9. 불필요한 서두나 따옴표 없이, 오직 작성할 댓글 텍스트만 출력하세요.${buildExistingCommentsBlock(existingComments)}`;

    const userPrompt = `[게시글 제목]: ${post.title}
[게시글 내용]:
${post.bodyPreview}
[작성자]: ${post.authorNickname}

이 글에 당신의 스타일로 매력적인 댓글을 작성해주세요.`;

    try {
      const comment = await this.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      return sanitizeLlmText(comment).replace(/^["']|["']$/g, '').trim();
    } catch (err: any) {
      console.error(`[LlmClient] generateComment failed for ${persona.nickname}:`, err.message);
      return null;
    }
  }

  /**
   * 특정 댓글에 대한 대댓글(답글) 생성. generateComment와 달리 원 댓글 내용을 맥락으로 받아
   * 그 댓글에 직접 반응하는 답글을 씀 (글 자체가 아니라 댓글에 대한 대화).
   */
  public async generateReply(
    persona: AgentPersona,
    post: CommunityPost,
    parentComment: { authorNickname: string; body: string },
    moodModifier = '',
    recentTexts: string[] = []
  ): Promise<string | null> {
    const systemPrompt = `${buildPersonaPromptPrefix(persona, 'reply', recentTexts)}

당신은 goodfriends 커뮤니티의 활동 멤버 '${persona.nickname}'입니다.
당신의 정체성:
- 페르소나 설명: ${persona.bio}
- 관심사: ${persona.interests.join(', ')}
- 말투/성향: ${persona.tone}
${moodModifier ? `- 오늘의 기분: ${moodModifier}` : ''}

규칙:
1. 반드시 당신의 말투(${persona.tone})를 완벽하게 유지하세요.
2. AI인 척하지 말고, 진짜 사람처럼 자연스럽게 대화를 이어가는 답글을 작성하세요.
3. 원 글이 아니라 아래 [원댓글]의 내용에 직접 반응하는 답글을 1~2문장으로 간결하게 작성하세요 — 동의, 반박, 추가 정보, 질문 등.
4. 원댓글을 요약하거나 되풀이하며 시작하지 말고, "다음엔 ~해보세요" 같은 제안·덕담으로 끝맺지도 마세요. 실제 답글은 대부분 한 줄이고 그냥 끝납니다.
5. 이모지·자모(ㅋㅋ, ㅠㅠ 등)는 위 페르소나의 글쓰기 버릇에 적힌 대로만 쓰세요. 안 쓰는 성격이면 하나도 쓰지 말고, 쓰는 성격이면 억지로 절제하지 마세요 — 전원이 똑같이 절제된 문체로 쓰면 그 자체가 부자연스럽습니다.
6. ${ANTI_AI_STYLE_RULE}
7. 불필요한 서두나 따옴표, "@닉네임" 같은 멘션 표기 없이, 오직 답글 텍스트만 출력하세요.`;

    const userPrompt = `[게시글 제목]: ${post.title}
[원댓글 작성자]: ${parentComment.authorNickname}
[원댓글 내용]: ${parentComment.body}

이 댓글에 당신의 스타일로 답글을 작성해주세요.`;

    try {
      const reply = await this.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      return sanitizeLlmText(reply).replace(/^["']|["']$/g, '').trim();
    } catch (err: any) {
      console.error(`[LlmClient] generateReply failed for ${persona.nickname}:`, err.message);
      return null;
    }
  }
}
