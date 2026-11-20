import { config } from '../config.js';
import type { AgentPersona, CommunityPost, WebSearchResult } from '../types.js';
import { resolveProviders, type LlmProviderConfig } from './provider.js';
import { sanitizeLlmText } from './sanitize.js';
import { pickPostFormat } from './post-formats.js';
import { pickCommentFormat } from './comment-formats.js';
import { buildPersonaPromptPrefix } from './persona-prompt.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const CHAT_TIMEOUT_MS = 30000;
const CHAT_RETRY_DELAY_MS = 1000;

/**
 * 원래 generatePost에만 있던 "AI 티 나는 문체" 금지 규칙. 2026-09-14 prod 피드 감사 결과
 * 실제로 AI임을 들킨 결정적 증거는 전부 댓글 쪽이었는데(3줄 정형, 원글 재진술 도입부, 제안형
 * 마무리) 정작 댓글 프롬프트엔 이 규칙이 없었다 — 글/댓글 비대칭을 없애려고 상수로 뺐다.
 */
const ANTI_AI_STYLE_RULE =
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

  private async chatOnce(messages: ChatMessage[], jsonMode: boolean, provider: LlmProviderConfig): Promise<string> {
    const payload: any = {
      model: provider.model,
      messages,
      temperature: this.temperature,
      // 명시 안 하면 일부 OpenRouter 백엔드(예: gpt-oss-20b:free의 GMICloud)가 완성 토큰 상한을
      // 모델의 전체 컨텍스트 길이로 잡아버려서 "입력+출력이 컨텍스트 초과"로 항상 400이 남
      // (2026-09-06 prod에서 실제로 겪음). 우리 응답은 길어야 포스트 몇 문단이라 2048이면 충분.
      max_tokens: 2048,
    };

    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    try {
      const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
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
      const content = data.choices?.[0]?.message?.content || '';
      return content.trim();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${CHAT_TIMEOUT_MS}ms [${provider.name}]`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 주 공급자에 타임아웃 적용 + 1회 재시도(백오프). 그래도 실패하고 폴백 공급자가
   * 설정돼 있으면 폴백으로 1회 시도. 전부 실패하면 마지막 에러를 던짐.
   * 호출부(evaluatePostInterest는 휴리스틱 폴백, generatePost/generateComment/generateReply는
   * 뻔한 대체 문구 대신 null을 반환해 이번 턴을 스킵)는 각자 실패 처리 방식을 가지고 있음.
   */
  public async chat(messages: ChatMessage[], jsonMode = false): Promise<string> {
    try {
      return await this.chatOnce(messages, jsonMode, this.primary);
    } catch (firstErr: any) {
      console.error(`[LlmClient:${this.primary.name}] Chat completion failed (attempt 1):`, firstErr.message);
      await new Promise((resolve) => setTimeout(resolve, CHAT_RETRY_DELAY_MS));
      try {
        return await this.chatOnce(messages, jsonMode, this.primary);
      } catch (secondErr: any) {
        console.error(`[LlmClient:${this.primary.name}] Chat completion failed (attempt 2):`, secondErr.message);

        if (!this.fallback) throw secondErr;

        console.warn(`[LlmClient] ${this.primary.name} 실패 → ${this.fallback.name}로 폴백 시도`);
        try {
          return await this.chatOnce(messages, jsonMode, this.fallback);
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

  /**
   * 새 게시글 생성 (자발적 아이디어 또는 외부 리서치 자료 기반)
   */
  public async generatePost(
    persona: AgentPersona,
    categoryName: string,
    externalContent?: WebSearchResult | null,
    moodModifier = '',
    recentTexts: string[] = []
  ): Promise<{ title: string; body: string } | null> {
    const format = pickPostFormat();
    const systemPrompt = `${buildPersonaPromptPrefix(persona, 'post', recentTexts)}

당신은 goodfriends 커뮤니티의 활동 멤버 '${persona.nickname}'입니다.
당신의 정체성:
- 프로필: ${persona.bio}
- 관심사: ${persona.interests.join(', ')}
- 말투/스타일: ${persona.tone}
${moodModifier ? `- 오늘의 기분: ${moodModifier}` : ''}

작성 규칙:
1. '${categoryName}' 카테고리에 어울리는 흥미롭고 유익한 새 글을 작성하세요. 개인적인 장면이나 관찰로 시작해서 의견 또는 질문을 남기세요.
2. 이번 글의 형식: ${format.instruction} 매번 같은 형식(정보공유 + 마지막에 질문 던지기)으로 쓰지 말고, 이번엔 반드시 이 형식을 따르세요.
3. 당신의 고유한 말투(${persona.tone})를 살려 진솔하고 매력적으로 쓰세요.
4. 제목은 클릭하고 싶게 센스 있게 지으세요. 과장된 낚시성 제목은 피하세요.
5. 본문은 줄바꿈으로 읽기 쉽게 구성하세요. 이모지·자모(ㅋㅋ, ㅠㅠ 등)는 위 페르소나의 글쓰기 버릇에 적힌 대로만 쓰세요. 안 쓰는 성격이면 하나도 쓰지 말고, 쓰는 성격이면 억지로 절제하지 마세요 — 전원이 똑같이 절제된 문체로 쓰면 그 자체가 부자연스럽습니다.
6. 실제 커뮤니티 자유게시판 글은 대부분 짧습니다(조사해보니 5줄 넘는 글이 드묾) — 본문은 보통 2~5문장으로 쓰세요. 여러 문단에 걸쳐 정보를 나열하지 마세요. 형식이 짧은잡담형·캡션형이면 한두 문장으로 끝내도 충분합니다.
7. "안녕하세요, ○○입니다!" 같은 자기소개형 인사말로 시작하지 마세요. 실제 커뮤니티 회원은 글마다 자기소개를 하지 않습니다 — 하고 싶은 얘기로 바로 들어가세요. "다들 좋은 시간 보내세요!" 같은 정형화된 인사로 끝맺지도 마세요.
8. 글의 마지막 문장을 질문으로 끝내지 마세요("여러분은 어떻게 생각하세요?", "어떠세요?" 같은 마무리 금지) — 제목 자체가 질문형이고 본문이 그 질문을 처음 다루는 경우가 아니면 예외 없습니다. 실제 커뮤니티 글은 감상·체념·단정("~겠네요", "~인 듯", "~려나", "ㅉㅉ")으로 끝나거나, 문장을 다 맺지 않고 자연스럽게 트레일오프하며 끝나는 경우가 대부분입니다. 독자에게 답을 구하며 마무리하는 글은 거의 없다고 생각하고 쓰세요.
9. "요즘 ~에 대해 생각이 많네요" 같은 막연하고 내용 없는 소감은 쓰지 마세요. 구체적인 사례, 숫자, 직접 겪은 상황, 뚜렷한 의견 중 적어도 하나는 반드시 담아서 무슨 얘기를 하는지 읽자마자 알 수 있게 쓰세요.
10. ${ANTI_AI_STYLE_RULE} 또한 마지막 문장을 잠언처럼 정리하며 착지하지 마세요("결국 ~는 ~에서 시작되는 거다", "~가 아닐까 싶다" 류) — 실측해보니 모든 글이 이 패턴으로 끝나는 게 AI 티가 가장 크게 났습니다.
11. 이 글로 무엇을 전달하려는 건지(정보 공유, 팁, 경험담, 의견, 질문 등) 스스로 분명히 하고, 그 목적과 핵심 내용이 읽는 사람에게 바로 전달되게 쓰세요.
12. 외부 자료가 주어졌다면 내용을 요약만 하지 말고, 왜 흥미로운지·동의하는지 아닌지·자신의 경험에 비춰 어떤지 등 뚜렷한 개인 의견을 반드시 섞어 쓰세요. 남의 얘기를 전달만 하는 게 아니라 당신의 관점이 드러나야 합니다.
13. 본문에 출처 URL이나 링크를 절대 붙여넣지 마세요. 링크를 공유하는 게 아니라 그 내용을 당신 말로 소화해서 전달하는 겁니다 — 필요하면 "어디서 봤는데" 정도로만 자연스럽게 언급하세요.
14. 반드시 다음 JSON 형식으로만 출력하세요:
{
  "title": "게시글 제목",
  "body": "게시글 본문 (줄바꿈 포함)"
}`;

    let userPrompt = `[카테고리]: ${categoryName}\n`;
    if (externalContent) {
      userPrompt += `[외부 리서치 자료]:
- 제목: ${externalContent.title}
- 내용: ${externalContent.snippet}

위 최신 외부 자료의 내용을 당신 말로 소화해서, 당신의 관점과 의견을 담은 게시글을 작성해주세요. 링크는 주지 않았으니 본문에 링크를 지어내지도 마세요.`;
    } else {
      userPrompt += `당신의 관심 분야와 관련된 새로운 생각, 유용한 꿀팁, 일상 경험, 또는 커뮤니티 사람들과 나누고 싶은 질문을 주제로 게시글을 작성해주세요.`;
    }

    try {
      const response = await this.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        true
      );

      const cleanJson = response.replace(/^```json\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      const title = sanitizeLlmText(parsed.title || '');
      const body = sanitizeLlmText(parsed.body || '');

      // 제목/본문이 비면 진짜 콘텐츠가 아니라는 뜻 — 뻔한 대체 문구를 올리느니 이번 턴은 그냥 스킵한다.
      if (!title || !body) return null;
      return { title, body };
    } catch (err: any) {
      console.error(`[LlmClient] generatePost failed for ${persona.nickname}:`, err.message);
      return null;
    }
  }
}
