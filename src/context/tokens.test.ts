import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { estimateTokens, inputTokensFromResult, sumPromptTokens } from "./tokens.ts";

function chatResult(message: unknown): LLMResult {
  return { generations: [[{ text: "", message } as never]] };
}

describe("estimateTokens", () => {
  it("is 0 for an empty text (E1)", () => {
    assert.equal(estimateTokens(""), 0);
  });

  it("rounds up (E2)", () => {
    assert.equal(estimateTokens("a"), 1);
    assert.equal(estimateTokens("abc"), 1);
    assert.equal(estimateTokens("abcde"), 2);
  });

  it("is exact on an exact division (E3)", () => {
    assert.equal(estimateTokens("abcd"), 1);
  });

  it("counts UTF-16 units, not UTF-8 bytes — accented text does not inflate (E4)", () => {
    // "ação" is 4 UTF-16 code units (NFC), 6 UTF-8 bytes; the estimate must
    // follow .length, not Buffer.byteLength.
    assert.equal(estimateTokens("ação"), 1);
    assert.equal(Buffer.byteLength("ação", "utf8"), 6);
  });

  it("is deterministic for the same text (E5)", () => {
    const text = "quais alertas estão abertos no checkout?";
    assert.equal(estimateTokens(text), estimateTokens(text));
  });
});

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
