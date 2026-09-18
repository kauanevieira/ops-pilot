import type { StrategyResult } from "../trace/types.ts";

export const DEFAULT_MAX_ITERATIONS = 12;

export interface RunOptions {
  maxIterations?: number;
}

/** Contract every reasoning strategy implements (FR-001 to FR-006). */
export interface ReasoningStrategy {
  readonly name: string;
  run(input: string, options?: RunOptions): Promise<StrategyResult>;
}
