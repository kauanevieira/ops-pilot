import type { NodeName, Route, RouteSource, FailureKind } from "../domain/schemas.ts";

export type TraceEvent = (
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; args: Record<string, unknown> }
  | { type: "observation"; content: string; tool?: string; isError?: boolean }
  | { type: "plan"; steps: string[]; revision: number }
  | { type: "critique"; content: string }
  | { type: "answer"; content: string }
  /**
   * 011-history-summarization: produced only by the `/chat` handler,
   * outside every decorator — never by a strategy, the arena, the bench, or
   * the MCP server (contracts/history-summarization.md, T3). Appears at
   * most once per request, at trace position 0, only when a new summary
   * was produced AND saved for this request (FR-022). `content` is the new
   * summary as saved (after capSummary); `absorbedMessages` is how many
   * pending messages this summarization folded in.
   */
  | { type: "summarize"; content: string; absorbedMessages: number }
  /**
   * 012-unified-graph: produced only by the `router` node of the
   * production graph (`src/agents/production-graph.ts`), never by a
   * strategy, the arena, the bench, or the MCP server. Appears exactly
   * once per `/chat` request, right after `summarize` (if any) and before
   * every event of the strategy that ran (contracts/production-graph.md,
   * G4). `route` is the node that ran; `strategy` is the full combination
   * in the registry's vocabulary (`react`, `plan-and-execute`,
   * `reflect:react`, `reflect:plan-and-execute`) — needed because `route`
   * alone can't tell a routed `reflect` from an overridden
   * `plan-and-execute` with reflection, both of which run on the
   * `reflect` node. `reason` is already capped (`capReason`) or one of the
   * fixed override/fallback strings. `source` says who chose: the router
   * itself, the request's own `strategy`/`reflect` fields (override), or a
   * recover to `react` after the router failed (fallback).
   */
  | { type: "route"; route: Route; strategy: string; reason: string; source: RouteSource }
  /**
   * 013-model-resilience: produced only by `resilient` (`agents/model.ts`)
   * switching a call from the primary model to the backup
   * (`OPENROUTER_MODEL_FALLBACK`) — never by the primary succeeding, even
   * after a retry (FR-014). At most one per `/chat` request (the switch
   * sticks for the rest of the request, research R-006, FR-011a); arena
   * and bench can show more than one, since each call there decides on its
   * own. `from`/`to` are model ids; `reason` is the primary's own last
   * failure classification — never the provider's error message (FR-012).
   * Unrelated to the `route` event's `source: "fallback"` (012): that one
   * is the router recovering to a different STRATEGY, this one is a
   * switch of MODEL underneath whichever strategy is already running.
   */
  | { type: "fallback"; from: string; to: string; reason: FailureKind }
) & {
  /**
   * 012-unified-graph, R-011: which graph node produced this event.
   * Optional and additive — stamped only by the production graph that
   * `/chat` runs through (`stampNode`); every other trace producer (a
   * strategy run directly, the arena, the bench, the MCP server) leaves it
   * absent, so their output is byte-for-byte unchanged by this feature.
   */
  nodeName?: NodeName;
};

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
  /**
   * 010-context-measurement: REAL sum of the input tokens the provider
   * reported (`usage_metadata.input_tokens`) across every model call
   * counted in `llmCalls` for this run — base strategy, every reflection
   * attempt, and the critic. Optional and additive. Absent — the key is
   * missing, never present as `undefined` — when any of those calls
   * didn't report usage; a partial sum is never shown as the total.
   * Producers: react, plan-and-execute, withReflection.
   */
  promptTokens?: number;
  /**
   * 010-context-measurement: ESTIMATED breakdown (chars/4, see
   * estimateTokens) of the context the `/chat` handler composed for this
   * request, by source. Only the handler sets it — arena, bench and the
   * MCP server are unaffected. Not reconciled with `promptTokens`: it
   * covers only the message/history/memories sources, never strategy
   * instructions, tool schemas or the growing trace, so it is expected to
   * come out lower than the real total.
   */
  contextBreakdown?: ContextBreakdown;
  /**
   * 011-history-summarization: messages covered by the summary delivered to
   * the strategy for this run (0 with no summary). Optional and additive —
   * only `withConversationHistory` sets it, alongside `historyMessages`
   * (which continues to count only the verbatim messages).
   */
  summaryCoveredMessages?: number;
  /**
   * 013-model-resilience: the model id that answered the last call the
   * strategy made (FR-015) — the one that produced the final answer.
   * Optional and additive: absent when no call of the strategy's own was
   * ever completed (e.g. a fake strategy in a test). Producers: react,
   * plan-and-execute, withReflection (which copies it from the last
   * attempt, since that attempt's answer is the one returned).
   */
  modelUsed?: string;
}

/**
 * 010-context-measurement: estimated token count per context source
 * composed by the `/chat` handler. Each field is `estimateTokens` of the
 * exact text block that source contributed (see
 * `src/context/breakdown.ts`); an absent source is `0`, never omitted.
 * `total` is the sum of the three — not a re-estimate of the concatenated
 * text, so it can be up to 2 tokens higher than estimating the whole input
 * at once, since each block rounds up independently.
 */
export interface ContextBreakdown {
  message: number;
  history: number;
  /**
   * 011-history-summarization: estimate of the summary block delivered to
   * the strategy (see `formatSummaryBlock`); 0 with no summary. `history`
   * keeps covering only the verbatim messages.
   */
  summary: number;
  memories: number;
  total: number;
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
