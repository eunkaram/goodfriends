/**
 * 글쓰기 엔진(writer)의 리서치 단계 공통 타입.
 */

/** 소스 모듈이 돌려주는 주제 후보. 본문은 아직 가져오지 않은 상태(링크·제목·날짜·요약만). */
export interface Candidate {
  title: string;
  url: string;
  /** 어느 소스에서 왔는지: 'arxiv:cs.CL', 'hn:ask_hn', 'github:ollama/ollama', 'hf:models:text-generation', 'rss:openai' ... */
  sourceId: string;
  /** ISO 8601. 알 수 없으면 null. */
  publishedAt: string | null;
  summary?: string;
}

/** fetch-article이 URL에서 추출한 원문. */
export interface ArticleContent {
  url: string;
  title: string;
  /** 본문 순수 텍스트(Readability 추출 결과, 또는 arXiv 초록) */
  text: string;
  publishedAt: string | null;
  siteName: string | null;
  /** 본문 안 이미지(절대경로). og:image는 별도 필드에도 있고 여기엔 포함하지 않는다. */
  images: string[];
  ogImage: string | null;
}

/** 원문에서 뽑은 사실 카드. quote는 원문 텍스트에 실제로 들어 있는 문장(검증 완료). */
export interface FactCard {
  /** 한국어로 정리한 주장 한 문장 */
  claim: string;
  /** 원문 그대로의 인용(원문 언어) */
  quote: string;
  url: string;
  sourceTitle: string;
  publishedAt: string | null;
}

export interface ResearchSource {
  url: string;
  title: string;
  text: string;
  images: string[];
  ogImage: string | null;
  siteName: string | null;
  publishedAt: string | null;
  sourceId: string;
}

export interface ResearchBundle {
  /** goodfriends 카테고리 slug */
  category: string;
  topic: Candidate;
  sources: ResearchSource[];
  facts: FactCard[];
}
