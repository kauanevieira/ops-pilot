import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiErrorBodySchema,
  approvalDecisionSchema,
  approvalDeniedSchema,
  chatAcceptedSchema,
  chatResponseSchema,
  runMetricsSchema,
  strategyResultSchema,
  traceEventSchema,
} from "./wire.ts";
import { traceEventTypeSchema } from "./schemas.ts";

/** One event of every type, `nodeName` on some, every optional metric set (WS3). */
const FULL_RESULT = {
  answer: "resposta",
  stoppedReason: "completed",
  metrics: {
    llmCalls: 4,
    latencyMs: 812,
    historyMessages: 2,
    recalledMemories: 1,
    promptTokens: 1500,
    contextBreakdown: { message: 10, history: 20, summary: 5, memories: 3, total: 38 },
    summaryCoveredMessages: 6,
    modelUsed: "openai/gpt-4o-mini",
  },
  trace: [
    { type: "summarize", content: "resumo", absorbedMessages: 3, nodeName: "context" },
    { type: "route", route: "react", strategy: "react", reason: "pedido simples", source: "router", nodeName: "router" },
    { type: "thought", content: "pensando", nodeName: "react" },
    { type: "action", tool: "list_alerts", args: { status: "open", filter: { severity: ["critical"] } } },
    { type: "observation", content: "3 alertas", tool: "list_alerts" },
    { type: "observation", content: "falhou", tool: "x", isError: true },
    { type: "plan", steps: ["a", "b"], revision: 1 },
    { type: "critique", content: "aprovado: ok" },
    { type: "fallback", from: "a/b", to: "c/d", reason: "rate_limit" },
    { type: "answer", content: "resposta" },
  ],
};

const FIXED_RESULT = {
  answer: "resposta fixa do dublê",
  trace: [
    { type: "thought", content: "pensando sobre o pedido" },
    { type: "action", tool: "list_alerts", args: { status: "open" } },
    { type: "observation", content: "3 alertas abertos" },
    { type: "answer", content: "resposta fixa do dublê" },
  ],
  metrics: { llmCalls: 2, latencyMs: 5 },
  stoppedReason: "completed",
};

describe("wire schemas (016, contracts/wire-schemas.md)", () => {
  it("WS3: the known results pass strategyResultSchema", () => {
    assert.doesNotThrow(() => strategyResultSchema.parse(FIXED_RESULT));
    assert.doesNotThrow(() => strategyResultSchema.parse(FULL_RESULT));
  });

  it("traceEventSchema covers exactly the event types of traceEventTypeSchema (WS2)", () => {
    const covered = new Set(FULL_RESULT.trace.map((e) => traceEventSchema.parse(e).type));
    assert.deepEqual([...covered].sort(), [...traceEventTypeSchema.options].sort());
  });

  it("chatResponseSchema tolerates an unknown trace event (R-004)", () => {
    const body = {
      ...FIXED_RESULT,
      trace: [...FIXED_RESULT.trace, { type: "vote", ballots: 3 }],
      conversationId: "c1",
      requestId: "r1",
    };
    const parsed = chatResponseSchema.parse(body);
    assert.equal(parsed.trace.length, 5);
  });

  it("chatResponseSchema requires answer, conversationId and requestId", () => {
    assert.equal(chatResponseSchema.safeParse({ ...FIXED_RESULT, requestId: "r1" }).success, false);
    assert.equal(chatResponseSchema.safeParse({ ...FIXED_RESULT, conversationId: "c1" }).success, false);
  });

  it("runMetricsSchema drops an unknown field without failing", () => {
    const parsed = runMetricsSchema.parse({ llmCalls: 1, latencyMs: 2, somethingNew: 9 });
    assert.deepEqual(parsed, { llmCalls: 1, latencyMs: 2 });
  });

  it("apiErrorBodySchema accepts a code outside chatErrorCodeSchema (AP4)", () => {
    const parsed = apiErrorBodySchema.parse({ error: { code: "approval_expired", message: "x" }, requestId: "r1" });
    assert.equal(parsed.error.code, "approval_expired");
    assert.equal(apiErrorBodySchema.safeParse({ error: { message: "x" } }).success, false);
  });

  it("chatAcceptedSchema accepts the approval-flow.md example, with and without optionals", () => {
    const base = {
      status: "pending_approval",
      requestId: "r1",
      conversationId: "c1",
      approval: {
        id: "ap-1",
        tool: "resolve_incident",
        args: { incidentId: "INC-42" },
        description: "Resolver o incidente INC-42.",
      },
    };
    assert.doesNotThrow(() => chatAcceptedSchema.parse(base));
    assert.doesNotThrow(() =>
      chatAcceptedSchema.parse({
        ...base,
        approval: { ...base.approval, expiresAt: "2026-10-07T18:30:00.000Z" },
        trace: [{ type: "thought", content: "x" }],
      }),
    );
    assert.equal(chatAcceptedSchema.safeParse({ ...base, status: "done" }).success, false);
  });

  it("approvalDecisionSchema accepts only approve | deny", () => {
    assert.equal(approvalDecisionSchema.safeParse({ decision: "approve" }).success, true);
    assert.equal(approvalDecisionSchema.safeParse({ decision: "deny" }).success, true);
    assert.equal(approvalDecisionSchema.safeParse({ decision: "maybe" }).success, false);
  });

  it("approvalDeniedSchema accepts the denial body", () => {
    assert.doesNotThrow(() =>
      approvalDeniedSchema.parse({ status: "denied", approvalId: "ap-1", conversationId: "c1", requestId: "r1" }),
    );
  });

  it("WS4: src/domain only imports zod or its own files (safe for the browser)", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    assert.ok(files.includes("wire.ts"));
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
      for (const specifier of specifiers) {
        assert.ok(specifier === "zod" || specifier.startsWith("./"), `${file} imports "${specifier}"`);
      }
    }
  });
});
