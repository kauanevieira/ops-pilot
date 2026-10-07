import { z } from "zod";
import {
  failureKindSchema,
  nodeNameSchema,
  requestIdSchema,
  routeSchema,
  routeSourceSchema,
  stoppedReasonSchema,
} from "./schemas.ts";

/**
 * 016-war-room-web (contracts/wire-schemas.md): the single definition of
 * every shape the HTTP API sends and the war room reads. This file only
 * imports `zod` and `./schemas.ts` on purpose (WS4) — `web/` imports it
 * straight from the browser.
 *
 * `src/trace/types.ts` derives `TraceEvent`, `RunMetrics`,
 * `ContextBreakdown` and `StrategyResult` from here, so there is no
 * hand-written parallel type (Constitution, Principle I).
 */

// --- Trace -----------------------------------------------------------------

/**
 * `nodeName` (012-unified-graph, R-011): which graph node produced this
 * event. Optional and additive — stamped only by the production graph that
 * `/chat` runs through (`stampNode`); every other trace producer (a
 * strategy run directly, the arena, the bench, the MCP server) leaves it
 * absent, so their output is byte-for-byte unchanged by that feature.
 */
const withNode = { nodeName: nodeNameSchema.optional() };

export const traceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thought"), content: z.string(), ...withNode }),
  z.object({ type: z.literal("action"), tool: z.string(), args: z.record(z.string(), z.unknown()), ...withNode }),
  z.object({
    type: z.literal("observation"),
    content: z.string(),
    tool: z.string().optional(),
    isError: z.boolean().optional(),
    ...withNode,
  }),
  z.object({ type: z.literal("plan"), steps: z.array(z.string()), revision: z.number(), ...withNode }),
  z.object({ type: z.literal("critique"), content: z.string(), ...withNode }),
  z.object({ type: z.literal("answer"), content: z.string(), ...withNode }),
  /**
   * 011-history-summarization: produced only by the `/chat` handler,
   * outside every decorator — never by a strategy, the arena, the bench, or
   * the MCP server (contracts/history-summarization.md, T3). Appears at
   * most once per request, at trace position 0, only when a new summary
   * was produced AND saved for this request (FR-022). `content` is the new
   * summary as saved (after capSummary); `absorbedMessages` is how many
   * pending messages this summarization folded in.
   */
  z.object({ type: z.literal("summarize"), content: z.string(), absorbedMessages: z.number(), ...withNode }),
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
  z.object({
    type: z.literal("route"),
    route: routeSchema,
    strategy: z.string(),
    reason: z.string(),
    source: routeSourceSchema,
    ...withNode,
  }),
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
  z.object({ type: z.literal("fallback"), from: z.string(), to: z.string(), reason: failureKindSchema, ...withNode }),
]);

/**
 * 010-context-measurement: estimated token count per context source
 * composed by the `/chat` handler. Each field is `estimateTokens` of the
 * exact text block that source contributed (see
 * `src/context/breakdown.ts`); an absent source is `0`, never omitted.
 * `total` is the sum of the three — not a re-estimate of the concatenated
 * text, so it can be up to 2 tokens higher than estimating the whole input
 * at once, since each block rounds up independently.
 */
export const contextBreakdownSchema = z.object({
  message: z.number(),
  history: z.number(),
  /**
   * 011-history-summarization: estimate of the summary block delivered to
   * the strategy (see `formatSummaryBlock`); 0 with no summary. `history`
   * keeps covering only the verbatim messages.
   */
  summary: z.number(),
  memories: z.number(),
  total: z.number(),
});

export const runMetricsSchema = z.object({
  llmCalls: z.number(),
  latencyMs: z.number(),
  /**
   * 007-persistent-conversation: messages of conversation history actually
   * delivered to the strategy for this run (0..HISTORY_WINDOW). Optional and
   * additive — only `withConversationHistory` sets it; every other producer
   * (react, plan-and-execute, reflection, arena, bench, MCP) is unaffected.
   */
  historyMessages: z.number().optional(),
  /**
   * 008-semantic-memory: semantic memories recalled and delivered to the
   * strategy for this run (0..RECALL_LIMIT). Optional and additive — only
   * `withMemory` sets it; every other producer is unaffected.
   */
  recalledMemories: z.number().optional(),
  /**
   * 010-context-measurement: REAL sum of the input tokens the provider
   * reported (`usage_metadata.input_tokens`) across every model call
   * counted in `llmCalls` for this run — base strategy, every reflection
   * attempt, and the critic. Optional and additive. Absent — the key is
   * missing, never present as `undefined` — when any of those calls
   * didn't report usage; a partial sum is never shown as the total.
   * Producers: react, plan-and-execute, withReflection.
   */
  promptTokens: z.number().optional(),
  /**
   * 010-context-measurement: ESTIMATED breakdown (chars/4, see
   * estimateTokens) of the context the `/chat` handler composed for this
   * request, by source. Only the handler sets it — arena, bench and the
   * MCP server are unaffected. Not reconciled with `promptTokens`: it
   * covers only the message/history/memories sources, never strategy
   * instructions, tool schemas or the growing trace, so it is expected to
   * come out lower than the real total.
   */
  contextBreakdown: contextBreakdownSchema.optional(),
  /**
   * 011-history-summarization: messages covered by the summary delivered to
   * the strategy for this run (0 with no summary). Optional and additive —
   * only `withConversationHistory` sets it, alongside `historyMessages`
   * (which continues to count only the verbatim messages).
   */
  summaryCoveredMessages: z.number().optional(),
  /**
   * 013-model-resilience: the model id that answered the last call the
   * strategy made (FR-015) — the one that produced the final answer.
   * Optional and additive: absent when no call of the strategy's own was
   * ever completed (e.g. a fake strategy in a test). Producers: react,
   * plan-and-execute, withReflection (which copies it from the last
   * attempt, since that attempt's answer is the one returned).
   */
  modelUsed: z.string().optional(),
});

export const strategyResultSchema = z.object({
  answer: z.string(),
  trace: z.array(traceEventSchema),
  metrics: runMetricsSchema,
  stoppedReason: stoppedReasonSchema,
});

// --- HTTP bodies ------------------------------------------------------------

/**
 * The 200 body of `POST /chat`. `trace` is read as `unknown[]` on purpose
 * (research R-004): the war room validates each event on its own, so an
 * event type from a newer API shows up as "unknown" instead of failing the
 * whole response.
 */
export const chatResponseSchema = strategyResultSchema.extend({
  trace: z.array(z.unknown()),
  conversationId: z.string(),
  requestId: requestIdSchema,
});
export type ChatResponseWire = z.infer<typeof chatResponseSchema>;

/**
 * Error body, as READ. `code` is a plain string so a code added later
 * (e.g. 016's approval codes) never fails the parse; whoever WRITES one
 * stays typed by `ApiErrorCode` (`http/errors.ts`).
 */
export const apiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  requestId: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

// --- Approval flow (contracts/approval-flow.md, proposed) -------------------

export const pendingActionSchema = z.object({
  id: z.string().min(1),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  description: z.string(),
  expiresAt: z.string().optional(),
});
export type PendingAction = z.infer<typeof pendingActionSchema>;

/** 202: the run paused waiting for a human decision. */
export const chatAcceptedSchema = z.object({
  status: z.literal("pending_approval"),
  requestId: requestIdSchema,
  conversationId: z.string(),
  approval: pendingActionSchema,
  trace: z.array(z.unknown()).optional(),
});
export type ChatAccepted = z.infer<typeof chatAcceptedSchema>;

/** Body of `POST /approvals/:id`. */
export const approvalDecisionSchema = z.object({ decision: z.enum(["approve", "deny"]) });
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>["decision"];

/** 200 of a denial: the action did not run. */
export const approvalDeniedSchema = z.object({
  status: z.literal("denied"),
  approvalId: z.string(),
  conversationId: z.string(),
  requestId: requestIdSchema,
});
export type ApprovalDenied = z.infer<typeof approvalDeniedSchema>;
