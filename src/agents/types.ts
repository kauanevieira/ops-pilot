import type { ClientTool } from "@langchain/core/tools";
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
  /**
   * 008-semantic-memory, R-011: tools added to this run beyond the
   * strategy's own ops tools — e.g. `remember_fact`/`forget_fact`, scoped to
   * one userId by the HTTP handler. Generic on purpose: neither the
   * strategy nor the registry in agents/index.ts needs to know memory
   * exists. `ClientTool` is exactly the element type `createReactAgent`
   * accepts in `tools`. Optional and additive — arena, bench and the MCP
   * server never set it.
   */
  extraTools?: ClientTool[];
}

/** Contract every reasoning strategy implements (FR-001 to FR-006). */
export interface ReasoningStrategy {
  readonly name: string;
  run(input: string, options?: RunOptions): Promise<StrategyResult>;
}
