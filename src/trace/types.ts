import type { z } from "zod";
import type { TraceEventType, stoppedReasonSchema } from "../domain/schemas.ts";
import type {
  contextBreakdownSchema,
  runMetricsSchema,
  strategyResultSchema,
  traceEventSchema,
} from "../domain/wire.ts";

/**
 * 016-war-room-web (contracts/wire-schemas.md, WS1): the trace and metrics
 * shapes are defined once, as zod schemas in `domain/wire.ts` — the
 * per-member documentation (011 `summarize`, 012 `route` and `nodeName`,
 * 013 `fallback`, 010 `promptTokens`/`contextBreakdown`, …) lives there
 * now. The names exported from this module are unchanged.
 */
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type RunMetrics = z.infer<typeof runMetricsSchema>;
export type ContextBreakdown = z.infer<typeof contextBreakdownSchema>;

/**
 * "max-reflections" (002-reflection-layer, FR-015, R-005): the reflection
 * cycle exhausted its retries without the critic approving. Additive to the
 * union — no existing switch over StoppedReason is exhaustive (format.ts
 * interpolates it), so this cannot break the base strategies.
 */
export type StoppedReason = z.infer<typeof stoppedReasonSchema>;

export type StrategyResult = z.infer<typeof strategyResultSchema>;

/**
 * 014-request-tracing: compile-time guard that `traceEventTypeSchema` (and
 * with it the `trace_events.type` CHECK) lists exactly the event types of
 * `TraceEvent`. Adding a union member without updating the enum fails here.
 */
type _TraceTypesInSync = [TraceEvent["type"]] extends [TraceEventType]
  ? [TraceEventType] extends [TraceEvent["type"]]
    ? true
    : never
  : never;
export const traceTypesInSync: _TraceTypesInSync = true;
