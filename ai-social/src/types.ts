export interface CommunityUser {
  id: string;
  username: string;
  nickname: string;
  email: string;
  avatarUrl?: string;
}

export interface CommunityPost {
  /** goodfriends publicId(외부 식별자). 댓글·공감·삭제·상세 조회 모두 이 값으로 부른다. */
  id: string;
  /** 서버 내부 uuid (참고용) */
  internalId?: string;
  title: string;
  bodyPreview: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatarUrl?: string;
  /** 뉴스봇 등 is_agent 계정 글 여부 */
  authorIsAgent?: boolean;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
}

export interface CommunityCategory {
  id: string;
  name: string;
  slug: string;
}

export interface CommunityComment {
  id: string;
  postId: string;
  authorId: string;
  authorUsername: string;
  authorNickname: string;
  body: string;
  createdAt: string;
  reactionCount: number;
  myReaction?: boolean;
  parentCommentId?: string | null;
}

export interface AgentPersona {
  id: string;
  name: string;
  nickname: string;
  email: string;
  password: string;
  birthdate: string;
  country: string;
  postalCode: string;
  /**
   * goodfriends 유저네임(프로필 URL `/@{username}`). 원래는 이메일 로컬파트에서 '.'을 뺀 값으로
   * 유도했는데(가입 로직과 일치), scripts/rename-personas.ts로 계정을 개명하면 이메일과
   * 어긋나므로 개명 후의 실제 값을 여기에 남긴다. 없으면 기존대로 이메일에서 유도한다.
   */
  username?: string;
  bio: string;
  /** 프로필 사진 URL. 없으면 goodfriends 기본 아바타(닉네임 이니셜) 그대로 둠 — 전부 채울 필요는 없음 */
  avatarUrl?: string;
  interests: string[]; // e.g. ['tech', 'broadcast', 'invest']
  preferredCategories: string[]; // slugs: e.g. ['tech', 'chat', 'invest']
  tone: string; // e.g. '전문적이고 논리적인 어조', '친근하고 발랄한 어조 with 이모지'
  systemPrompt: string;
  postProb: number; // probability of writing a new post during an active turn (0.0 ~ 1.0)
  commentProb: number; // probability of writing a comment when viewing interesting post
  reactionProb: number; // probability of hitting empathy/heart
  externalSearchProb: number; // probability of doing external web research for a new post
  minIntervalMinutes: number; // minimum delay before next turn
  maxIntervalMinutes: number; // maximum delay before next turn
  /** false면 스케줄러가 자동/수동 실행 모두 건너뜀 (미지정 시 on으로 취급, 기존 페르소나 호환) */
  enabled?: boolean;
  /**
   * IANA 타임존(예: 'Asia/Seoul', 'America/New_York'). 조용한 시간대(quiet-hours) 판정을
   * 이 시간대 기준으로 해서, 시스템 전체는 24시간 돌아가되 에이전트별로 자기 지역 새벽에만
   * 쉬게 한다. 미지정 시 'Asia/Seoul'로 취급(기존 페르소나 호환).
   */
  timezone?: string;

  // --- 아래는 enriched-community-agents.json 적용(2026-09-06) 관련 확장 필드.
  // 전부 optional — 없는 페르소나(제너레이터 기본 생성분 등)는 기존 동작 그대로 유지된다.

  /** 역할/맥락/현재 상태. 없으면 이 페르소나는 아직 enrichment가 적용 안 된 것. */
  persona?: {
    role: string;
    primaryBoards: string[];
    values: string;
    perspective: string;
    /** 최근에 겪은 구체적 장면 — 글 소재/도입부에 자연스럽게 녹아들게 하는 용도 */
    recentContext: string;
    /** 오늘 기분(텍스트) — 반응 방식/톤에 반영 */
    baselineMood: string;
    /** 오늘 활동을 얼마나 하고 싶은지(텍스트) — 반응 빈도/글 길이에 반영 */
    socialEnergy: string;
  };
  /** 성격/감정 프로필 */
  emotionalProfile?: {
    trait: string;
    core: string;
    trigger: string;
    repair: string;
    style: string;
  };
  /** 활동 유형별 행동 기준(LLM 프롬프트에 그대로 지시문으로 들어감) */
  communityBehavior?: {
    post: string;
    comment: string;
    reaction: string;
    disagreement: string;
    continuity: string;
  };
  /**
   * enrichment 적용 전 원본 bio/tone/systemPrompt 보존(사용자 요청: "기존 원본 데이터는
   * 삭제하지 말고 마이그레이션 가능한 형태로 보존"). enrich.ts의 applyEnrichment가 채운다.
   */
  legacy?: {
    bio: string;
    tone: string;
    systemPrompt: string;
  };
}

export interface AgentActivityLog {
  id: string;
  agentId: string;
  agentName: string;
  type: 'post' | 'comment' | 'reaction' | 'search' | 'browse' | 'error';
  summary: string;
  targetId?: string;
  targetTitle?: string;
  details?: Record<string, any>;
  timestamp: string;
  /** 같은 runSession() 호출에서 나온 로그를 묶는 상관관계 ID (세션 리플레이용) */
  sessionId?: string;
}

export interface AgentState {
  id: string;
  name: string;
  nickname: string;
  email: string;
  status: 'idle' | 'running' | 'sleeping' | 'error';
  lastActiveAt?: string;
  nextActiveAt?: string;
  sessionActive: boolean;
  totalPosts: number;
  totalComments: number;
  totalReactions: number;
  lastActionSummary?: string;
  /** 무드 드리프트 값 (-1~1). 매 세션 원점으로 감쇠, 무제한 표류 방지. */
  moodDrift?: number;
  /** 이미 댓글을 남긴 postId 목록 (스레드당 코멘트 상한 = 자기 루프 방지용, 최근 N개만 보관) */
  commentedPostIds?: string[];
  /**
   * 이 에이전트가 최근에 작성한 글/댓글의 앞부분 발췌(최근 N개만 보관). 다음 생성 프롬프트에
   * "최근에 이렇게 썼으니 다르게 써라"로 넣어서 문장 구조·도입부가 매번 반복되는 걸 막는다.
   */
  recentTexts?: string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  /** 대표 이미지 URL. 목록 페이지의 썸네일(RSS enclosure/media, 게시판 썸네일) 또는 개별 글
   * 페이지의 og:image에서 채워짐 — 없으면 undefined */
  imageUrl?: string;
  /** 원문 페이지의 인코딩. 개별 글 본문/이미지를 추가로 가져올 때(fetchPageMeta) 필요 */
  encoding?: 'utf-8' | 'euc-kr';
  /** research/sources.ts의 ResearchSource.id. 개별 글 페이지를 가져올 때 그 소스의 bodyPattern을
   * 다시 찾기 위해 필요 (RSS 검색 결과 등 sources.ts에서 안 나온 경우 undefined) */
  sourceId?: string;
  /** 원문 페이지에서 가져온 실제 본문(텍스트+이미지/동영상을 원래 위치 그대로 보존, 없으면
   * <meta name="description"> 발췌로 폴백). "퍼온글"을 원문 그대로 포스팅할 때 이 값을 그대로
   * 쓴다 — 없으면(못 가져왔으면) LLM이 title/snippet만 보고 새로 쓴다. */
  fullBody?: string;
}
