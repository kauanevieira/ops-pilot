import { traceEventSchema, type TraceEventWire } from "@domain/wire.ts";

export type ParsedTraceEvent =
  | { kind: "known"; event: TraceEventWire }
  | { kind: "unknown"; type: string | null; raw: unknown };

/**
 * FR-007/FR-008, research R-004: each event is validated on its own, in the
 * order received. One that fails — a type from a newer API, a missing
 * field, not even an object — becomes `unknown` and never stops the others.
 */
export function parseTrace(raw: readonly unknown[]): ParsedTraceEvent[] {
  return raw.map((item): ParsedTraceEvent => {
    const parsed = traceEventSchema.safeParse(item);
    if (parsed.success) return { kind: "known", event: parsed.data };
    const type =
      typeof item === "object" && item !== null && "type" in item && typeof item.type === "string" ? item.type : null;
    return { kind: "unknown", type, raw: item };
  });
}
