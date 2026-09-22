import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { LlmCallCounter, modelUsedField } from "./llm-counter.ts";
import { MODEL_USED_EVENT, MODEL_FALLBACK_EVENT } from "./model.ts";

function resultWithUsage(inputTokens: number): LLMResult {
  return {
    generations: [
      [{ text: "", message: new AIMessage({ content: "", usage_metadata: { input_tokens: inputTokens, output_tokens: 0, total_tokens: inputTokens } }) } as never],
    ],
  };
}

function resultWithoutUsage(): LLMResult {
  return { generations: [[{ text: "", message: new AIMessage({ content: "" }) } as never]] };
}

describe("LlmCallCounter", () => {
  // 013-model-resilience, research R-010 (emends 010, K1): calls counts
  // COMPLETED calls (handleLLMEnd), not started ones — a retried/replaced
  // attempt that never completes must not inflate llmCalls.
  it("handleChatModelStart alone does not count; handleLLMEnd does (K1)", () => {
    const counter = new LlmCallCounter();
    counter.handleChatModelStart();
    counter.handleChatModelStart();
    assert.equal(counter.calls, 0);
    counter.handleLLMEnd(resultWithUsage(10));
    counter.handleLLMEnd(resultWithUsage(20));
    assert.equal(counter.calls, 2);
  });

  it("sums input tokens across calls that all reported usage (K2)", () => {
    const counter = new LlmCallCounter();
    for (const tokens of [100, 200, 300]) {
      counter.handleChatModelStart();
      counter.handleLLMEnd(resultWithUsage(tokens));
    }
    assert.equal(counter.calls, 3);
    assert.equal(counter.promptTokens, 600);
  });

  // 013-model-resilience, R-010: a call that never reaches handleLLMEnd
  // (e.g. it failed and only handleLLMError fired) simply never counts —
  // it can no longer make promptTokens undefined, because it was never
  // counted in `calls` to begin with (FR-024).
  it("a call that never ends (e.g. it failed) does not count and does not affect promptTokens (K3)", () => {
    const counter = new LlmCallCounter();
    counter.handleChatModelStart();
    counter.handleLLMEnd(resultWithUsage(100));
    counter.handleChatModelStart(); // started, never ends (e.g. handleLLMError instead)
    assert.equal(counter.calls, 1);
    assert.equal(counter.promptTokens, 100);
  });

  it("is undefined when a COMPLETED call ends without usage_metadata (K3)", () => {
    const counter = new LlmCallCounter();
    counter.handleLLMEnd(resultWithoutUsage());
    assert.equal(counter.calls, 1);
    assert.equal(counter.promptTokens, undefined);
  });

  it("is 0 with no calls at all (K4)", () => {
    const counter = new LlmCallCounter();
    assert.equal(counter.calls, 0);
    assert.equal(counter.promptTokens, 0);
  });

  it("does not share state across instances (K5)", () => {
    const a = new LlmCallCounter();
    const b = new LlmCallCounter();
    a.handleLLMEnd(resultWithUsage(50));
    assert.equal(a.promptTokens, 50);
    assert.equal(b.calls, 0);
    assert.equal(b.promptTokens, 0);
  });

  // 013-model-resilience: fallbackEvents/modelUsed, fed by resilient's
  // custom callback events (research R-007).
  it("collects fallback events in order and the last model used", () => {
    const counter = new LlmCallCounter();
    counter.handleCustomEvent(MODEL_FALLBACK_EVENT, { from: "primary-model", to: "backup-model", reason: "non_transient" });
    counter.handleCustomEvent(MODEL_USED_EVENT, { model: "backup-model" });
    assert.deepEqual(counter.fallbackEvents, [
      { type: "fallback", from: "primary-model", to: "backup-model", reason: "non_transient" },
    ]);
    assert.equal(counter.modelUsed, "backup-model");
  });

  it("ignores unrelated custom events", () => {
    const counter = new LlmCallCounter();
    counter.handleCustomEvent("some_other_event", { irrelevant: true });
    assert.deepEqual(counter.fallbackEvents, []);
    assert.equal(counter.modelUsed, undefined);
  });
});

describe("modelUsedField", () => {
  it("omits the key when undefined", () => {
    assert.deepEqual(modelUsedField(undefined), {});
  });

  it("includes the key when a model id is given", () => {
    assert.deepEqual(modelUsedField("primary-model"), { modelUsed: "primary-model" });
  });
});
