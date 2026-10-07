import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeStats, costOf, parseSince, percentile } from "./stats.ts";
import { readModelPrices } from "./pricing.ts";
import type { RequestRecord } from "../domain/schemas.ts";

const TO = new Date("2026-10-07T12:00:00.000Z");
const FROM = new Date(TO.getTime() - 24 * 3_600_000);
const FREE = "meta-llama/llama-3.3-70b-instruct:free";
const PAID = "openai/gpt-4o-mini";

let seq = 0;
function ok(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    requestId: `r${++seq}`, receivedAt: new Date(TO.getTime() - 3_600_000), durationMs: 1000, status: 200, errorCode: null,
    conversationId: "c", userId: null, route: "react", strategy: "react", routeSource: "router", stoppedReason: "completed",
    llmCalls: 2, promptTokens: 1000, modelUsed: FREE, historyMessages: 0, summaryCoveredMessages: 0, recalledMemories: 0, traceEvents: 3,
    ...overrides,
  };
}
function err(code: RequestRecord["errorCode"], status: RequestRecord["status"], overrides: Partial<RequestRecord> = {}): RequestRecord {
  return ok({
    status, errorCode: code, durationMs: 2, route: null, strategy: null, routeSource: null, stoppedReason: null,
    llmCalls: null, promptTokens: null, modelUsed: null, historyMessages: null, summaryCoveredMessages: null, recalledMemories: null, traceEvents: 0,
    ...overrides,
  });
}

describe("parseSince (FR-001)", () => {
  it("accepts m/h/d up to 90 days", () => {
    assert.equal(parseSince("30m"), 30 * 60_000);
    assert.equal(parseSince("24h"), 86_400_000);
    assert.equal(parseSince("90d"), 90 * 86_400_000);
    assert.equal(parseSince("2160h"), 90 * 86_400_000);
  });
  it("rejects everything else", () => {
    for (const bad of ["", "abc", "0h", "-1d", "24", "1y", "1.5h", "91d", "2161h", " 24h", "24H", "01h"]) {
      assert.equal(parseSince(bad), null, bad);
    }
  });
});

describe("percentile (ST5, nearest-rank)", () => {
  it("returns the value at ⌈q·n⌉", () => {
    const xs = [10, 20, 30, 40];
    assert.equal(percentile(xs, 0.5), 20);
    assert.equal(percentile(xs, 0.95), 40);
    assert.equal(percentile([7], 0.5), 7);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(hundred, 0.5), 50);
    assert.equal(percentile(hundred, 0.95), 95);
  });
  it("is null when empty", () => {
    assert.equal(percentile([], 0.5), null);
  });
});

describe("costOf (FR-006, ST4)", () => {
  it(":free is 0, even without a price table or tokens", () => {
    assert.equal(costOf({ modelUsed: FREE, promptTokens: 5000 }, {}), 0);
    assert.equal(costOf({ modelUsed: FREE, promptTokens: null }, {}), 0);
  });
  it("a priced model costs tokens × price / 1M", () => {
    assert.equal(costOf({ modelUsed: PAID, promptTokens: 2_000_000 }, { [PAID]: 0.15 }), 0.3);
  });
  it("is unknown (null) without a price, without tokens, or without a model — never 0", () => {
    assert.equal(costOf({ modelUsed: PAID, promptTokens: 1000 }, {}), null);
    assert.equal(costOf({ modelUsed: PAID, promptTokens: null }, { [PAID]: 0.15 }), null);
    assert.equal(costOf({ modelUsed: null, promptTokens: 1000 }, { [PAID]: 0.15 }), null);
  });
});

describe("computeStats", () => {
  it("counts only the window, inclusive at both ends (ST1)", () => {
    const records = [
      ok({ receivedAt: FROM }),
      ok({ receivedAt: TO }),
      ok({ receivedAt: new Date(FROM.getTime() - 1) }),
      ok({ receivedAt: new Date(TO.getTime() + 1) }),
    ];
    assert.equal(computeStats({ records, since: "24h", from: FROM, to: TO, prices: {} }).total, 2);
  });

  it("totals, errors by code, tokens, cost and latency (ST2, ST3)", () => {
    const records = [
      ok({ durationMs: 1000, promptTokens: 1000, modelUsed: FREE, route: "react" }),
      ok({ durationMs: 3000, promptTokens: 2_000_000, modelUsed: PAID, route: "plan-and-execute" }),
      ok({ durationMs: 2000, promptTokens: 500, modelUsed: "x/sem-preco", route: "react" }),
      ok({ durationMs: 4000, promptTokens: null, modelUsed: FREE, route: "reflect" }),
      err("timeout", 504, { durationMs: 180_000 }),
      err("unknown_strategy", 422),
      err("unknown_strategy", 422),
    ];
    const s = computeStats({ records, since: "24h", from: FROM, to: TO, prices: { [PAID]: 0.15 } });
    assert.equal(s.total, 7);
    assert.equal(s.errors, 3);
    assert.deepEqual(s.errorsByCode, { timeout: 1, unknown_strategy: 2 });
    assert.equal(s.promptTokens, 1000 + 2_000_000 + 500);
    assert.equal(s.costUsd, 0.3);
    assert.equal(s.unpricedRequests, 1);
    // durations of the 200s only: [1000, 2000, 3000, 4000] — the 504's 180 s is excluded
    assert.deepEqual(s.latencyMs, { p50: 2000, p95: 4000 });
    assert.equal(s.byRoute.reduce((n, g) => n + g.requests, 0), 4);
    assert.equal(s.byModel.reduce((n, g) => n + g.requests, 0), 4);
  });

  it("groups by route and by model, most requests first, then by key, null last (FR-008, ST6)", () => {
    const records = [
      ok({ route: "reflect", modelUsed: PAID, promptTokens: 1_000_000, durationMs: 9000 }),
      ok({ route: "react", modelUsed: FREE, durationMs: 1000 }),
      ok({ route: "react", modelUsed: FREE, durationMs: 3000 }),
      ok({ route: "plan-and-execute", modelUsed: null, durationMs: 5000 }),
    ];
    const s = computeStats({ records, since: "24h", from: FROM, to: TO, prices: { [PAID]: 2 } });
    assert.deepEqual(s.byRoute.map((g) => g.route), ["react", "plan-and-execute", "reflect"]);
    assert.deepEqual(s.byRoute[0], { route: "react", requests: 2, promptTokens: 2000, costUsd: 0, unpricedRequests: 0, latencyMs: { p50: 1000, p95: 3000 } });
    assert.deepEqual(s.byModel.map((g) => g.model), [FREE, PAID, null]);
    assert.deepEqual(s.byModel[1], { model: PAID, requests: 1, promptTokens: 1_000_000, costUsd: 2, unpricedRequests: 0, latencyMs: { p50: 9000, p95: 9000 } });
    assert.equal(s.byModel[2]!.unpricedRequests, 1);
  });

  it("an empty window has zeros and null percentiles", () => {
    const s = computeStats({ records: [], since: "1h", from: FROM, to: TO, prices: {} });
    assert.deepEqual(s, {
      since: "1h", from: FROM.toISOString(), to: TO.toISOString(), total: 0, errors: 0, errorsByCode: {},
      promptTokens: 0, costUsd: 0, unpricedRequests: 0, latencyMs: { p50: null, p95: null }, byRoute: [], byModel: [],
    });
  });

  it("rounds cost to 6 decimals", () => {
    const s = computeStats({ records: [ok({ modelUsed: PAID, promptTokens: 1 })], since: "24h", from: FROM, to: TO, prices: { [PAID]: 0.15 } });
    assert.equal(s.costUsd, 0);
    const t = computeStats({ records: [ok({ modelUsed: PAID, promptTokens: 7 })], since: "24h", from: FROM, to: TO, prices: { [PAID]: 0.15 } });
    assert.equal(t.costUsd, 0.000001);
  });
});

describe("readModelPrices", () => {
  it("absent or blank is an empty table", () => {
    assert.deepEqual(readModelPrices(undefined), {});
    assert.deepEqual(readModelPrices("  "), {});
  });
  it("parses a valid table", () => {
    assert.deepEqual(readModelPrices('{"openai/gpt-4o-mini": 0.15}'), { "openai/gpt-4o-mini": 0.15 });
  });
  it("rejects invalid JSON, negative or non-numeric prices, and non-objects", () => {
    for (const bad of ["{", '{"a": -1}', '{"a": "0.1"}', "[1]", '{"": 1}']) {
      assert.throws(() => readModelPrices(bad), /OPENROUTER_PRICES/, bad);
    }
  });
});
