import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { inputTokensFromResult, sumPromptTokens } from "./tokens.ts";

function chatResult(message: unknown): LLMResult {
  return { generations: [[{ text: "", message } as never]] };
}

describe("inputTokensFromResult", () => {
  it("reads usage_metadata.input_tokens from the first generation's AIMessage (U1)", () => {
    const result = chatResult(
      new AIMessage({ content: "", usage_metadata: { input_tokens: 120, output_tokens: 5, total_tokens: 125 } }),
    );
    assert.equal(inputTokensFromResult(result), 120);
  });

  it("treats a reported 0 as reported, not missing (U2)", () => {
    const result = chatResult(
      new AIMessage({ content: "", usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }),
    );
    assert.equal(inputTokensFromResult(result), 0);
  });

  it("is undefined for an AIMessage without usage_metadata (U3)", () => {
    const result = chatResult(new AIMessage({ content: "sem usage" }));
    assert.equal(inputTokensFromResult(result), undefined);
  });

  it("is undefined with no generations (U4)", () => {
    assert.equal(inputTokensFromResult({ generations: [[]] }), undefined);
  });

  it("is undefined when the generation has no message (U4)", () => {
    assert.equal(inputTokensFromResult({ generations: [[{ text: "sem message" } as never]] }), undefined);
  });

  it("is undefined for a non-AIMessage generation", () => {
    assert.equal(inputTokensFromResult(chatResult({ content: "não é AIMessage" })), undefined);
  });
});

describe("sumPromptTokens", () => {
  it("sums to 0 with no arguments", () => {
    assert.equal(sumPromptTokens(), 0);
  });

  it("sums known values", () => {
    assert.equal(sumPromptTokens(10, 20), 30);
  });

  it("is undefined if any value is undefined", () => {
    assert.equal(sumPromptTokens(10, undefined), undefined);
    assert.equal(sumPromptTokens(undefined, 10), undefined);
  });

  it("sums zeros to zero, not undefined", () => {
    assert.equal(sumPromptTokens(0, 0), 0);
  });
});
