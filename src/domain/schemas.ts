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
