import type { z } from "zod";
import type { ChatErrorCode } from "../domain/schemas.ts";

/**
 * Machine-readable discriminator for every error `POST /chat` can respond
 * with (FR-016) — the closed set lives in `chatErrorCodeSchema` (014) so the
 * `requests.error_code` CHECK and this type share one definition. A client
 * branches on `code`, not on parsing `message`.
 */
export type { ChatErrorCode };

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

/**
 * 014-request-tracing, FR-003: adds the request id as a sibling of `error`,
 * leaving every existing error field untouched (FR-026).
 */
export function withRequestId<T extends ChatErrorResponse>(body: T, requestId: string): T & { requestId: string } {
  return { ...body, requestId };
}
