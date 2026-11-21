/**
 * 글쓰기 직렬화. mlx-serve는 동시 요청에 약하고 글 1편이 LLM 수십 회를 쓰므로,
 * 프로세스 전체에서 글쓰기(주제 선정~이미지)는 동시에 1개만 돌린다(대기열은 FIFO).
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  private running = 0;
  private waiting = 0;

  /** 지금 실행 중인 수(0 또는 1)와 대기 중인 수. 대시보드·테스트용. */
  get state(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting };
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.waiting++;
    const result = this.tail.then(async () => {
      this.waiting--;
      this.running++;
      try {
        return await fn();
      } finally {
        this.running--;
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** 프로세스 전역 글쓰기 뮤텍스(스케줄러의 모든 에이전트·CLI가 공유). */
export const globalWriteMutex = new Mutex();
