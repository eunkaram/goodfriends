/**
 * LLM 호출 추상화 — M3의 한국어 요약(뉴스)과 화제 다이제스트 초안이 공유하는
 * 한 곳. OpenAI-호환 chat completions만 말한다: 실제 배포에서 모델을 뭐로
 * 바꾸든(LLM_BASE_URL/LLM_MODEL만 갈아끼우면) 이 파일 밖은 안 건드린다.
 *
 * 🔒 키 없는 환경을 지원한다 — .env에 LLM_API_KEY가 없으면 stub이 결정적
 * (deterministic) 텍스트를 만든다. "완료 기준: 하루 1회 사이클이 사람 개입
 * 없이 돌고"가 키·네트워크 없는 로컬에서도 참이 되도록 하기 위해서다.
 * 공급사 계약이나 네트워크 죽음은 실패(failed)로 기록돼 다음 사이클이 재시도
 * 한다 — stub은 그 "재시도 가능한 실패"가 아니다.
 */
import { alertAdminOfError } from './error-alert.ts';

const LLM_TIMEOUT_MS = 60_000;

export type SummarizedNews = {
  krTitle: string; // 발행 글의 title
  digest: string; // 발행 글의 body 요약 부분
};

type ChatMessage = { role: 'system' | 'user'; content: string };

function llmConfig(): { apiKey: string; baseUrl: string; model: string; extraBody: Record<string, unknown> } | null {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  let extraBody: Record<string, unknown> = {};
  const raw = process.env.LLM_EXTRA_BODY_JSON?.trim();
  if (raw) {
    try {
      extraBody = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('LLM_EXTRA_BODY_JSON 파싱 실패 — 올바른 JSON을 넣어라');
    }
  }
  return {
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    extraBody,
  };
}

async function callLlm(messages: ChatMessage[], maxOutputChars: number, maxTokens = 1200): Promise<string> {
  const config = llmConfig();
  if (!config) throw new Error('LLM_API_KEY 미설정'); // 호출자가 stub 폴백 분기

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.3,
        // 🔒 실측(2026-10-19, 로컬 vLLM Qwen3.5) — 상한 없이 두면 thinking 모델이
        // 추론 토큰을 대량 생성해 60초 타임아웃으로 전 건 실패한다. 출력 요구량에
        // 맞춘 상한이 코스트·타임아웃 양쪽의 배리어다.
        max_tokens: maxTokens,
        // 🔒 제공사별 확장 필드는 env로만 주입한다 — body에 상수로 특정 제공사의
        // 필드(vLLM chat_template_kwargs 등)를 몰아넣으면 OpenAI 등 다른 서버가
        // 거부할 수 있다. "URL/모델만 갈아끼운다"의 계약을 유지하는 유일한 안전 통로.
        ...config.extraBody,
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = stripThinking(data.choices?.[0]?.message?.content?.trim() ?? '');    if (!text) throw new Error('LLM 응답이 비었다');
    return text.slice(0, maxOutputChars);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 🔒 실측(2026-10-19, 로컬 vLLM Qwen3.5) — no-think 스위치(/no_think, 시스템
 * 안내)만으로는 추론 프리앰블이 응답에 섞일 수 있다("Thinking Process: 1. …
 * Answer: …"). 발행 파서는 첫 줄을 제목으로 잡기 때문에 그대로 다면 봇 글이
 * 추론 스케치로 발행된다. 프리앰블로 명확히 시작한 경우에만 말미의 Answer 구분선
 * 뒤를 취한다 — 정상 응답(한국어 제목으로 시작)에는 무동작.
 */
function stripThinking(text: string): string {
  if (!/^(thinking process|let me think|\*\*thinking)/i.test(text)) {
    return text;
  }
  const marker = /(?:\*\*?answer:?\*\*?|answer:)\s*/i;
  const idx = text.search(marker);
  if (idx < 0) {
    // 프리앰블로 시작했는데 말미 구분선도 없다(토큰 상한으로 잘렸을 때 등) —
    // 발행할 수 없는 노이즈이므로 빈 문자열로 내려 발행을 막고 failed로 기록.
    return '';
  }
  return text.slice(idx + (marker.exec(text)?.[0].length ?? 0)).trim();
}

/** 🔒 이스케이프 — 발행 본문은 HTML 단락으로 감싸진다(발행 쪽 toPostBody).
 * 사용자 입력이 아니라 원문 제목이지만, 그대로 이어 붙이는 습관은 XSS의
 * 문이므로 여기서 한 번 닫는다. */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 개발/테스트용 결정 요약 — 실제 LLM 대응물과 같은 모양(krTitle/digest)을
 * 내도록 한다. 원문 링크는 발행 단계(봇)가 붙이므로 여기선 순수 요약만. */
export function summarizeNewsStub(input: { sourceName: string; title: string; description: string }): SummarizedNews {
  const snippet = input.description.trim().slice(0, 300);
  const digestLines = [
    `『${input.sourceName}』의 ${input.title} 관련 소식을 AI 커뮤니티 에디터가 정리했다.`,
    snippet ? `${snippet}${input.description.trim().length > 300 ? ' — (중략)' : ''}` : `원문 요약 대신 제목 위주로 남긴다.`,
    `자세한 내용은 원문 링크에서 확인하자.`,
  ];
  return { krTitle: input.title, digest: digestLines.join('\n\n') };
}

/** 뉴스 1건 한국어 요약. 실패(stub 포함 아님 — 실제 LLM 실패만)를 null로
 * 반환해 호출자가 news_articles.status='failed'로 기록하도록 한다. LLM
 * 콜 실패는 운영자 알림 대상이므로 이곳에서 alertAdminOfError를 불러도
 * rate-limit(5분)가 스톰을 막는다. */
export async function summarizeNewsKorean(input: {
  sourceName: string;
  title: string;
  description: string;
}): Promise<{ ok: true; value: SummarizedNews } | { ok: false; error: string }> {
  const config = llmConfig();
  if (!config) {
    return { ok: true, value: summarizeNewsStub(input) };
  }
  try {
    const text = await callLlm(
      [
        {
          role: 'system',
          content:
            '너는 한국어 AI 뉴스 에디터다. 해외 AI 뉴스 원문(제목+요약)을 한국어로 다듬는다. ' +
            '응답 형식: 첫 줄은 한국어 제목(60자 이하, 원문 기사 제목 번역), 그다음 줄부터 본문 요약(2~3문장, 반말이 아닌 다듬은 전문체). ' +
            '경어체로 쓴다. 링크·이모지·목록 기호를 넣지 마라. /no_think — 추론 과정은 출력하지 말고 바로 편집 결과만 쓴다.',
        },
        {
          role: 'user',
          content: `출처: ${input.sourceName}\n제목: ${input.title}\n요약: ${input.description || '(없음)'}`,
        },
      ],
      1200,
      800,
    );
    const [titleLine, ...bodyLines] = text.split('\n').filter((l) => l.trim());
    const digest = bodyLines.join('\n\n').trim() || titleLine;
    return { ok: true, value: { krTitle: titleLine.slice(0, 200), digest } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alertAdminOfError(err, 'news-llm-summarize');
    return { ok: false, error: message };
  }
}

/** 개발/테스트용 결정 댓글 — LLM_API_KEY 없을 때 폴백(summarizeNewsStub과 같은 원칙). */
export function firstCommentStub(input: { title: string }): string {
  return `"${input.title}" 글 잘 봤어요. 좋은 이야기 공유해주셔서 감사해요!`;
}

/** 새 글 첫 댓글(post-bot-comment.ts) — 실패 시 null 대신 ok:false로, 호출자가
 * 조용히 건너뛰도록 한다(댓글 하나 없다고 글 작성이 실패하면 안 된다). */
export async function generateFirstComment(input: {
  categoryName: string;
  title: string;
  body: string;
}): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const config = llmConfig();
  if (!config) {
    return { ok: true, value: firstCommentStub(input) };
  }
  try {
    const text = await callLlm(
      [
        {
          role: 'system',
          content:
            '너는 AI 커뮤니티의 활발한 멤버다. 방금 올라온 글에 첫 댓글을 단다. ' +
            '글쓴이를 환영하고 글 내용에 실제로 반응하는 1~2문장 댓글을 써라. ' +
            '글에 없는 사실을 지어내거나 단정하지 마라. 경어체로 쓰고 이모지·해시태그는 쓰지 마라. ' +
            '/no_think — 추론 과정은 출력하지 말고 바로 댓글 본문만 써라.',
        },
        {
          role: 'user',
          content: `카테고리: ${input.categoryName}\n제목: ${input.title}\n본문: ${input.body.slice(0, 1500)}`,
        },
      ],
      500,
      300,
    );
    return { ok: true, value: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alertAdminOfError(err, 'first-comment-generate');
    return { ok: false, error: message };
  }
}

export type DigestDraftInput = {
  dateLabel: string; // 예: 2026-10-18
  activities: Array<{
    username: string;
    nickname: string | null;
    postTitle: string;
    postBodyExcerpt: string; // 1차에서는 발췌본만 제공(원문 전체가 아니다)
    commentCount: number;
  }>;
};

export function digestDraftStub(input: DigestDraftInput): { title: string; content: string } {
  const bullet = input.activities
    .map((a) => `- 「${a.postTitle}」 — ${a.commentCount}개 댓글 (${a.nickname ?? a.username})`)
    .join('\n\n');
  const content = [
    `${input.dateLabel} — 커뮤니티의 오늘을 정리했다.`,
    '',
    bullet || '(오늘은 새 활동이 없었다.)',
  ].join('\n\n');
  return { title: `오늘의 AI 화제 — ${input.dateLabel}`, content };
}

/** 화제 다이제스트 초안 생성 — 실패 시 null(LLM 실패 알림은 이 안에서). */
export async function generateDigestDraft(input: DigestDraftInput): Promise<{ ok: true; value: { title: string; content: string } } | { ok: false; error: string }> {
  const config = llmConfig();
  if (!config) {
    return { ok: true, value: digestDraftStub(input) };
  }
  try {
    const activityText = input.activities
      .map((a) => `· @${a.username}(${a.nickname ?? ''}) — 「${a.postTitle}」 댓글 ${a.commentCount}개\n${a.postBodyExcerpt}`)
      .join('\n\n');
    const content = await callLlm(
      [
        {
          role: 'system',
          content:
            '너는 AI 커뮤니티의 데일리 편집자다. 최근 하루 커뮤니티 활동(글 제목/본문 발췌/댓글 수)을 ' +
            '곱씹어 "오늘의 AI 화제" 다이제스트를 쓴다. 마크다운 목록(- 항목) 형식, 각 항목은 한두 문장. ' +
            '경어체. 글 제목을 그대로 벗겨내지 말고 관점(논점·논쟁·아이디어)을 짚어준다. /no_think — 추론 과정은 출력하지 말고 바로 편집 결과만 쓴다.',
        },
        {
          role: 'user',
          content: `날짜: ${input.dateLabel}\n\n활동:\n${activityText || '(오늘 활동 없음)'}`,
        },
      ],
      4000,
      2400,
    );
    const [titleLine, ...bodyLines] = content.split('\n').filter((l) => l.trim());
    return { ok: true, value: { title: titleLine.slice(0, 100), content: bodyLines.join('\n\n').trim() || titleLine } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alertAdminOfError(err, 'digest-draft-generate');
    return { ok: false, error: message };
  }
}
