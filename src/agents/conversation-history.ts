import type { ConversationMessage } from "../domain/schemas.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StrategyResult } from "../trace/types.ts";

/**
 * The single named cap on how much conversation history reaches a
 * strategy per request (007-persistent-conversation, FR-018). Not
 * configurable by environment variable — nothing in the spec asks for
 * per-deployment tuning, and every new env var is one more thing to
 * validate at the boundary.
 */
export const HISTORY_WINDOW = 12;

const ROLE_LABEL: Record<ConversationMessage["role"], string> = {
  user: "[plantonista]",
  assistant: "[OpsPilot]",
};

/**
 * Pure text composition (R-007): the only thing every `ReasoningStrategy`
 * shares is `run(input: string)`, so history is prefixed as text rather
 * than delivered as structured messages — that would require every
 * strategy (ReAct, plan-and-execute, and any future one) to know how to
 * consume it. With no history, `input` passes through untouched, which is
 * what keeps the arena, the bench and the MCP server byte-for-byte
 * unaffected (FR-023, SC-007).
 */
export function formatHistoryInput(history: ConversationMessage[], input: string): string {
  if (history.length === 0) return input;

  const transcript = history.map((message) => `${ROLE_LABEL[message.role]} ${message.content}`).join("\n");

  return [
    "Histórico recente desta conversa (da mais antiga para a mais recente):",
    transcript,
    "",
    "Mensagem atual do plantonista:",
    input,
  ].join("\n");
}

/**
 * Decorates any ReasoningStrategy with conversation history
 * (007-persistent-conversation, FR-017, FR-019): applied by the HTTP
 * handler over whatever `resolveStrategy` returns, never registered in
 * `agents/index.ts` — the registry stays unaware conversations exist.
 *
 * MUST be the outermost layer, above `withReflection` and
 * `withIncidentConfirmation` (R-008): `withReflection` rebuilds `metrics`
 * from scratch on every return, so a `historyMessages` set by an inner
 * layer would be discarded; and the critic needs the history-enriched
 * input as its "original request" to judge a follow-up like "e o runbook
 * dele?" correctly.
 */
export function withConversationHistory(strategy: ReasoningStrategy, history: ConversationMessage[]): ReasoningStrategy {
  return {
    name: strategy.name,
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const result = await strategy.run(formatHistoryInput(history, input), options);
      return { ...result, metrics: { ...result.metrics, historyMessages: history.length } };
    },
  };
}
