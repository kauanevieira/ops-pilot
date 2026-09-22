import type { z } from "zod";

/**
 * Machine-readable discriminator for every error `POST /chat` can respond
 * with (FR-016). A client branches on `code`, not on parsing `message`.
 */
export type ChatErrorCode =
  | "invalid_body"
  | "unknown_strategy"
  | "conversation_not_found"
  | "timeout"
  | "internal"
  /**
   * 013-model-resilience, FR-018: the strategy couldn't be answered by any
   * model it tried (primary, and the backup if configured) — distinct from
   * `internal`, which stays reserved for a defect in OpsPilot itself. Maps
   * to a 503, never 500.
   */
  | "model_unavailable";

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/** The single body shape for every error response (FR-016). */
export interface ChatErrorResponse {
  error: {
    code: ChatErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Pure — no HTTP object touched here, which is what makes this testable in
 * isolation. `details` is omitted (not `null`/`undefined`-valued) when not
 * given, so `timeout` and `internal` responses never carry the key at all
 * (FR-017: nothing internal leaks, not even an empty placeholder).
 */
export function toErrorBody(code: ChatErrorCode, message: string, details?: unknown): ChatErrorResponse {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

/**
 * Maps zod's `issues` to the flat, client-facing shape used in
 * `invalid_body`'s `details` (R-004). `path` is joined with "." since a
 * client consuming JSON has no use for zod's internal `PropertyKey[]`.
 */
export function zodIssuesToDetails(issues: readonly z.core.$ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));
}
