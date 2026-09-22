import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMetrics, formatTrace } from "./format.ts";
import type { TraceEvent } from "./types.ts";

describe("formatTrace", () => {
  it("renders every action with its tool and arguments", () => {
    const trace: TraceEvent[] = [
      { type: "thought", content: "vou checar os alertas" },
      { type: "action", tool: "list_alerts", args: { status: "firing" } },
      { type: "observation", content: "3 alertas" },
      { type: "answer", content: "há 3 alertas disparando" },
    ];

    const output = formatTrace(trace);

    assert.match(output, /\[action\]\s+list_alerts \{"status":"firing"\}/);
    assert.match(output, /\[thought\]/);
    assert.match(output, /\[observation\]/);
    assert.match(output, /\[answer\]/);
  });

  it("marks error observations distinctly", () => {
    const trace: TraceEvent[] = [
      { type: "observation", content: "serviço inexistente", isError: true },
    ];
    assert.match(formatTrace(trace), /\(error\)/);
  });

  it("renders plan events with their revision number", () => {
    const trace: TraceEvent[] = [{ type: "plan", steps: ["a", "b"], revision: 0 }];
    assert.match(formatTrace(trace), /revision 0/);
    assert.match(formatTrace(trace), /a -> b/);
  });

  it("is deterministic for the same trace", () => {
    const trace: TraceEvent[] = [{ type: "answer", content: "ok" }];
    assert.equal(formatTrace(trace), formatTrace(trace));
  });

  // --- 011-history-summarization: T2 ------------------------------------

  it("renders a summarize event with its own label and the absorbed count", () => {
    const trace: TraceEvent[] = [{ type: "summarize", content: "R", absorbedMessages: 8 }];
    assert.equal(formatTrace(trace), "[summarize]   (+8 mensagens) R");
  });

  // --- 012-unified-graph: G12, G13 ---------------------------------------

  it("G12: renders a route event with the strategy, its source and the reason", () => {
    const trace: TraceEvent[] = [
      { type: "route", route: "plan-and-execute", strategy: "plan-and-execute", reason: "várias etapas dependentes", source: "router" },
    ];
    assert.equal(formatTrace(trace), "[route]       plan-and-execute (router) várias etapas dependentes");
  });

  it("G13: prefixes {nodeName} when an event carries it", () => {
    const trace: TraceEvent[] = [{ type: "thought", content: "pensando", nodeName: "react" }];
    assert.equal(formatTrace(trace), "{react} [thought]     pensando");
  });

  it("G13: an event with no nodeName renders exactly as before this feature (arena/bench/MCP stay unchanged)", () => {
    const trace: TraceEvent[] = [
      { type: "thought", content: "vou checar os alertas" },
      { type: "action", tool: "list_alerts", args: { status: "firing" } },
      { type: "observation", content: "3 alertas" },
      { type: "answer", content: "há 3 alertas disparando" },
    ];
    assert.equal(
      formatTrace(trace),
      [
        "[thought]     vou checar os alertas",
        '[action]      list_alerts {"status":"firing"}',
        "[observation] 3 alertas",
        "[answer]      há 3 alertas disparando",
      ].join("\n"),
    );
  });
});

describe("formatMetrics", () => {
  it("includes llmCalls, latencyMs and stoppedReason", () => {
    const line = formatMetrics({ llmCalls: 3, latencyMs: 120 }, "completed");
    assert.match(line, /llmCalls: 3/);
    assert.match(line, /latencyMs: 120/);
    assert.match(line, /stoppedReason: completed/);
  });
});
