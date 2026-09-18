import type { StrategyResult } from "../trace/types.ts";

export const DEFAULT_MAX_ITERATIONS = 12;

export interface RunOptions {
  maxIterations?: number;
  /**
   * Cancels the run in progress (003-chat-http-api, FR-020). Optional and
   * additive — arena and bench keep calling `run()` without it, unchanged.
   * With state shared across HTTP requests, a run that outlives its
   * deadline would otherwise keep writing to state the next request reads;
   * this is what lets the HTTP layer actually stop the work, not just stop
   * waiting for it.
   */
  signal?: AbortSignal;
}

/** Contract every reasoning strategy implements (FR-001 to FR-006). */
export interface ReasoningStrategy {
  readonly name: string;
  run(input: string, options?: RunOptions): Promise<StrategyResult>;
}
