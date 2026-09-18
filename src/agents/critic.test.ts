import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCritiqueContext } from "./critic.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";

function result(trace: TraceEvent[], answer = "resposta final"): StrategyResult {
  return { answer, trace, metrics: { llmCalls: 1, latencyMs: 10 }, stoppedReason: "completed" };
}

describe("buildCritiqueContext", () => {
  it("uses the original input, not the answer, as the request judged against", () => {
    const context = buildCritiqueContext("pedido original", result([]));
    assert.equal(context.input, "pedido original");
  });

  it("carries the attempt's answer through unchanged", () => {
    const context = buildCritiqueContext("pedido", result([], "3 alertas disparando"));
    assert.equal(context.answer, "3 alertas disparando");
  });

  it("extracts observation and action events in order, ignoring thought/plan/answer", () => {
    const trace: TraceEvent[] = [
      { type: "thought", content: "vou checar os alertas" },
      { type: "action", tool: "list_alerts", args: { status: "firing" } },
      { type: "observation", content: "[]", tool: "list_alerts" },
      { type: "plan", steps: ["passo 1"], revision: 0 },
      { type: "action", tool: "open_incident", args: { title: "x", service: "checkout", severity: "high" } },
      { type: "observation", content: "erro", tool: "open_incident", isError: true },
      { type: "answer", content: "feito" },
    ];

    const context = buildCritiqueContext("pedido", result(trace));

    assert.deepEqual(context.actions, [
      { tool: "list_alerts", args: { status: "firing" } },
      { tool: "open_incident", args: { title: "x", service: "checkout", severity: "high" } },
    ]);
    assert.deepEqual(context.observations, [
      { tool: "list_alerts", content: "[]", isError: undefined },
      { tool: "open_incident", content: "erro", isError: true },
    ]);
  });

  it("produces empty lists, not an error, for a trace with no tool activity", () => {
    const trace: TraceEvent[] = [{ type: "answer", content: "sem consultar nada" }];
    const context = buildCritiqueContext("pedido", result(trace));

    assert.deepEqual(context.observations, []);
    assert.deepEqual(context.actions, []);
  });

  it("is pure: does not mutate the trace it reads from", () => {
    const trace: TraceEvent[] = [{ type: "observation", content: "obs", tool: "list_alerts" }];
    const snapshot = JSON.stringify(trace);

    buildCritiqueContext("pedido", result(trace));

    assert.equal(JSON.stringify(trace), snapshot);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const trace: TraceEvent[] = [{ type: "observation", content: "obs", tool: "list_alerts" }];
    const r = result(trace);

    const first = buildCritiqueContext("pedido", r);
    const second = buildCritiqueContext("pedido", r);

    assert.deepEqual(first, second);
  });
});
