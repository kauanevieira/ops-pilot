import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildContextBreakdown } from "./breakdown.ts";
import { estimateTokens } from "./tokens.ts";
import { formatHistoryBlock, formatHistoryInput } from "../agents/conversation-history.ts";
import { formatMemoriesBlock, formatMemoriesInput } from "../memory/with-memory.ts";
import type { ConversationMessage, RecalledMemory } from "../domain/schemas.ts";

function history(...pairs: [ConversationMessage["role"], string][]): ConversationMessage[] {
  return pairs.map(([role, content]) => ({ role, content, createdAt: new Date("2026-01-01T00:00:00.000Z") }));
}

function memories(...entries: [string, string, number][]): RecalledMemory[] {
  return entries.map(([memoryId, fact, score]) => ({ memoryId, fact, score }));
}

describe("buildContextBreakdown", () => {
  it("with no history and no memories, estimates only the message (B1)", () => {
    const message = "quais alertas estão abertos?";
    const breakdown = buildContextBreakdown({ message, history: [], memories: [] });

    assert.deepEqual(breakdown, {
      message: estimateTokens(message),
      history: 0,
      memories: 0,
      total: estimateTokens(message),
    });
  });

  it("estimates history as the block withConversationHistory actually prefixes (B2)", () => {
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "3 em checkout-api."]);
    const breakdown = buildContextBreakdown({ message: "e o runbook dele?", history: h, memories: [] });

    assert.equal(breakdown.history, estimateTokens(formatHistoryBlock(h)));
  });

  it("estimates memories as the block withMemory actually prefixes (B3)", () => {
    const m = memories(["mem-1", "Sou responsável pelo checkout", 0.8]);
    const breakdown = buildContextBreakdown({ message: "quais serviços são meus?", history: [], memories: m });

    assert.equal(breakdown.memories, estimateTokens(formatMemoriesBlock(m)));
  });

  it("total is the sum of the three sources (M7)", () => {
    const h = history(["user", "oi"]);
    const m = memories(["mem-1", "fato", 0.5]);
    const message = "pergunta";
    const breakdown = buildContextBreakdown({ message, history: h, memories: m });

    assert.equal(breakdown.total, breakdown.message + breakdown.history + breakdown.memories);
  });

  it("the three blocks concatenated reproduce exactly what the strategy receives (B4)", () => {
    const h = history(["user", "quais alertas estão abertos?"], ["assistant", "3 em checkout-api."]);
    const m = memories(["mem-1", "Sou responsável pelo checkout", 0.8]);
    const message = "e o runbook dele?";

    const delivered = formatHistoryInput(h, formatMemoriesInput(m, message));
    assert.equal(formatHistoryBlock(h) + formatMemoriesBlock(m) + message, delivered);
  });
});
