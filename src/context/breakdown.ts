import { estimateTokens } from "./tokens.ts";
import { formatHistoryBlock, formatSummaryBlock } from "../agents/conversation-history.ts";
import { formatMemoriesBlock } from "../memory/with-memory.ts";
import type { ConversationMessage, RecalledMemory } from "../domain/schemas.ts";
import type { ContextBreakdown } from "../trace/types.ts";

export interface BuildContextBreakdownInput {
  message: string;
  history: ConversationMessage[];
  /** 011-history-summarization: the conversation's cumulative summary, or null. */
  summary: string | null;
  memories: RecalledMemory[];
}

/**
 * 010-context-measurement: the ESTIMATED context breakdown for one `/chat`
 * request (FR-010 to FR-012), amended by 011-history-summarization (FR-024)
 * with a fourth source, `summary`. Each source is estimated over the exact
 * text block the matching decorator prefixes onto the strategy's input
 * (`formatSummaryBlock`, `formatHistoryBlock`, `formatMemoriesBlock` —
 * research R-007), so the four sources concatenated with `message`
 * reproduce exactly what the strategy received, by construction. `total`
 * is the sum of the four estimates, not a re-estimate of the concatenated
 * text (data-model.md).
 */
export function buildContextBreakdown({ message, history, summary, memories }: BuildContextBreakdownInput): ContextBreakdown {
  const messageTokens = estimateTokens(message);
  const historyTokens = estimateTokens(formatHistoryBlock(history));
  const summaryTokens = estimateTokens(formatSummaryBlock(summary));
  const memoriesTokens = estimateTokens(formatMemoriesBlock(memories));

  return {
    message: messageTokens,
    history: historyTokens,
    summary: summaryTokens,
    memories: memoriesTokens,
    total: messageTokens + historyTokens + summaryTokens + memoriesTokens,
  };
}
