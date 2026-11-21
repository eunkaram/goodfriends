import type { AgentPersona, CommunityCategory, CommunityComment, CommunityPost } from '../types.js';
import { config } from '../config.js';
import { GoodfriendsClient } from '../client/goodfriends-client.js';
import { LlmClient } from '../llm/llm-client.js';
import type { PublishMode, WriterService } from '../writer/service.js';
import { StateManager } from './state.js';
import type { PersonaRegistry } from '../personas/registry.js';
import { filterOwnPosts, canInteractWithPost, isFellowAgentPost } from './interaction-rules.js';
import { pickCommentsToReact, pickReplyTarget } from './comment-rules.js';
import { driftMood, moodToneModifier } from './mood.js';
import type { PostInteractionLock } from './post-interaction-lock.js';
import { checkContentSafety, type SafetyCheckResult } from '../safety/content-gate.js';
import { hasEncodingCorruption } from '../llm/sanitize.js';

const MAX_COMMENTS_PER_SESSION = 2;

/**
 * 한 세션에서 훑어볼 피드 글 수. 이 값이 곧 evaluatePostInterest LLM 호출 횟수라서 비용을
 * 지배한다 — 2026-09-21 실측 기준 세션당 입력 토큰의 약 65%가 여기서 나왔다(글마다 1회씩
 * 부르는데, 댓글·글 생성은 합쳐야 세션당 2~3회뿐이라서).
 * 15 → 8로 줄여서 세션 리듬은 유지한 채 토큰을 30% 깎는다. 후보가 줄어드는 만큼 에이전트가
 * 볼 수 있는 글은 적어지지만, 어차피 관심 없는 글은 대부분 반응 없이 버려지던 호출이었다.
 */
const FEED_SCAN_LIMIT = 8;
const REPLY_VS_TOPLEVEL_PROB = 0.5;

function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 쓰기 동작(댓글/답글/새 글) 직전에 끼워 넣는 랜덤 지연.
 *
 * 2026-09-14 prod 피드 타임스탬프 감사에서 사람이면 불가능한 패턴이 그대로 드러났다:
 * 서로 다른 계정 두 개가 0.188초 / 0.094초 간격으로 댓글, 글 올라온 지 28초 만에 네 줄짜리
 * 감상 댓글, 그리고 8개 계정 전부 "댓글 달고 1.3~19.6초 뒤 본인 글 포스팅"(= 세션 종료 플로우
 * 서명). 내용을 아무리 다듬어도 이 타임스탬프만으로 봇 판정이 가능해서 지연을 넣는다.
 *
 * ponytail: 세션 내부에서만 대기하므로 에이전트별 다음 세션 예약이 그만큼 밀린다. 쓰기는
 * 세션당 최대 3회(댓글 2 + 글 1)라 최악이어도 수 분 수준 — 더 정교한 스케줄링이 필요해지면
 * scheduler 쪽에서 세션 길이를 예산으로 잡을 것.
 */
function humanPause(minSec: number, maxSec: number): Promise<void> {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 에이전트가 goodfriends에 대해 쓰는 메서드. DRY_RUN에서는 이 중 읽기 전용(getFeed·getComments·getPostingCategory)만
 * 호출하고, 로그인(ensureAuthenticated)·쓰기(createPost·createComment·toggle*)는 절대 호출하지 않는다.
 */
export type AgentClient = Pick<
  GoodfriendsClient,
  'ensureAuthenticated' | 'getFeed' | 'getComments' | 'getPostingCategory' | 'createPost' | 'createComment' | 'toggleReaction' | 'toggleCommentReaction'
>;

export interface SocialAgentOptions {
  /** 기본 config.dryRun(DRY_RUN 환경변수, 기본 true). */
  dryRun?: boolean;
  /** 테스트용 클라이언트 주입. 기본 GoodfriendsClient(persona). */
  client?: AgentClient;
}

export class SocialAgent {
  public persona: AgentPersona;
  private client: AgentClient;
  private llm: LlmClient;
  private writer: WriterService;
  private stateManager: StateManager;
  private registry: PersonaRegistry;
  private postLock: PostInteractionLock;
  private dryRun: boolean;

  constructor(
    persona: AgentPersona,
    llm: LlmClient,
    writer: WriterService,
    stateManager: StateManager,
    registry: PersonaRegistry,
    postLock: PostInteractionLock,
    options: SocialAgentOptions = {}
  ) {
    this.persona = persona;
    this.llm = llm;
    this.writer = writer;
    this.stateManager = stateManager;
    this.registry = registry;
    this.postLock = postLock;
    this.dryRun = options.dryRun ?? config.dryRun;
    this.client = options.client ?? new GoodfriendsClient(persona);

    // Initial state registration
    this.stateManager.initOrUpdateState(persona.id, {
      id: persona.id,
      name: persona.name,
      nickname: persona.nickname,
      email: persona.email,
      status: 'idle',
    });
  }

  /**
   * 세이프티 게이트 + 인코딩 깨짐(대체 문자 �) 검사를 합쳐서 판정한다. 후자는 브랜드/독성
   * 문제가 아니라 순수 품질 문제라 content-gate.ts에는 안 넣고 여기서 합침 — 둘 다 같은
   * "1회 재생성 후 포기" 흐름을 타야 해서(품질 나쁜 글을 그대로 올리느니 스킵하는 게 나음).
   */
  private evaluateGeneratedText(text: string): SafetyCheckResult {
    if (hasEncodingCorruption(text)) {
      return { safe: false, reason: '텍스트 인코딩 깨짐(대체 문자 감지)' };
    }
    return checkContentSafety(text);
  }

  /** 최근 작성한 글/댓글 발췌(반복 방지 프롬프트용). enrichment 없는 페르소나도 그냥 빈 배열. */
  private getRecentTexts(): string[] {
    return this.stateManager.getAgentState(this.persona.id)?.recentTexts ?? [];
  }

  /**
   * 콘텐츠 세이프티 게이트를 통과하는 댓글을 생성한다.
   * 거부되면 1회 재생성 후, 그래도 거부되면 null 반환 + 로그(스킵) — 결정된 기본 동작.
   */
  private async generateSafeComment(
    post: CommunityPost,
    moodModifier: string,
    sessionId: string,
    existingComments: CommunityComment[] = []
  ): Promise<string | null> {
    const recentTexts = this.getRecentTexts();
    // 이미 달린 댓글을 넘겨서 같은 도입부·같은 관점이 겹치는 걸 막는다(llm-client 참고).
    const priorComments = existingComments.map((c) => ({ authorNickname: c.authorNickname, body: c.body }));
    let body = await this.llm.generateComment(this.persona, post, moodModifier, recentTexts, priorComments);
    if (!body) return null;

    let check = this.evaluateGeneratedText(body);
    if (!check.safe) {
      body = await this.llm.generateComment(this.persona, post, moodModifier, recentTexts, priorComments);
      if (!body) return null;
      check = this.evaluateGeneratedText(body);
    }

    if (!check.safe) {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `'${post.title}' 글 댓글이 세이프티 게이트에 최종 차단됨 (${check.reason}) — 스킵`,
        targetId: post.id,
        targetTitle: post.title,
        sessionId,
      });
      return null;
    }

    return body;
  }

  /**
   * 콘텐츠 세이프티 게이트를 통과하는 대댓글(답글)을 생성한다. 거부 시 처리는 댓글과 동일.
   */
  private async generateSafeReply(
    post: CommunityPost,
    parentComment: CommunityComment,
    moodModifier: string,
    sessionId: string
  ): Promise<string | null> {
    const recentTexts = this.getRecentTexts();
    let body = await this.llm.generateReply(this.persona, post, parentComment, moodModifier, recentTexts);
    if (!body) return null;

    let check = this.evaluateGeneratedText(body);
    if (!check.safe) {
      body = await this.llm.generateReply(this.persona, post, parentComment, moodModifier, recentTexts);
      if (!body) return null;
      check = this.evaluateGeneratedText(body);
    }

    if (!check.safe) {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `'${parentComment.authorNickname}'님 댓글에 대한 답글이 세이프티 게이트에 최종 차단됨 (${check.reason}) — 스킵`,
        targetId: post.id,
        targetTitle: post.title,
        sessionId,
      });
      return null;
    }

    return body;
  }

  /** 사람처럼 보이게 하는 대기. DRY_RUN은 아무 것도 게시하지 않으므로 기다리지 않는다. */
  private async pause(minSec: number, maxSec: number): Promise<void> {
    if (!this.dryRun) await humanPause(minSec, maxSec);
  }

  /** DRY_RUN에서 "원래라면 했을 쓰기"를 활동 로그에만 남긴다(서버 호출 없음). */
  private logDryRun(sessionId: string, summary: string, post: { id: string; title: string }, details: Record<string, any>): void {
    this.stateManager.addLog({
      agentId: this.persona.id,
      agentName: this.persona.nickname,
      type: 'dry-run',
      summary: `[dry-run] ${summary}`,
      targetId: post.id,
      targetTitle: post.title,
      details: { ...details, dryRun: true },
      sessionId,
    });
  }

  /**
   * 새 글 1편: writer 파이프라인(리서치→작성→검증→이미지→최종 게이트)을 돌려 drafts에 저장한다.
   * DRY_RUN이면 게시하지 않고, 아니면 passed만 createPost로 올린다. 반환: 게시/저장한 글 제목 또는 null.
   */
  private async writeNewPost(targetCategory: CommunityCategory, sessionId: string): Promise<string | null> {
    const mode: PublishMode = this.dryRun
      ? { dryRun: true }
      : { dryRun: false, publish: (post) => this.client.createPost({ categoryId: targetCategory.id, title: post.title, body: post.body }) };
    const { draft, result, published } = await this.writer.produce(this.persona, targetCategory.slug, mode, {
      recentTexts: this.getRecentTexts(),
      feed: this.client,
    });

    if (result.status !== 'passed') {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'search',
        summary: `[${targetCategory.name}] 글 초안을 폐기했습니다(${result.reasons.join('; ') || '사유 없음'})`,
        details: { draftId: draft.id, reasons: result.reasons, topic: result.topic },
        sessionId,
      });
      return null;
    }

    if (this.dryRun) {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'dry-run',
        summary: `[dry-run] [${targetCategory.name}] 글 초안을 저장했습니다(게시 안 함): "${result.title}"`,
        targetTitle: result.title,
        details: { body: result.body, category: targetCategory.name, draftId: draft.id, dryRun: true },
        sessionId,
      });
      return result.title;
    }

    if (published?.ok) {
      this.stateManager.recordRecentText(this.persona.id, `${result.title} - ${result.body}`);
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'post',
        summary: `[${targetCategory.name}] 카테고리에 새 글을 등록했습니다: "${result.title}"`,
        targetId: published.id,
        targetTitle: result.title,
        details: { body: result.body, category: targetCategory.name, draftId: draft.id },
        sessionId,
      });
      return result.title;
    }

    // 공감/댓글 실패는 항상 error 로그를 남기는데 글쓰기 실패만 조용히 넘어가던 버그가 있었다.
    // 카테고리 ID는 서버에서 조회한 값이고 이메일 미인증(EMAIL_NOT_VERIFIED) 등도 여기로 오므로 묻히면 원인 추적이 어렵다.
    this.stateManager.addLog({
      agentId: this.persona.id,
      agentName: this.persona.nickname,
      type: 'error',
      summary: `[${targetCategory.name}] 새 글 작성 실패: ${published?.error || '알 수 없는 오류'}`,
      details: { draftId: draft.id },
      sessionId,
    });
    return null;
  }

  /**
   * 에이전트 1회 자율 소셜 활동 세션 실행
   */
  public async runSession(): Promise<{ ok: boolean; summary: string }> {
    const sessionId = newSessionId();
    console.log(`\n🤖 [Agent:${this.persona.nickname}] Starting active session... (${sessionId})`);
    this.stateManager.initOrUpdateState(this.persona.id, { status: 'running' });

    try {
      // 1. 인증 확인 — DRY_RUN은 가입·로그인을 하지 않는다(실서버에 쓰기 금지). 아래 조회는 읽기 전용 GET만.
      if (!this.dryRun) {
        const isAuth = await this.client.ensureAuthenticated();
        if (!isAuth) {
          throw new Error('goodfriends 로그인/가입 실패');
        }
      }
      this.stateManager.initOrUpdateState(this.persona.id, { sessionActive: true });

      let actionsDone: string[] = [];

      // 무드 드리프트: 현재 무드를 프롬프트 보정 문구로 변환 (아웃사이드 보이스 지적 — 감쇠 있어 무한 표류 안 함)
      const currentMood = this.stateManager.getAgentState(this.persona.id)?.moodDrift ?? 0;
      const moodModifier = moodToneModifier(currentMood);

      // 동료 에이전트 닉네임 집합 (실사용자 vs 우리 쪽 봇 구분용)
      const agentNicknames = new Set(this.registry.getAll().map((p) => p.nickname));

      // 2. 피드 탐색 (홈 피드 + 선호 카테고리)
      const feedPosts = await this.client.getFeed({ limit: FEED_SCAN_LIMIT, sort: 'latest' });
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'browse',
        summary: `홈 피드에서 ${feedPosts.length}개의 게시글을 둘러보았습니다.`,
        sessionId,
      });

      // 3. 관심 글 평가 및 소셜 리액션/댓글/대댓글/댓글공감 작성
      let commentedCount = 0;
      let reactedCount = 0;
      let commentReactedCount = 0;
      let crossAgentInteractionsSoFar = 0;

      // 본인이 작성한 글은 상호작용 대상에서 제외 (REGRESSION 대상 — interaction-rules.ts로 추출)
      const candidatePosts = filterOwnPosts(feedPosts, this.persona);

      for (const post of candidatePosts) {
        // 봇-링 탐지 신호 완화: 동료 에이전트 글과의 상호작용은 세션당 1개까지만
        if (!canInteractWithPost(post, agentNicknames, crossAgentInteractionsSoFar)) continue;
        const interactingWithFellowAgent = isFellowAgentPost(post, agentNicknames);

        // 동시반응 방지: 방금 다른 에이전트가 이 글에 반응했다면 스킵 (동시에 몰려드는 것처럼 안 보이게)
        if (this.postLock.isLocked(post.id)) continue;

        // LLM으로 글 관심도 평가
        const evalResult = await this.llm.evaluatePostInterest(this.persona, post);
        if (!evalResult.interested) continue;

        let interactedWithThisPost = false;

        // 공감(하트) 액션
        if (evalResult.shouldReact && Math.random() < this.persona.reactionProb) {
          const reactRes = this.dryRun ? null : await this.client.toggleReaction(post.id);
          if (!reactRes) {
            reactedCount++;
            interactedWithThisPost = true;
            this.logDryRun(sessionId, `'${post.title}' 글에 공감(하트)을 남길 예정이었습니다.`, post, {
              reason: evalResult.reason, targetType: 'post', targetBody: post.bodyPreview,
            });
          } else if (reactRes.ok) {
            reactedCount++;
            interactedWithThisPost = true;
            this.stateManager.addLog({
              agentId: this.persona.id,
              agentName: this.persona.nickname,
              type: 'reaction',
              summary: `'${post.title}' 글에 공감(하트)을 남겼습니다.`,
              targetId: post.id,
              targetTitle: post.title,
              details: { reason: evalResult.reason, targetType: 'post', targetBody: post.bodyPreview },
              sessionId,
            });
          } else {
            this.stateManager.addLog({
              agentId: this.persona.id,
              agentName: this.persona.nickname,
              type: 'error',
              summary: `'${post.title}' 글에 공감 실패: ${reactRes.error || '알 수 없는 오류'}`,
              targetId: post.id,
              targetTitle: post.title,
              sessionId,
            });
          }
        }

        // 기존 댓글 목록 조회 (댓글 공감 / 대댓글 대상 파악용)
        let comments: CommunityComment[] = [];
        if (post.commentCount > 0) {
          comments = await this.client.getComments(post.id);
        }

        // 댓글 공감(좋아요) — 본인 댓글·이미 공감한 댓글 제외, 최대 2개
        for (const targetComment of pickCommentsToReact(comments, this.persona)) {
          const commentReactRes = this.dryRun ? null : await this.client.toggleCommentReaction(targetComment.id);
          if (!commentReactRes) {
            commentReactedCount++;
            interactedWithThisPost = true;
            this.logDryRun(sessionId, `'${targetComment.authorNickname}'님의 댓글에 공감을 남길 예정이었습니다.`, { id: targetComment.id, title: post.title }, {
              targetType: 'comment', targetBody: targetComment.body,
            });
          } else if (commentReactRes.ok) {
            commentReactedCount++;
            interactedWithThisPost = true;
            this.stateManager.addLog({
              agentId: this.persona.id,
              agentName: this.persona.nickname,
              type: 'reaction',
              summary: `'${targetComment.authorNickname}'님의 댓글에 공감을 남겼습니다.`,
              targetId: targetComment.id,
              targetTitle: post.title,
              details: { targetType: 'comment', targetBody: targetComment.body },
              sessionId,
            });
          } else {
            this.stateManager.addLog({
              agentId: this.persona.id,
              agentName: this.persona.nickname,
              type: 'error',
              summary: `'${targetComment.authorNickname}'님의 댓글 공감 실패: ${commentReactRes.error || '알 수 없는 오류'}`,
              targetId: targetComment.id,
              targetTitle: post.title,
              sessionId,
            });
          }
        }

        // 댓글 또는 대댓글 작성 (한 세션당 최대 2개로 조절 + 글당 1회 — 자기 루프 방지)
        const alreadyCommented = this.stateManager.hasCommentedOnPost(this.persona.id, post.id);
        if (
          evalResult.shouldComment &&
          commentedCount < MAX_COMMENTS_PER_SESSION &&
          !alreadyCommented &&
          Math.random() < this.persona.commentProb
        ) {
          const replyTarget = Math.random() < REPLY_VS_TOPLEVEL_PROB ? pickReplyTarget(comments, this.persona) : null;

          // 글을 읽고 댓글을 쓰기까지 사람이 쓰는 시간. 없으면 "28초 만에 네 줄 댓글" /
          // "다른 계정과 0.19초 차 동시 댓글"이 그대로 찍힌다.
          await this.pause(40, 240);

          if (replyTarget) {
            // 대댓글(답글)
            const replyBody = await this.generateSafeReply(post, replyTarget, moodModifier, sessionId);
            if (replyBody) {
              const replyRes = this.dryRun
                ? null
                : await this.client.createComment({
                    postId: post.id,
                    body: replyBody,
                    parentCommentId: replyTarget.id,
                  });
              if (!replyRes) {
                // DRY_RUN: 로컬 상태(commentedPostIds·recentTexts)도 건드리지 않는다 — 실제로 쓰지 않았으므로.
                commentedCount++;
                interactedWithThisPost = true;
                this.logDryRun(sessionId, `'${replyTarget.authorNickname}'님의 댓글에 답글을 남길 예정이었습니다: "${replyBody}"`, post, {
                  comment: replyBody, parentCommentId: replyTarget.id, isReply: true,
                });
              } else if (replyRes.ok) {
                commentedCount++;
                interactedWithThisPost = true;
                this.stateManager.recordCommentedPost(this.persona.id, post.id);
                this.stateManager.recordRecentText(this.persona.id, replyBody);
                this.stateManager.addLog({
                  agentId: this.persona.id,
                  agentName: this.persona.nickname,
                  type: 'comment',
                  summary: `'${replyTarget.authorNickname}'님의 댓글에 답글을 남겼습니다: "${replyBody}"`,
                  targetId: post.id,
                  targetTitle: post.title,
                  details: { comment: replyBody, parentCommentId: replyTarget.id, isReply: true },
                  sessionId,
                });
              } else {
                this.stateManager.addLog({
                  agentId: this.persona.id,
                  agentName: this.persona.nickname,
                  type: 'error',
                  summary: `'${replyTarget.authorNickname}'님 댓글에 답글 작성 실패: ${replyRes.error || '알 수 없는 오류'}`,
                  targetId: post.id,
                  targetTitle: post.title,
                  sessionId,
                });
              }
            }
          } else {
            // 글에 다는 일반 댓글
            const commentBody = await this.generateSafeComment(post, moodModifier, sessionId, comments);
            if (commentBody) {
              const commentRes = this.dryRun
                ? null
                : await this.client.createComment({
                    postId: post.id,
                    body: commentBody,
                  });
              if (!commentRes) {
                commentedCount++;
                interactedWithThisPost = true;
                this.logDryRun(sessionId, `'${post.title}' 글에 댓글을 남길 예정이었습니다: "${commentBody}"`, post, {
                  comment: commentBody, reason: evalResult.reason,
                });
              } else if (commentRes.ok) {
                commentedCount++;
                interactedWithThisPost = true;
                this.stateManager.recordCommentedPost(this.persona.id, post.id);
                this.stateManager.recordRecentText(this.persona.id, commentBody);
                this.stateManager.addLog({
                  agentId: this.persona.id,
                  agentName: this.persona.nickname,
                  type: 'comment',
                  summary: `'${post.title}' 글에 댓글을 작성했습니다: "${commentBody}"`,
                  targetId: post.id,
                  targetTitle: post.title,
                  details: { comment: commentBody, reason: evalResult.reason },
                  sessionId,
                });
              } else {
                this.stateManager.addLog({
                  agentId: this.persona.id,
                  agentName: this.persona.nickname,
                  type: 'error',
                  summary: `'${post.title}' 글에 댓글 작성 실패: ${commentRes.error || '알 수 없는 오류'}`,
                  targetId: post.id,
                  targetTitle: post.title,
                  sessionId,
                });
              }
            }
          }
        }

        if (interactedWithThisPost) {
          this.postLock.recordInteraction(post.id);
        }
        if (interactingWithFellowAgent && interactedWithThisPost) {
          crossAgentInteractionsSoFar++;
        }
      }

      const dryTag = this.dryRun ? ' (dry-run)' : '';
      if (reactedCount > 0) actionsDone.push(`공감 ${reactedCount}건${dryTag}`);
      if (commentReactedCount > 0) actionsDone.push(`댓글공감 ${commentReactedCount}건${dryTag}`);
      if (commentedCount > 0) actionsDone.push(`댓글/답글 ${commentedCount}건${dryTag}`);

      // 4. 새 글 작성 (확률 기반) — writer 파이프라인(리서치→작성→검증→이미지). 글쓰기는 프로세스 전체에서 동시에 1개.
      if (Math.random() < this.persona.postProb) {
        // 댓글 단 직후 1.3~19.6초 만에 본인 글이 올라오는 게 세션 플로우 서명 그 자체였다.
        // 댓글 쪽보다 더 크게 벌려서 "읽기 → 반응 → 한참 뒤 글쓰기"처럼 보이게 한다.
        if (actionsDone.length > 0) await this.pause(120, 600);

        const targetCategory = await this.client.getPostingCategory(this.persona.preferredCategories);
        if (!targetCategory) {
          this.stateManager.addLog({
            agentId: this.persona.id,
            agentName: this.persona.nickname,
            type: 'error',
            summary: `담당 카테고리(${this.persona.preferredCategories.join(', ')})를 서버 카테고리 목록(GET /api/categories)에서 찾지 못해 새 글 작성을 건너뜁니다.`,
            sessionId,
          });
        } else {
          const title = await this.writeNewPost(targetCategory, sessionId);
          if (title) actionsDone.push(this.dryRun ? `새 글 초안 저장('${title}', dry-run)` : `새 글 작성('${title}')`);
        }
      }

      const finalSummary = actionsDone.length > 0 ? actionsDone.join(', ') : '둘러보기 완료 (특이 반응 없음)';
      console.log(`✅ [Agent:${this.persona.nickname}] Session finished: ${finalSummary}`);

      // 무드 드리프트 갱신: 활동이 있었으면 살짝 들뜨고, 없었으면 살짝 가라앉음. 매 세션 원점으로 감쇠(무한 표류 방지).
      const moodDelta = actionsDone.length > 0 ? 0.3 : -0.1;
      const nextMood = driftMood(currentMood, moodDelta);

      this.stateManager.initOrUpdateState(this.persona.id, {
        status: 'sleeping',
        lastActionSummary: finalSummary,
        moodDrift: nextMood,
      });

      return { ok: true, summary: finalSummary };
    } catch (err: any) {
      console.error(`❌ [Agent:${this.persona.nickname}] Session error:`, err.message);
      this.stateManager.initOrUpdateState(this.persona.id, {
        status: 'error',
        lastActionSummary: `에러: ${err.message}`,
      });
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `세션 진행 중 오류 발생: ${err.message}`,
        sessionId,
      });
      return { ok: false, summary: err.message };
    }
  }
}
