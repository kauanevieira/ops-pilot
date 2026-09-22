import type { RunMetrics, StoppedReason, TraceEvent } from "./types.ts";

function formatEvent(event: TraceEvent): string {
  switch (event.type) {
    case "thought":
      return `[thought]     ${event.content}`;
    case "action":
      return `[action]      ${event.tool} ${JSON.stringify(event.args)}`;
    case "observation":
      return `[observation] ${event.isError ? "(error) " : ""}${event.content}`;
    case "plan":
      return `[plan]        (revision ${event.revision}) ${event.steps.join(" -> ")}`;
    case "critique":
      return `[critique]    ${event.content}`;
    case "answer":
      return `[answer]      ${event.content}`;
    case "summarize":
      return `[summarize]   (+${event.absorbedMessages} mensagens) ${event.content}`;
    // 012-unified-graph, G12: the strategy actually executed, where the
    // choice came from, and why.
    case "route":
      return `[route]       ${event.strategy} (${event.source}) ${event.reason}`;
  }
}

/**
 * 012-unified-graph, G13: prefixes `{nodeName}` when an event carries it —
 * only events from the production graph (`/chat`) do; the arena, the bench
 * and the MCP server run a strategy directly and never stamp `nodeName`, so
 * their lines come out byte-for-byte identical to before this feature.
 */
export function formatTrace(trace: readonly TraceEvent[]): string {
  return trace
    .map((event) => (event.nodeName ? `{${event.nodeName}} ${formatEvent(event)}` : formatEvent(event)))
    .join("\n");
}

export function formatMetrics(metrics: RunMetrics, stoppedReason: StoppedReason): string {
  return `llmCalls: ${metrics.llmCalls} | latencyMs: ${metrics.latencyMs} | stoppedReason: ${stoppedReason}`;
}
