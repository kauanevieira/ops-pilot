/**
 * 010-context-measurement: two distinct measures of context, never
 * conflated (see spec.md, FR-013).
 *
 * - REAL: `inputTokensFromResult` reads the provider's own reported input
 *   tokens (`usage_metadata.input_tokens`, set by `@langchain/core`/
 *   `@langchain/openai` on the `AIMessage` of a completed call) and
 *   `sumPromptTokens` combines them across calls. Exact, but only exists
 *   when the provider reports it.
 * - ESTIMATED: `estimateTokens` derives a number from text alone
 *   (characters / 4, rounded up) — cheap, local, approximate. Used by
 *   `src/context/breakdown.ts` to explain composition, not to predict the
 *   real total.
 */
import { BaseMessage, isAIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";

/**
 * Cheap, local, approximate token estimate for a piece of text (research
 * R-006): characters divided by 4, rounded up. Pure — no tokenizer, no
 * model call. `text.length` counts UTF-16 code units, which is what keeps
 * accented Portuguese text (NFC, the normal form for typed/JSON input)
 * from inflating the count the way counting UTF-8 bytes would.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Reads the real input-token count the provider reported for a single
 * chat-model call, from `output.generations[0][0].message.usage_metadata`
 * (research R-001). `llmOutput` is intentionally never read: it's specific
 * to each provider's adapter (e.g. the OpenAI adapter's `tokenUsage` in the
 * non-streaming path, `estimatedTokenUsage` in the streaming one) —
 * `usage_metadata` is the one field `@langchain/core` standardizes across
 * providers and call shapes. `undefined` when there's no generation, no
 * message, the message isn't an `AIMessage`, or it has no numeric
 * `input_tokens` — never `0` for "unknown" (a reported `0` is a real,
 * distinct value; see U2).
 */
export function inputTokensFromResult(output: LLMResult): number | undefined {
  const generation = output.generations[0]?.[0];
  const message = (generation as { message?: BaseMessage } | undefined)?.message;
  // `isAIMessage` assumes a real `BaseMessage` instance and throws on an
  // arbitrary object — guard with `instanceof` first so a malformed or
  // unrelated generation shape (never produced by LangChain itself, but
  // not this function's job to assume) falls through to `undefined`
  // instead of throwing.
  if (!(message instanceof BaseMessage) || !isAIMessage(message)) return undefined;
  const inputTokens = message.usage_metadata?.input_tokens;
  return typeof inputTokens === "number" ? inputTokens : undefined;
}

/**
 * Combines the real input-token counts of several calls into one total
 * (used across a run's calls and, in `withReflection`, across attempts —
 * FR-005, FR-007). `undefined` if any value is `undefined`: one call whose
 * consumption is unknown makes the whole sum unknown, never a partial
 * total presented as complete (FR-006). Sums to `0` for an empty list —
 * that's a real zero (no calls happened), not "unknown".
 */
export function sumPromptTokens(...values: (number | undefined)[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

/**
 * Builds the `{ promptTokens }` fragment to spread into a `RunMetrics`
 * object, or `{}` when the value is unknown — so "absent" means the key
 * itself is missing, never present with `undefined` as its value
 * (data-model.md).
 */
export function promptTokensField(value: number | undefined): { promptTokens?: number } {
  return value === undefined ? {} : { promptTokens: value };
}
