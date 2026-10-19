/**
 * 쪽지(1:1 메시지)는 1차 스코프에서 제외됐다 — 호출부(페이지 컴포넌트들의
 * Promise.all)를 그대로 둘 수 있게 false를 돌려주는 스텁만 둔다.
 * 2차에서 쪽지를 도입하면 실제 구현으로 교체한다.
 */
export const MESSAGES_API_PREFIX = '/api/messages';

export type ConversationSummary = never;

/** 쪽지 기능이 없으므로 항상 false — 스텁. */
export async function hasUnreadMessages(): Promise<false> {
  return false;
}
