import {
  apiErrorBodySchema,
  approvalDeniedSchema,
  chatAcceptedSchema,
  chatResponseSchema,
  type ApiErrorBody,
  type ApprovalDecision,
  type ApprovalDenied,
  type ChatAccepted,
  type ChatResponseWire,
} from "@domain/wire.ts";
import { joinApiUrl } from "./url.ts";

/** research R-007: above the API's own 180 s deadline, so the API always answers first (FR-004). */
export const CLIENT_TIMEOUT_MS = 190_000;

export type ChatOutcome =
  | { kind: "answered"; result: ChatResponseWire }
  | { kind: "pending"; accepted: ChatAccepted }
  | { kind: "denied"; denied: ApprovalDenied }
  | { kind: "api-error"; status: number; body: ApiErrorBody; requestId?: string }
  | { kind: "unreachable"; url: string; reason: "network" | "timeout" }
  | { kind: "malformed"; status: number; requestId?: string };

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * The one place that knows HTTP statuses (plan, decision 7). Pure: it takes
 * the already-parsed JSON. A body that doesn't match the contract is
 * `malformed` — never a half-built object handed to the UI (FR-011).
 */
export function classifyResponse(
  status: number,
  headers: HeaderReader,
  json: unknown,
  options: { allowDenied?: boolean } = {},
): ChatOutcome {
  const headerId = headers.get("x-request-id") ?? undefined;
  const malformed = (): ChatOutcome => ({ kind: "malformed", status, ...(headerId ? { requestId: headerId } : {}) });

  if (status === 200) {
    const answered = chatResponseSchema.safeParse(json);
    if (answered.success) return { kind: "answered", result: answered.data };
    if (options.allowDenied) {
      const denied = approvalDeniedSchema.safeParse(json);
      if (denied.success) return { kind: "denied", denied: denied.data };
    }
    return malformed();
  }
  if (status === 202) {
    const accepted = chatAcceptedSchema.safeParse(json);
    return accepted.success ? { kind: "pending", accepted: accepted.data } : malformed();
  }
  if (status >= 400 && status <= 599) {
    const error = apiErrorBodySchema.safeParse(json);
    if (!error.success) return malformed();
    const requestId = error.data.requestId ?? headerId;
    return { kind: "api-error", status, body: error.data, ...(requestId ? { requestId } : {}) };
  }
  return malformed();
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export interface ApiClient {
  sendChat(input: { message: string; conversationId?: string }): Promise<ChatOutcome>;
  decide(approvalId: string, decision: ApprovalDecision): Promise<ChatOutcome>;
}

export function createApiClient({ baseUrl, fetch: doFetch, timeoutMs = CLIENT_TIMEOUT_MS }: ApiClientOptions): ApiClient {
  async function post(path: string, body: unknown, allowDenied: boolean): Promise<ChatOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(joinApiUrl(baseUrl, path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // research R-008: the browser reports a CORS block and a dead network the same way (TypeError).
      const aborted = error instanceof DOMException && error.name === "AbortError";
      return { kind: "unreachable", url: baseUrl, reason: aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      const requestId = response.headers.get("x-request-id") ?? undefined;
      return { kind: "malformed", status: response.status, ...(requestId ? { requestId } : {}) };
    }
    return classifyResponse(response.status, response.headers, json, { allowDenied });
  }

  return {
    sendChat: ({ message, conversationId }) =>
      post("/chat", conversationId === undefined ? { message } : { message, conversationId }, false),
    decide: (approvalId, decision) => post(`/approvals/${encodeURIComponent(approvalId)}`, { decision }, true),
  };
}
