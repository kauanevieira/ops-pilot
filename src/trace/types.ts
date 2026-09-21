export type TraceEvent =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; args: Record<string, unknown> }
  | { type: "observation"; content: string; tool?: string; isError?: boolean }
  | { type: "plan"; steps: string[]; revision: number }
  | { type: "critique"; content: string }
  | { type: "answer"; content: string };

export interface RunMetrics {
  llmCalls: number;
  latencyMs: number;
  /**
   * 007-persistent-conversation: messages of conversation history actually
   * delivered to the strategy for this run (0..HISTORY_WINDOW). Optional and
   * additive — only `withConversationHistory` sets it; every other producer
   * (react, plan-and-execute, reflection, arena, bench, MCP) is unaffected.
   */
  historyMessages?: number;
  /**
   * 008-semantic-memory: semantic memories recalled and delivered to the
   * strategy for this run (0..RECALL_LIMIT). Optional and additive — only
   * `withMemory` sets it; every other producer is unaffected.
   */
  recalledMemories?: number;
}

/**
 * "max-reflections" (002-reflection-layer, FR-015, R-005): the reflection
 * cycle exhausted its retries without the critic approving. Additive to the
 * union — no existing switch over StoppedReason is exhaustive (format.ts
 * interpolates it), so this cannot break the base strategies.
 */
export type StoppedReason = "completed" | "max-iterations" | "max-steps" | "max-reflections";

export interface StrategyResult {
  answer: string;
  trace: TraceEvent[];
  metrics: RunMetrics;
  stoppedReason: StoppedReason;
}
