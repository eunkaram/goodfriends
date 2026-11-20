import type { AgentPersona, CommunityComment, CommunityPost, WebSearchResult } from '../types.js';
import { GoodfriendsClient } from '../client/goodfriends-client.js';
import { LlmClient } from '../llm/llm-client.js';
import { WebResearcher } from '../research/web-search.js';
import { StateManager } from './state.js';
import type { PersonaRegistry } from '../personas/registry.js';
import { filterOwnPosts, canInteractWithPost, isFellowAgentPost, isRepeatedTitle } from './interaction-rules.js';
import { pickCommentsToReact, pickReplyTarget } from './comment-rules.js';
import { driftMood, moodToneModifier } from './mood.js';
import type { PostInteractionLock } from './post-interaction-lock.js';
import { checkContentSafety, type SafetyCheckResult } from '../safety/content-gate.js';
import { hasEncodingCorruption } from '../llm/sanitize.js';
import { insertImageMidBody } from './post-image.js';

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

export class SocialAgent {
  public persona: AgentPersona;
  private client: GoodfriendsClient;
  private llm: LlmClient;
  private researcher: WebResearcher;
  private stateManager: StateManager;
  private registry: PersonaRegistry;
  private postLock: PostInteractionLock;

  constructor(
    persona: AgentPersona,
    llm: LlmClient,
    researcher: WebResearcher,
    stateManager: StateManager,
    registry: PersonaRegistry,
    postLock: PostInteractionLock
  ) {
    this.persona = persona;
    this.llm = llm;
    this.researcher = researcher;
    this.stateManager = stateManager;
    this.registry = registry;
    this.postLock = postLock;
    this.client = new GoodfriendsClient(persona);

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

  /**
   * 콘텐츠 세이프티 게이트를 통과하는 새 글을 생성한다. 거부 시 처리는 댓글과 동일.
   */
  private async generateSafePost(
    categoryName: string,
    externalContent: WebSearchResult | null,
    moodModifier: string,
    sessionId: string
  ): Promise<{ title: string; body: string } | null> {
    const recentTexts = this.getRecentTexts();
    let postData = await this.llm.generatePost(this.persona, categoryName, externalContent, moodModifier, recentTexts);
    if (!postData) {
      // generatePost는 evaluatePostInterest와 달리 폴백이 없어서(글 내용을 랜덤으로 지어낼 수는
      // 없으니) JSON 파싱 실패 등으로 한 번 null이 나오면 1회 재시도해본다.
      postData = await this.llm.generatePost(this.persona, categoryName, externalContent, moodModifier, recentTexts);
    }
    if (!postData) {
      // 예전엔 여기서 그냥 조용히 null 반환 — console.error로만 남고 대시보드엔 전혀 안 보여서
      // "글을 아예 안 쓴다"는 게 실제로는 LLM 생성 실패였는지 확률상 안 뽑힌 건지 구분이 안 됐다.
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `[${categoryName}] LLM이 새 글 생성에 실패함(재시도 포함) — 스킵`,
        sessionId,
      });
      return null;
    }

    // 같은 계정이 같은 제목의 글을 또 올리는 걸 코드에서 막는다(프롬프트 지시만으론 재발함).
    if (isRepeatedTitle(postData.title, recentTexts)) {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `[${categoryName}] 최근 글과 제목이 거의 같아 재생성함: "${postData.title}"`,
        sessionId,
      });
      const retry = await this.llm.generatePost(this.persona, categoryName, externalContent, moodModifier, recentTexts);
      if (retry && !isRepeatedTitle(retry.title, recentTexts)) postData = retry;
      else return null;
    }

    let check = this.evaluateGeneratedText(`${postData.title}\n${postData.body}`);

    if (!check.safe) {
      postData = await this.llm.generatePost(this.persona, categoryName, externalContent, moodModifier);
      if (!postData) return null;
      check = this.evaluateGeneratedText(`${postData.title}\n${postData.body}`);
    }

    if (!check.safe) {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `[${categoryName}] 새 글이 세이프티 게이트에 최종 차단됨 (${check.reason}) — 스킵`,
        sessionId,
      });
      return null;
    }

    return postData;
  }

  /**
   * "퍼온글": LLM으로 다시 쓰지 않고 원문 제목/본문을 그대로 쓴다(사용자 요청 — 실제 커뮤니티의
   * '펌글' 문화처럼 원문을 그대로 공유). 그래도 PII/독성/인코딩 문제는 걸러야 하지만, 원문이라
   * 재생성은 불가능 — 세이프티 게이트에 막히면 그냥 이번 턴은 스킵한다.
   */
  private buildVerbatimRepost(externalInfo: WebSearchResult, sessionId: string): { title: string; body: string } | null {
    const title = externalInfo.title;
    const body = externalInfo.fullBody!;
    const check = this.evaluateGeneratedText(`${title}\n${body}`);
    if (!check.safe) {
      this.stateManager.addLog({
        agentId: this.persona.id,
        agentName: this.persona.nickname,
        type: 'error',
        summary: `퍼온글이 세이프티 게이트에 차단됨 (${check.reason}) — 스킵`,
        sessionId,
      });
      return null;
    }
    return { title, body };
  }

  /**
   * 에이전트 1회 자율 소셜 활동 세션 실행
   */
  public async runSession(): Promise<{ ok: boolean; summary: string }> {
    const sessionId = newSessionId();
    console.log(`\n🤖 [Agent:${this.persona.nickname}] Starting active session... (${sessionId})`);
    this.stateManager.initOrUpdateState(this.persona.id, { status: 'running' });

    try {
      // 1. 인증 확인
      const isAuth = await this.client.ensureAuthenticated();
      if (!isAuth) {
        throw new Error('goodfriends 로그인/가입 실패');
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
          const reactRes = await this.client.toggleReaction(post.id);
          if (reactRes.ok) {
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
          const commentReactRes = await this.client.toggleCommentReaction(targetComment.id);
          if (commentReactRes.ok) {
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
          await humanPause(40, 240);

          if (replyTarget) {
            // 대댓글(답글)
            const replyBody = await this.generateSafeReply(post, replyTarget, moodModifier, sessionId);
            if (replyBody) {
              const replyRes = await this.client.createComment({
                postId: post.id,
                body: replyBody,
                parentCommentId: replyTarget.id,
              });
              if (replyRes.ok) {
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
              const commentRes = await this.client.createComment({
                postId: post.id,
                body: commentBody,
              });
              if (commentRes.ok) {
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

      if (reactedCount > 0) actionsDone.push(`공감 ${reactedCount}건`);
      if (commentReactedCount > 0) actionsDone.push(`댓글공감 ${commentReactedCount}건`);
      if (commentedCount > 0) actionsDone.push(`댓글/답글 ${commentedCount}건`);

      // 4. 새 글 작성 (확률 기반)
      if (Math.random() < this.persona.postProb) {
        // 댓글 단 직후 1.3~19.6초 만에 본인 글이 올라오는 게 세션 플로우 서명 그 자체였다.
        // 댓글 쪽보다 더 크게 벌려서 "읽기 → 반응 → 한참 뒤 글쓰기"처럼 보이게 한다.
        if (actionsDone.length > 0) await humanPause(120, 600);

        const targetCategory = await this.client.getRandomCategory(this.persona.preferredCategories);
        if (!targetCategory) {
          this.stateManager.addLog({
            agentId: this.persona.id,
            agentName: this.persona.nickname,
            type: 'error',
            summary: '카테고리 목록(GET /api/categories)을 가져오지 못해 새 글 작성을 건너뜁니다.',
            sessionId,
          });
        } else {
          let externalInfo: WebSearchResult | null = null;

          // 외부 웹 검색 및 최신 트렌드 리서치 수행 여부
          if (Math.random() < this.persona.externalSearchProb) {
            // 페르소나 관심사 전체(interests+preferredCategories)로 검색하면 targetCategory와
            // 무관한 소스가 걸려서(예: 관심사에 tech가 있으면 targetCategory=cooking인데도 tech
            // 기사가 뽑힘) 실제로 카테고리-내용 불일치 게시글이 여러 건 나왔다(2026-09-07).
            // 이 글이 실제로 올라갈 targetCategory 하나로만 검색해야 내용과 카테고리가 맞는다.
            externalInfo = await this.researcher.fetchTrendingTopic([targetCategory.slug], (url) => this.stateManager.hasUsedSourceUrl(url));

            if (externalInfo) {
              this.stateManager.addLog({
                agentId: this.persona.id,
                agentName: this.persona.nickname,
                type: 'search',
                summary: `'${externalInfo.title}' 관련 최신 웹 트렌드 자료를 수집했습니다.`,
                details: { url: externalInfo.url, snippet: externalInfo.snippet },
                sessionId,
              });
            }
          }

          // 새 글 생성: 퍼온글(원문 본문을 가져왔으면)은 그대로, 아니면 LLM이 새로 씀(세이프티 게이트 통과분만)
          const postData = externalInfo?.fullBody
            ? this.buildVerbatimRepost(externalInfo, sessionId)
            : await this.generateSafePost(targetCategory.name, externalInfo, moodModifier, sessionId);
          if (postData) {
            // 소스에 이미지가 있으면 본문 중간에 자연스럽게 끼워 넣는다(끝에 무조건 붙이지 않음 —
            // 사용자 요청). LLM이 옮겨 적다 URL을 깨뜨릴 수 있으니 항상 코드에서 결정적으로 삽입함.
            // 본문의 이미지 URL은 플레인 텍스트로 넣는다(goodfriends가 링크/이미지 미리보기로 렌더링).
            const bodyWithImage = externalInfo?.imageUrl ? insertImageMidBody(postData.body, externalInfo.imageUrl) : postData.body;

            const postRes = await this.client.createPost({
              categoryId: targetCategory.id,
              title: postData.title,
              body: bodyWithImage,
            });

            if (postRes.ok) {
              actionsDone.push(`새 글 작성('${postData.title}')`);
              this.stateManager.recordRecentText(this.persona.id, `${postData.title} - ${postData.body}`);
              if (externalInfo) {
                this.stateManager.recordUsedSourceUrl(externalInfo.url, this.persona.id);
              }
              this.stateManager.addLog({
                agentId: this.persona.id,
                agentName: this.persona.nickname,
                type: 'post',
                summary: `[${targetCategory.name}] 카테고리에 새 글을 등록했습니다: "${postData.title}"`,
                targetId: postRes.id,
                targetTitle: postData.title,
                details: { body: bodyWithImage, category: targetCategory.name, isVerbatimRepost: Boolean(externalInfo?.fullBody) },
                sessionId,
              });
            } else {
              // 공감/댓글 실패는 항상 error 로그를 남기는데 글쓰기 실패만 조용히 넘어가던 버그.
              // 카테고리 ID는 서버에서 조회한 값이고 이메일 미인증(EMAIL_NOT_VERIFIED) 등도 여기로 오므로
              // 이 실패가 조용히 묻히면 원인 추적이 거의 불가능해진다.
              this.stateManager.addLog({
                agentId: this.persona.id,
                agentName: this.persona.nickname,
                type: 'error',
                summary: `[${targetCategory.name}] 새 글 작성 실패: ${postRes.error || '알 수 없는 오류'}`,
                sessionId,
              });
            }
          }
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
