import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildContextBreakdown } from "./breakdown.ts";
import { estimateTokens } from "./tokens.ts";
import {
  formatHistoryBlock,
  formatHistoryInput,
  formatSummaryBlock,
  withConversationHistory,
  type ConversationHistory,
} from "../agents/conversation-history.ts";
import { formatMemoriesBlock, formatMemoriesInput, withMemory } from "../memory/with-memory.ts";
import type { ConversationMessage, RecalledMemory } from "../domain/schemas.ts";
import type { ReasoningStrategy } from "../agents/types.ts";
import type { StrategyResult } from "../trace/types.ts";

function history(...pairs: [ConversationMessage["role"], string][]): ConversationMessage[] {
  return pairs.map(([role, content]) => ({ role, content, createdAt: new Date("2026-01-01T00:00:00.000Z") }));
}

function memories(...entries: [string, string, number][]): RecalledMemory[] {
  return entries.map(([memoryId, fact, score]) => ({ memoryId, fact, score }));
}

describe("buildContextBreakdown", () => {
  it("with no history, no summary and no memories, estimates only the message (B1)", () => {
    const message = "quais alertas estão abertos?";
    const breakdown = buildContextBreakdown({ message, history: [], summary: null, memories: [] });

    assert.deepEqual(breakdown, {
      message: estimateTokens(message),
      history: 0,
      summary: 0,
      memories: 0,
      total: estimateTokens(message),
    });
  });

  it("estimates history as the block withConversationHistory actually prefixes (B2)", () => {
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "3 em checkout-api."]);
    const breakdown = buildContextBreakdown({ message: "e o runbook dele?", history: h, summary: null, memories: [] });

    assert.equal(breakdown.history, estimateTokens(formatHistoryBlock(h)));
  });

  it("estimates memories as the block withMemory actually prefixes (B3)", () => {
    const m = memories(["mem-1", "Sou responsável pelo checkout", 0.8]);
    const breakdown = buildContextBreakdown({ message: "quais serviços são meus?", history: [], summary: null, memories: m });

    assert.equal(breakdown.memories, estimateTokens(formatMemoriesBlock(m)));
  });

  it("total is the sum of the four sources (M7/SM4)", () => {
    const h = history(["user", "oi"]);
    const m = memories(["mem-1", "fato", 0.5]);
    const message = "pergunta";
    const breakdown = buildContextBreakdown({ message, history: h, summary: null, memories: m });

    assert.equal(breakdown.total, breakdown.message + breakdown.history + breakdown.summary + breakdown.memories);
  });

  it("the three pre-011 blocks concatenated still reproduce exactly what the strategy receives (B4)", () => {
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "3 em checkout-api."]);
    const m = memories(["mem-1", "Sou responsável pelo checkout", 0.8]);
    const message = "e o runbook dele?";

    const context: ConversationHistory = { summary: null, summaryCoveredMessages: 0, messages: h };
    const delivered = formatHistoryInput(context, formatMemoriesInput(m, message));
    assert.equal(formatHistoryBlock(h) + formatMemoriesBlock(m) + message, delivered);
  });

  // --- 011-history-summarization: summary source, SM4, SM5 --------------

  it("summary is 0 with no summary", () => {
    const breakdown = buildContextBreakdown({ message: "oi", history: [], summary: null, memories: [] });
    assert.equal(breakdown.summary, 0);
  });

  it("estimates summary as the block formatSummaryBlock produces", () => {
    const s = "Decidido abrir incidente no checkout; pendente confirmar runbook.";
    const breakdown = buildContextBreakdown({ message: "e o runbook?", history: [], summary: s, memories: [] });
    assert.equal(breakdown.summary, estimateTokens(formatSummaryBlock(s)));
  });

  it("SM5: message+history+summary+memories estimates sum to the length of what withConversationHistory(withMemory(...)) actually delivers", async () => {
    const h = history(["user", "oi"], ["assistant", "olá"]);
    const m = memories(["mem-1", "fato", 0.5]);
    const summary = "Resumo anterior.";
    const message = "pergunta nova";

    let delivered = "";
    const base: ReasoningStrategy = {
      name: "react",
      async run(input): Promise<StrategyResult> {
        delivered = input;
        return { answer: "ok", trace: [], metrics: { llmCalls: 1, latencyMs: 1 }, stoppedReason: "completed" };
      },
    };
    const context: ConversationHistory = { summary, summaryCoveredMessages: 8, messages: h };
    const wrapped = withConversationHistory(withMemory(base, { memories: m, tools: [] }), context);
    await wrapped.run(message);

    // Real decorator nesting order (chat.ts): memories, then summary+history, then message.
    assert.equal(delivered, formatMemoriesBlock(m) + formatSummaryBlock(summary) + formatHistoryBlock(h) + message);

    // The four blocks' own character lengths sum to what was delivered (extension of M6, 010).
    const blockLengths =
      message.length + formatHistoryBlock(h).length + formatSummaryBlock(summary).length + formatMemoriesBlock(m).length;
    assert.equal(blockLengths, delivered.length);
  });
});
