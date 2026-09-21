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
