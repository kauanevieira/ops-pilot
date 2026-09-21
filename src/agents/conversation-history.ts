import type { ConversationMessage } from "../domain/schemas.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StrategyResult } from "../trace/types.ts";

/**
 * The single named cap on how many verbatim messages reach a strategy per
 * request (007-persistent-conversation, FR-018). Reduced from 12 to 8 by
 * 011-history-summarization (FR-001): what falls out of this window is
 * folded into the conversation's cumulative summary instead of simply
 * disappearing (`src/context/conversation-context.ts`). Not configurable by
 * environment variable — nothing in the spec asks for per-deployment
 * tuning, and every new env var is one more thing to validate at the
 * boundary.
 */
export const HISTORY_WINDOW = 8;

const ROLE_LABEL: Record<ConversationMessage["role"], string> = {
  user: "[plantonista]",
  assistant: "[OpsPilot]",
};

/**
 * 011-history-summarization: the labeled, chronologically ordered
 * transcript lines shared by `formatHistoryBlock` (verbatim messages) and
 * `formatSummarizerInput` (the pending messages handed to the summarizer,
 * `src/context/summarizer.ts`) — extracted so both use the exact same
 * rendering (contracts/history-summarization.md, Z3).
 */
export function formatTranscript(messages: ConversationMessage[]): string {
  return messages.map((message) => `${ROLE_LABEL[message.role]} ${message.content}`).join("\n");
}

/**
 * 010-context-measurement: the exact text `formatHistoryInput` prefixes
 * onto `input` — extracted so `src/context/breakdown.ts` can estimate
 * precisely what this decorator adds, instead of reconstructing it
 * separately and risking silent drift (research R-007). `""` with no
 * history, same as `formatHistoryInput`'s early return.
 */
export function formatHistoryBlock(history: ConversationMessage[]): string {
  if (history.length === 0) return "";

  return (
    ["Histórico recente desta conversa (da mais antiga para a mais recente):", formatTranscript(history), "", "Mensagem atual do plantonista:"].join(
      "\n",
    ) + "\n"
  );
}

/**
 * 011-history-summarization: the block that carries the conversation's
 * cumulative summary, when there is one (contracts/history-summarization.md,
 * H1/H2). `""` with no summary — same "absent source, empty block" pattern
 * as `formatHistoryBlock`/`formatMemoriesBlock` — so the entry stays
 * byte-for-byte identical to before this feature when there's nothing to
 * summarize yet (FR-020).
 */
export function formatSummaryBlock(summary: string | null): string {
  if (summary === null) return "";

  return ["Resumo da conversa até aqui (mensagens anteriores ao histórico recente):", summary, ""].join("\n") + "\n";
}

/**
 * 011-history-summarization: what `withConversationHistory` composes for a
 * request — the conversation's summary (if any) and the verbatim messages
 * still in the recent window (data-model.md, `ConversationContext`).
 */
export interface ConversationHistory {
  summary: string | null;
  /** Messages covered by `summary`; 0 when `summary` is null. */
  summaryCoveredMessages: number;
  messages: ConversationMessage[];
}

/**
 * Pure text composition (R-007): the only thing every `ReasoningStrategy`
 * shares is `run(input: string)`, so history is prefixed as text rather
 * than delivered as structured messages — that would require every
 * strategy (ReAct, plan-and-execute, and any future one) to know how to
 * consume it. With no summary and no history, `input` passes through
 * untouched, which is what keeps the arena, the bench and the MCP server
 * byte-for-byte unaffected (FR-023, SC-007; 011: FR-020).
 *
 * Order (011-history-summarization, FR-018, contracts/history-summarization.md,
 * H3): summary block, then history block, then the request. Memories (008)
 * are composed OUTSIDE this function, by `withMemory` wrapping further in
 * (R-008 below), so the final order the model sees is memories, summary,
 * history, message.
 */
export function formatHistoryInput(context: ConversationHistory, input: string): string {
  return formatSummaryBlock(context.summary) + formatHistoryBlock(context.messages) + input;
}

/**
 * Decorates any ReasoningStrategy with conversation history
 * (007-persistent-conversation, FR-017, FR-019; amended by
 * 011-history-summarization to also carry the cumulative summary): applied
 * by the HTTP handler over whatever `resolveStrategy` returns, never
 * registered in `agents/index.ts` — the registry stays unaware
 * conversations exist.
 *
 * MUST be the outermost layer, above `withReflection` and
 * `withIncidentConfirmation` (R-008): `withReflection` rebuilds `metrics`
 * from scratch on every return, so `historyMessages`/`summaryCoveredMessages`
 * set by an inner layer would be discarded; and the critic needs the
 * history-enriched input as its "original request" to judge a follow-up
 * like "e o runbook dele?" correctly.
 */
export function withConversationHistory(strategy: ReasoningStrategy, context: ConversationHistory): ReasoningStrategy {
  return {
    name: strategy.name,
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const result = await strategy.run(formatHistoryInput(context, input), options);
      return {
        ...result,
        metrics: {
          ...result.metrics,
          historyMessages: context.messages.length,
          summaryCoveredMessages: context.summaryCoveredMessages,
        },
      };
    },
  };
}
