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
  }
}

export function formatTrace(trace: readonly TraceEvent[]): string {
  return trace.map(formatEvent).join("\n");
}

export function formatMetrics(metrics: RunMetrics, stoppedReason: StoppedReason): string {
  return `llmCalls: ${metrics.llmCalls} | latencyMs: ${metrics.latencyMs} | stoppedReason: ${stoppedReason}`;
}
