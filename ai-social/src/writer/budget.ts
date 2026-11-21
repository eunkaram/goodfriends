/**
 * 글 1편의 최악 실행 시간 제한: 전체 데드라인 + LLM 호출 수 상한.
 * LLM(chat·vision) 호출을 감싸서 상한·데드라인을 넘으면 던지고, 남은 시간으로 호출 타임아웃을 줄인다.
 * 단계 코드가 LLM 오류를 삼키더라도(facts는 청크 단위로 건너뜀) budget.aborted가 남으므로 호출부가 확인할 수 있다.
 */
import type { ChatMessage, ChatOptions } from '../llm/llm-client.js';
import type { VisionFn } from './images.js';
import type { WriterLlm } from './write-types.js';

export type AbortReason = 'deadline' | 'llm-limit';

export class RunAborted extends Error {
  constructor(public readonly reason: AbortReason) {
    super(`writer run aborted: ${reason}`);
    this.name = 'RunAborted';
  }
}

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export class RunBudget {
  aborted: AbortReason | null = null;
  llmCalls = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: { deadlineMs: number; maxLlmCalls: number },
    private readonly now: () => number = Date.now
  ) {
    this.startedAt = now();
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return this.limits.deadlineMs - this.elapsedMs();
  }

  /** 데드라인을 넘었으면 aborted를 세운다. 이미 aborted면 그 사유를 유지. */
  check(): AbortReason | null {
    if (!this.aborted && this.remainingMs() <= 0) this.aborted = 'deadline';
    return this.aborted;
  }

  abort(reason: AbortReason): void {
    this.aborted ??= reason;
  }

  /** 호출 1회분을 소비한다. 한도·데드라인을 넘었으면 RunAborted. 허용되면 이 호출에 줄 수 있는 최대 타임아웃(ms)을 돌려준다. */
  private spend(requestedTimeoutMs: number | undefined): number {
    if (this.check()) throw new RunAborted(this.aborted!);
    if (this.llmCalls >= this.limits.maxLlmCalls) {
      this.abort('llm-limit');
      throw new RunAborted('llm-limit');
    }
    this.llmCalls++;
    return Math.max(1, Math.min(requestedTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, this.remainingMs()));
  }

  wrapLlm(llm: WriterLlm): WriterLlm {
    return {
      chat: (messages: ChatMessage[], jsonMode?: boolean, options: ChatOptions = {}) => {
        const timeoutMs = this.spend(options.timeoutMs);
        return llm.chat(messages, jsonMode, { ...options, timeoutMs });
      },
    };
  }

  wrapVision(vision: VisionFn): VisionFn {
    return (req) => {
      const timeoutMs = this.spend(req.timeoutMs);
      return vision({ ...req, timeoutMs });
    };
  }

  /** 데드라인에 reject되는 Promise(+정리 함수). 파이프라인과 race시켜 멈춘 호출에 매이지 않게 한다. */
  deadlineGuard(): { promise: Promise<never>; clear: () => void } {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.abort('deadline');
        reject(new RunAborted('deadline'));
      }, Math.max(0, this.remainingMs()));
    });
    promise.catch(() => {});
    return { promise, clear: () => clearTimeout(timer) };
  }
}
