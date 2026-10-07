import { requestRecordSchema, type ChatErrorCode, type RequestRecord, type RequestStatus } from "../domain/schemas.ts";
import type { StrategyResult } from "../trace/types.ts";

export interface RequestRecordInput {
  requestId: string;
  receivedAt: Date;
  finishedAt: Date;
  status: RequestStatus;
  errorCode: ChatErrorCode | null;
  conversationId: string | null;
  userId: string | null;
  /** Present only for a 200: the strategy result the `/chat` handler is about to send. */
  result?: StrategyResult;
}

/**
 * Pure (Principle I): builds the `requests` row. The routing decision is
 * read from the response's single `route` event (012, G4), the one source
 * of truth for it — nothing had to change in the graph (research R-013).
 * Never copies the message or answer text (FR-007).
 */
export function toRequestRecord(input: RequestRecordInput): RequestRecord {
  const { result } = input;
  const route = result?.trace.find((event) => event.type === "route");
  const metrics = result?.metrics;
  return requestRecordSchema.parse({
    requestId: input.requestId,
    receivedAt: input.receivedAt,
    durationMs: Math.max(0, Math.round(input.finishedAt.getTime() - input.receivedAt.getTime())),
    status: input.status,
    errorCode: input.errorCode,
    conversationId: input.conversationId,
    userId: input.userId,
    route: route?.route ?? null,
    strategy: route?.strategy ?? null,
    routeSource: route?.source ?? null,
    stoppedReason: result?.stoppedReason ?? null,
    llmCalls: metrics?.llmCalls ?? null,
    promptTokens: metrics?.promptTokens ?? null,
    modelUsed: metrics?.modelUsed ?? null,
    historyMessages: metrics?.historyMessages ?? null,
    summaryCoveredMessages: metrics?.summaryCoveredMessages ?? null,
    recalledMemories: metrics?.recalledMemories ?? null,
    traceEvents: result?.trace.length ?? 0,
  });
}
