import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { LlmCallCounter } from "./llm-counter.ts";

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
  it("keeps counting handleChatModelStart the same way (K1)", () => {
    const counter = new LlmCallCounter();
    counter.handleChatModelStart();
    counter.handleChatModelStart();
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

  it("is undefined when a started call never ends with usage (K3)", () => {
    const counter = new LlmCallCounter();
    counter.handleChatModelStart();
    counter.handleLLMEnd(resultWithUsage(100));
    counter.handleChatModelStart(); // started, never ends (e.g. handleLLMError instead)
    assert.equal(counter.promptTokens, undefined);
  });

  it("is undefined when a call ends without usage_metadata (K3)", () => {
    const counter = new LlmCallCounter();
    counter.handleChatModelStart();
    counter.handleLLMEnd(resultWithoutUsage());
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
    a.handleChatModelStart();
    a.handleLLMEnd(resultWithUsage(50));
    assert.equal(a.promptTokens, 50);
    assert.equal(b.calls, 0);
    assert.equal(b.promptTokens, 0);
  });
});
