import { z } from "zod";

export const severitySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof severitySchema>;

export const alertStatusSchema = z.enum(["firing", "resolved"]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const incidentStatusSchema = z.enum(["open", "resolved"]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const serviceTierSchema = z.enum(["tier-1", "tier-2", "tier-3"]);
export type ServiceTier = z.infer<typeof serviceTierSchema>;

export const serviceSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "id must be a lowercase slug"),
  name: z.string().min(1),
  tier: serviceTierSchema,
});
export type Service = z.infer<typeof serviceSchema>;

export const alertSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().min(1),
  summary: z.string().min(1),
  severity: severitySchema,
  status: alertStatusSchema,
  firedAt: z.date(),
});
export type Alert = z.infer<typeof alertSchema>;

export const incidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  serviceId: z.string().min(1),
  severity: severitySchema,
  status: incidentStatusSchema,
  openedAt: z.date(),
  resolvedAt: z.date().nullable(),
  summary: z.string().nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const runbookSchema = z.object({
  serviceId: z.string().min(1),
  title: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
});
export type Runbook = z.infer<typeof runbookSchema>;

// --- 007-persistent-conversation --------------------------------------------

/** Closed set (FR-003): the database CHECK on messages.role must stay in sync. */
export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const conversationMessageSchema = z.object({
  role: messageRoleSchema,
  content: z.string().min(1),
  createdAt: z.date(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

/**
 * What `ConversationStore.append` accepts (contracts/conversation-store.md):
 * `createdAt` is assigned by the store, at the boundary (Principle I) — never
 * supplied by the caller.
 */
export const newConversationMessageSchema = conversationMessageSchema.omit({ createdAt: true });
export type NewConversationMessage = z.infer<typeof newConversationMessageSchema>;

// --- 008-semantic-memory -----------------------------------------------------

/** Opaque, per-request identifier — no account, no auth (spec, Assumptions). */
export const userIdSchema = z.string().trim().min(1, "userId não pode ser vazio.");

/**
 * A memory is a short, self-contained fact (FR-012) — 500 is an assumption
 * from the spec: the model truncates long input, and a long fact would
 * dilute its own embedding's meaning.
 */
export const memoryFactSchema = z.string().trim().min(1).max(500);

export const rememberResultSchema = z.object({
  memoryId: z.string().min(1),
  fact: z.string().min(1),
  /** false ⇒ a fact with score > DEDUP_THRESHOLD already existed; `fact` is that existing one. */
  created: z.boolean(),
});
export type RememberResult = z.infer<typeof rememberResultSchema>;

export const recalledMemorySchema = z.object({
  memoryId: z.string().min(1),
  fact: z.string().min(1),
  /** Dot product with the query, over normalized vectors — cosine similarity. */
  score: z.number().min(-1).max(1),
});
export type RecalledMemory = z.infer<typeof recalledMemorySchema>;

// --- 009-learning-reflector ---------------------------------------------------

/**
 * The distiller's structured output (contracts/learning-reflector.md, D1–D4).
 * `fact` is always present — required by strict structured output — and is
 * the empty string when `hasLearning` is false; length/emptiness validation
 * against `memoryFactSchema` happens afterwards, in the reflector, not here
 * (R-003): a too-long fact must become "nothing to learn", not a parse
 * failure from the model call itself.
 */
export const learningDecisionSchema = z.object({
  hasLearning: z
    .boolean()
    .describe("true só se a mensagem contém um fato durável sobre a própria pessoa, seguro de guardar"),
  fact: z
    .string()
    .describe(
      "o fato em uma frase curta e autocontida, em terceira pessoa; string vazia quando hasLearning é false",
    ),
});
export type LearningDecision = z.infer<typeof learningDecisionSchema>;

// --- 011-history-summarization ------------------------------------------------

/**
 * 200 tokens by the 010 estimate (chars/4, rounded up) — the hard cap a
 * summary is truncated to (contracts/history-summarization.md, Z5, R-008).
 * MUST stay in sync with the `CHECK (length(content) BETWEEN 1 AND 800)` on
 * `conversation_summaries.content` (sqlite-schema.ts); a dedicated test
 * checks that sync, same pattern as R-007 in 004-sqlite-persistence.
 */
export const SUMMARY_MAX_CHARS = 800;

export const summaryContentSchema = z.string().trim().min(1).max(SUMMARY_MAX_CHARS);

/**
 * A conversation's single cumulative summary (data-model.md). `coveredMessages`
 * is a position, not a message id (research R-001): messages 0..coveredMessages-1
 * of the conversation are folded into `content`; it only ever grows.
 */
export const conversationSummarySchema = z.object({
  content: summaryContentSchema,
  coveredMessages: z.number().int().positive(),
  updatedAt: z.date(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/**
 * What `ConversationStore.saveSummary` accepts: `updatedAt` is assigned by
 * the store, at the boundary (Principle I), same pattern as
 * `newConversationMessageSchema`.
 */
export const newConversationSummarySchema = conversationSummarySchema.omit({ updatedAt: true });
export type NewConversationSummary = z.infer<typeof newConversationSummarySchema>;

// --- 012-unified-graph --------------------------------------------------------

/** Cap on the router's `reason` as registered in the trace (FR-013). Truncated, never rejected. */
export const ROUTE_REASON_MAX_CHARS = 300;

/**
 * The three reasoning strategies the router can pick between
 * (contracts/router.md). `reflect` means reflection over ReAct
 * (production-graph.ts's `ROUTE_SELECTIONS`) — reflection over
 * plan-and-execute stays override-only (spec Assumptions).
 */
export const routeSchema = z.enum(["react", "plan-and-execute", "reflect"]);
export type Route = z.infer<typeof routeSchema>;

/**
 * Structured output the router model returns (data-model.md). Every field
 * has `.describe()` (Constitution, Principle IV, rule 5) since this reaches
 * the model as an output schema, even though the router isn't a tool.
 * `reason` has no `.max()` on purpose — FR-013 truncates it (`capReason`),
 * never rejects it.
 */
export const routeDecisionSchema = z.object({
  route: routeSchema.describe("estratégia de raciocínio escolhida para o pedido: react, plan-and-execute ou reflect"),
  reason: z.string().describe("uma frase curta explicando por que essa estratégia é a mais adequada ao pedido"),
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

/** Where a request's route came from (FR-017). */
export const routeSourceSchema = z.enum(["router", "override", "fallback"]);
export type RouteSource = z.infer<typeof routeSourceSchema>;

/** The production graph's nodes (FR-020) — the closed set `TraceEvent.nodeName` accepts. */
export const nodeNameSchema = z.enum(["context", "router", "react", "plan-and-execute", "reflect", "response"]);
export type NodeName = z.infer<typeof nodeNameSchema>;

// --- 013-model-resilience ------------------------------------------------

/**
 * Why the primary model didn't answer a call (FR-012). Decides whether the
 * call is retried (`RETRYABLE_FAILURES` below) and appears, unchanged, in
 * the `fallback` trace event — never the provider's own error message.
 */
export const failureKindSchema = z.enum(["timeout", "rate_limit", "provider_error", "network", "non_transient"]);
export type FailureKind = z.infer<typeof failureKindSchema>;

/**
 * The subset of `FailureKind` that earns a retry on the primary (FR-005,
 * research R-004). `timeout` is deliberately NOT here: a single attempt
 * can already take up to 60s (`model.ts`'s client timeout), so three
 * attempts could consume most of the request's 180s deadline — a timeout
 * goes straight to the backup instead. `non_transient` covers everything
 * that would just fail the same way again (unknown model, rejected
 * request, invalid credential, malformed structured output).
 */
export const RETRYABLE_FAILURES: ReadonlySet<FailureKind> = new Set(["rate_limit", "provider_error", "network"]);

/** Validates `OPENROUTER_MODEL`/`OPENROUTER_MODEL_FALLBACK` when read (Constitution, boundary validation). */
export const modelIdSchema = z.string().trim().min(1);
