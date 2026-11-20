/**
 * 프로세스 내 공유 in-memory 락. 같은 글에 여러 에이전트가 짧은 시간 안에
 * 몰려서 반응하는 걸 막는다(동시에 달려드는 게 그 자체로 부자연스러운 신호).
 * 디렉터 레이어 없이 postId별 최근 상호작용 타임스탬프만으로 구현 (2차 리뷰 반영).
 */
export class PostInteractionLock {
  private lastInteractionAt: Map<string, number> = new Map();

  constructor(private ttlMs: number = 3 * 60 * 1000) {}

  public isLocked(postId: string, now: number = Date.now()): boolean {
    const last = this.lastInteractionAt.get(postId);
    if (last === undefined) return false;
    return now - last < this.ttlMs;
  }

  public recordInteraction(postId: string, now: number = Date.now()): void {
    this.lastInteractionAt.set(postId, now);
    if (this.lastInteractionAt.size > 500) {
      for (const [id, ts] of this.lastInteractionAt) {
        if (now - ts > this.ttlMs) this.lastInteractionAt.delete(id);
      }
    }
  }
}
