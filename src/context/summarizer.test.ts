import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { SUMMARY_MAX_CHARS } from "../domain/schemas.ts";
import { formatSummarizerInput, capSummary, createModelSummarizer, SUMMARIZER_PROMPT } from "./summarizer.ts";
import type { ConversationMessage } from "../domain/schemas.ts";

function history(...pairs: [ConversationMessage["role"], string][]): ConversationMessage[] {
  return pairs.map(([role, content]) => ({ role, content, createdAt: new Date("2026-01-01T00:00:00.000Z") }));
}

describe("createModelSummarizer (Z1)", () => {
  let saved: string | undefined;
  before(() => {
    saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
  after(() => {
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  });

  it("does not read env vars or build the model when constructed — only when invoked", () => {
    assert.doesNotThrow(() => createModelSummarizer());
  });
});

describe("formatSummarizerInput (Z3)", () => {
  it("contains '(nenhum)' with no previous summary, and the messages in order", () => {
    const messages = history(["user", "quais alertas estão abertos?"], ["assistant", "3 em checkout-api."]);
    const rendered = formatSummarizerInput({ previousSummary: null, messages });
    assert.match(rendered, /\(nenhum\)/);
    assert.match(rendered, /\[plantonista\] quais alertas estão abertos\?/);
    assert.match(rendered, /\[OpsPilot\] 3 em checkout-api\./);
    assert.ok(rendered.indexOf("quais alertas") < rendered.indexOf("3 em checkout-api"));
  });

  it("contains the previous summary text before the messages, when given one", () => {
    const messages = history(["user", "e o segundo?"]);
    const rendered = formatSummarizerInput({ previousSummary: "Resumo prévio X.", messages });
    assert.match(rendered, /Resumo prévio X\./);
    assert.ok(rendered.indexOf("Resumo prévio X.") < rendered.indexOf("e o segundo?"));
  });
});

describe("SUMMARIZER_PROMPT (Z2/Z4)", () => {
  it("never contains the text of any test message (data stays out of the system prompt)", () => {
    const probe = "SENHA-SECRETA-DE-TESTE-42";
    assert.ok(!SUMMARIZER_PROMPT.includes(probe));
  });

  it("mentions the priority order, the token target, credentials, and treats data as data", () => {
    assert.match(SUMMARIZER_PROMPT, /decis/i);
    assert.match(SUMMARIZER_PROMPT, /fatos/i);
    assert.match(SUMMARIZER_PROMPT, /pend/i);
    assert.match(SUMMARIZER_PROMPT, /150 tokens/);
    assert.match(SUMMARIZER_PROMPT, /credenciais|tokens|senhas|chaves/i);
    assert.match(SUMMARIZER_PROMPT, /DADO/);
  });
});

describe("capSummary (Z5)", () => {
  it("trims surrounding whitespace", () => {
    assert.equal(capSummary("  abc  "), "abc");
  });

  it("returns text of exactly SUMMARY_MAX_CHARS unchanged", () => {
    const text = "x".repeat(SUMMARY_MAX_CHARS);
    assert.equal(capSummary(text), text);
    assert.equal(capSummary(text).length, SUMMARY_MAX_CHARS);
  });

  it("truncates text above SUMMARY_MAX_CHARS to the cap, ending in an ellipsis", () => {
    const text = "x".repeat(SUMMARY_MAX_CHARS + 1);
    const capped = capSummary(text);
    assert.equal(capped.length, SUMMARY_MAX_CHARS);
    assert.ok(capped.endsWith("…"));
  });

  it("whitespace-only input becomes an empty string", () => {
    assert.equal(capSummary("   "), "");
  });
});
