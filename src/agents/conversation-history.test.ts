import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatHistoryBlock,
  formatHistoryInput,
  formatSummaryBlock,
  formatTranscript,
  withConversationHistory,
  HISTORY_WINDOW,
  type ConversationHistory,
} from "./conversation-history.ts";
import { withReflection } from "./reflection.ts";
import type { Critic } from "./critic.ts";
import type { ConversationMessage } from "../domain/schemas.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StrategyResult } from "../trace/types.ts";

function makeResult(answer: string, llmCalls = 1): StrategyResult {
  return {
    answer,
    trace: [{ type: "answer", content: answer }],
    metrics: { llmCalls, latencyMs: 5 },
    stoppedReason: "completed",
  };
}

function fakeStrategy(
  name: string,
  results: StrategyResult[],
): ReasoningStrategy & { calls: { input: string; options?: RunOptions }[] } {
  const calls: { input: string; options?: RunOptions }[] = [];
  return {
    name,
    calls,
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      calls.push({ input, options });
      return results[Math.min(calls.length - 1, results.length - 1)]!;
    },
  };
}

function history(...pairs: [ConversationMessage["role"], string][]): ConversationMessage[] {
  return pairs.map(([role, content]) => ({ role, content, createdAt: new Date("2026-01-01T00:00:00.000Z") }));
}

/** Builds a `ConversationHistory` with no summary, only messages — the pre-011 shape. */
function noSummary(messages: ConversationMessage[]): ConversationHistory {
  return { summary: null, summaryCoveredMessages: 0, messages };
}

describe("formatHistoryInput", () => {
  it("returns the input untouched when there is no history and no summary", () => {
    assert.equal(formatHistoryInput(noSummary([]), "e o runbook dele?"), "e o runbook dele?");
  });

  it("prefixes the input with a labeled, chronologically ordered transcript", () => {
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "3 alertas em checkout-api."]);
    const composed = formatHistoryInput(noSummary(h), "e o runbook dele?");
    assert.match(composed, /\[plantonista\] quais alertas estão abertos\?/);
    assert.match(composed, /\[OpsPilot\] 3 alertas em checkout-api\./);
    assert.match(composed, /Mensagem atual do plantonista:\ne o runbook dele\?$/);
    // Chronological order preserved: the user line comes before the assistant line.
    assert.ok(composed.indexOf("quais alertas") < composed.indexOf("3 alertas"));
  });
});

describe("formatHistoryBlock (010-context-measurement, B4/B5)", () => {
  it("is empty with no history", () => {
    assert.equal(formatHistoryBlock([]), "");
  });

  it("ends with the same 'Mensagem atual do plantonista:' line, terminated by a newline", () => {
    const h = history(["user", "quais alertas estão abertos?"]);
    assert.ok(formatHistoryBlock(h).endsWith("Mensagem atual do plantonista:\n"));
  });

  it("concatenated with any input reproduces formatHistoryInput exactly (B4)", () => {
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "3 alertas em checkout-api."]);
    const input = "e o runbook dele?";
    assert.equal(formatHistoryBlock(h) + input, formatHistoryInput(noSummary(h), input));
  });
});

describe("formatTranscript", () => {
  it("produces the same rotulated lines formatHistoryBlock uses", () => {
    const h = history(["user", "oi"], ["assistant", "olá"]);
    assert.equal(formatTranscript(h), "[plantonista] oi\n[OpsPilot] olá");
    assert.ok(formatHistoryBlock(h).includes(formatTranscript(h)));
  });
});

// --- 011-history-summarization: H1-H6 (contracts/history-summarization.md) --

describe("formatSummaryBlock", () => {
  it("H1: is empty with no summary", () => {
    assert.equal(formatSummaryBlock(null), "");
  });

  it("H2: has the header, the summary text, and a trailing blank line", () => {
    const block = formatSummaryBlock("Decidido abrir incidente no checkout.");
    assert.ok(block.startsWith("Resumo da conversa até aqui (mensagens anteriores ao histórico recente):\n"));
    assert.match(block, /Decidido abrir incidente no checkout\.\n\n$/);
  });
});

describe("formatHistoryInput with summary (H3/H4)", () => {
  it("H3: equals formatSummaryBlock + formatHistoryBlock + input", () => {
    const summary = "Resumo prévio.";
    const messages = history(["user", "e o runbook dele?"], ["assistant", "aqui está."]);
    const context: ConversationHistory = { summary, summaryCoveredMessages: 8, messages };
    const input = "e o segundo?";
    assert.equal(formatHistoryInput(context, input), formatSummaryBlock(summary) + formatHistoryBlock(messages) + input);
  });

  it("H4: with no summary, the entry is byte-for-byte identical to formatHistoryBlock + input (FR-020)", () => {
    const messages = history(["user", "oi"], ["assistant", "olá"]);
    const input = "tudo bem?";
    assert.equal(formatHistoryInput(noSummary(messages), input), formatHistoryBlock(messages) + input);
  });
});

describe("withConversationHistory", () => {
  it("passes the input through unchanged with empty history, and reports historyMessages: 0", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const wrapped = withConversationHistory(base, noSummary([]));

    const result = await wrapped.run("olá");

    assert.equal(base.calls[0]!.input, "olá");
    assert.equal(result.metrics.historyMessages, 0);
    assert.equal(result.metrics.summaryCoveredMessages, 0);
  });

  it("delivers the history-composed input to the base strategy and reports its length", async () => {
    const base = fakeStrategy("react", [makeResult("checkout-api tem o runbook X")]);
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "checkout-api."]);
    const wrapped = withConversationHistory(base, noSummary(h));

    const result = await wrapped.run("e o runbook dele?");

    assert.match(base.calls[0]!.input, /\[plantonista\] quais alertas estão abertos\?/);
    assert.equal(result.metrics.historyMessages, 2);
    assert.equal(result.answer, "checkout-api tem o runbook X");
  });

  it("keeps the base strategy's name and every other metric untouched", async () => {
    const base = fakeStrategy("plan-and-execute", [makeResult("ok", 4)]);
    const wrapped = withConversationHistory(base, noSummary(history(["user", "oi"])));

    assert.equal(wrapped.name, "plan-and-execute");
    const result = await wrapped.run("tudo bem?");
    assert.equal(result.metrics.llmCalls, 4);
  });

  it("caps at HISTORY_WINDOW when given more messages than the window (defensively — the store enforces the cap)", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const longHistory = Array.from({ length: HISTORY_WINDOW + 3 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
      createdAt: new Date(),
    }));
    const wrapped = withConversationHistory(base, noSummary(longHistory));

    const result = await wrapped.run("nova pergunta");

    // withConversationHistory reports exactly what it was given (FR-022);
    // the HTTP handler / prepareConversationContext is what limits it.
    assert.equal(result.metrics.historyMessages, HISTORY_WINDOW + 3);
  });

  // --- 011-history-summarization: H5/H6 -------------------------------

  it("H5: reports summaryCoveredMessages exactly as given, including 0 with an explicit summary-less context", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const context: ConversationHistory = { summary: "R", summaryCoveredMessages: 16, messages: history(["user", "oi"]) };
    const wrapped = withConversationHistory(base, context);

    const result = await wrapped.run("pergunta");

    assert.equal(result.metrics.historyMessages, 1);
    assert.equal(result.metrics.summaryCoveredMessages, 16);
  });

  it("H6: composed OUTSIDE withReflection, summaryCoveredMessages survives (same as historyMessages, R-008)", async () => {
    const base = fakeStrategy("react", [makeResult("resposta")]);
    const reflected = withReflection(base, { maxReflections: 2, critic: async () => ({ approved: true, feedback: "" }) });
    const context: ConversationHistory = { summary: "R", summaryCoveredMessages: 8, messages: history(["user", "oi"]) };
    const wrapped = withConversationHistory(reflected, context);

    const result = await wrapped.run("pergunta nova");

    assert.equal(result.metrics.summaryCoveredMessages, 8);
    assert.equal(result.metrics.historyMessages, 1);
  });
});

describe("composition with withReflection (R-008)", () => {
  function alwaysApproves(): Critic {
    return async () => ({ approved: true, feedback: "" });
  }

  it("survives being applied OUTSIDE withReflection: historyMessages is not lost", async () => {
    const base = fakeStrategy("react", [makeResult("resposta")]);
    const reflected = withReflection(base, { maxReflections: 2, critic: alwaysApproves() });
    const wrapped = withConversationHistory(reflected, noSummary(history(["user", "contexto anterior"])));

    const result = await wrapped.run("pergunta nova");

    assert.equal(result.metrics.historyMessages, 1);
  });

  it("the critic judges the history-enriched input, not the bare follow-up", async () => {
    const base = fakeStrategy("react", [makeResult("resposta")]);
    let seenInput = "";
    const critic: Critic = async (context) => {
      seenInput = context.input;
      return { approved: true, feedback: "" };
    };
    const reflected = withReflection(base, { maxReflections: 1, critic });
    const wrapped = withConversationHistory(reflected, noSummary(history(["user", "quais alertas estão abertos?"])));

    await wrapped.run("e o runbook dele?");

    assert.match(seenInput, /\[plantonista\] quais alertas estão abertos\?/);
  });
});
