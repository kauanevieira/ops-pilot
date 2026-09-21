import type { ClientTool } from "@langchain/core/tools";
import type { RecalledMemory } from "../domain/schemas.ts";
import type { ReasoningStrategy, RunOptions } from "../agents/types.ts";
import type { StrategyResult } from "../trace/types.ts";

export interface WithMemoryOptions {
  /** The facts recalled for THIS request (already capped/filtered by the store). */
  memories: RecalledMemory[];
  /** forget_preference, already scoped to one userId (009: only memory tool left). */
  tools: ClientTool[];
}

/**
 * Pure text composition (008-semantic-memory, R-012) — same rationale as
 * `formatHistoryInput` in 007: `run(input: string)` is the only thing every
 * strategy shares, so recalled facts are prefixed as text rather than
 * delivered structurally. Empty `memories` ⇒ `input` untouched (FR-023).
 *
 * Each fact's id is printed in brackets, because that id is the only way
 * the agent can name a fact to `forget_preference` — it can only forget what was
 * shown to it here (spec, edge case).
 */
export function formatMemoriesInput(memories: RecalledMemory[], input: string): string {
  if (memories.length === 0) return input;

  const facts = memories.map((m) => `- [${m.memoryId}] ${m.fact}`).join("\n");

  return [
    "Fatos lembrados sobre este usuário (do mais relevante para o menos relevante):",
    facts,
    "",
    input,
  ].join("\n");
}

/**
 * Decorates any ReasoningStrategy with recalled semantic memory
 * (008-semantic-memory, FR-021 to FR-023): applied by the HTTP handler
 * over whatever `resolveStrategy` returned, never registered in
 * `agents/index.ts` (FR-022) — same principle as `withConversationHistory`.
 *
 * MUST be applied outside `withReflection` (R-012, same reasoning as 007's
 * R-008): `withReflection` rebuilds `metrics` from scratch on every
 * return, so a `recalledMemories` set by an inner layer would be
 * discarded, and the critic needs the memory-enriched input as its
 * "original request" to judge the answer with the same context the base
 * strategy had.
 *
 * Composes with `withConversationHistory` by nesting — see
 * contracts/chat-endpoint.md for the exact order used by the handler
 * (facts, then history, then the message).
 */
export function withMemory(strategy: ReasoningStrategy, { memories, tools }: WithMemoryOptions): ReasoningStrategy {
  return {
    name: strategy.name,
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const result = await strategy.run(formatMemoriesInput(memories, input), {
        ...options,
        extraTools: [...(options?.extraTools ?? []), ...tools],
      });
      return { ...result, metrics: { ...result.metrics, recalledMemories: memories.length } };
    },
  };
}
