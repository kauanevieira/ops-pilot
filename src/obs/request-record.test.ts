import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toRequestRecord } from "./request-record.ts";
import type { StrategyResult } from "../trace/types.ts";

const T0 = new Date("2026-10-07T12:00:00.000Z");
const T1 = new Date("2026-10-07T12:00:01.250Z");

const result: StrategyResult = {
  answer: "ok",
  trace: [
    { type: "route", route: "plan-and-execute", strategy: "reflect:plan-and-execute", reason: "r", source: "override", nodeName: "router" },
    { type: "answer", content: "ok", nodeName: "reflect" },
  ],
  metrics: { llmCalls: 3, latencyMs: 40, promptTokens: 900, modelUsed: "m/x", historyMessages: 2, summaryCoveredMessages: 4, recalledMemories: 1 },
  stoppedReason: "completed",
};

describe("toRequestRecord (014, R-013)", () => {
  it("success: takes route/strategy/source from the route event and copies metrics", () => {
    const r = toRequestRecord({ requestId: "r1", receivedAt: T0, finishedAt: T1, status: 200, errorCode: null, conversationId: "c1", userId: "u1", result });
    assert.deepEqual(r, {
      requestId: "r1", receivedAt: T0, durationMs: 1250, status: 200, errorCode: null,
      conversationId: "c1", userId: "u1",
      route: "plan-and-execute", strategy: "reflect:plan-and-execute", routeSource: "override",
      stoppedReason: "completed", llmCalls: 3, promptTokens: 900, modelUsed: "m/x",
      historyMessages: 2, summaryCoveredMessages: 4, recalledMemories: 1, traceEvents: 2,
    });
  });

  it("success: an absent metric becomes null, never undefined", () => {
    const r = toRequestRecord({
      requestId: "r1", receivedAt: T0, finishedAt: T1, status: 200, errorCode: null, conversationId: "c1", userId: null,
      result: { ...result, metrics: { llmCalls: 1, latencyMs: 1 } },
    });
    assert.equal(r.promptTokens, null);
    assert.equal(r.modelUsed, null);
    assert.equal(r.historyMessages, null);
    assert.equal(r.userId, null);
  });

  it("error: execution fields are null and traceEvents is 0", () => {
    const r = toRequestRecord({ requestId: "r2", receivedAt: T0, finishedAt: T1, status: 422, errorCode: "unknown_strategy", conversationId: null, userId: null });
    assert.equal(r.route, null);
    assert.equal(r.strategy, null);
    assert.equal(r.llmCalls, null);
    assert.equal(r.traceEvents, 0);
    assert.equal(r.errorCode, "unknown_strategy");
  });

  it("duration is never negative when the clock goes backwards", () => {
    const r = toRequestRecord({ requestId: "r3", receivedAt: T1, finishedAt: T0, status: 500, errorCode: "internal", conversationId: null, userId: null });
    assert.equal(r.durationMs, 0);
  });
});
