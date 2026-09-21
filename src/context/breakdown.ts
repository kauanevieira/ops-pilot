import { estimateTokens } from "./tokens.ts";
import { formatHistoryBlock } from "../agents/conversation-history.ts";
import { formatMemoriesBlock } from "../memory/with-memory.ts";
import type { ConversationMessage, RecalledMemory } from "../domain/schemas.ts";
import type { ContextBreakdown } from "../trace/types.ts";

export interface BuildContextBreakdownInput {
  message: string;
  history: ConversationMessage[];
  memories: RecalledMemory[];
}

/**
 * 010-context-measurement: the ESTIMATED context breakdown for one `/chat`
 * request (FR-010 to FR-012). Each source is estimated over the exact text
 * block the matching decorator prefixes onto the strategy's input
 * (`formatHistoryBlock`, `formatMemoriesBlock` — research R-007), so the
 * three sources concatenated with `message` reproduce exactly what the
 * strategy received, by construction. `total` is the sum of the three
 * estimates, not a re-estimate of the concatenated text (data-model.md).
 */
export function buildContextBreakdown({ message, history, memories }: BuildContextBreakdownInput): ContextBreakdown {
  const messageTokens = estimateTokens(message);
  const historyTokens = estimateTokens(formatHistoryBlock(history));
  const memoriesTokens = estimateTokens(formatMemoriesBlock(memories));

  return {
    message: messageTokens,
    history: historyTokens,
    memories: memoriesTokens,
    total: messageTokens + historyTokens + memoriesTokens,
  };
}
