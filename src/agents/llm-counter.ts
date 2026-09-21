import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { inputTokensFromResult } from "../context/tokens.ts";

/**
 * Counts chat-model invocations for a single run (FR-006, R-003). A new
 * instance MUST be created per `run()` call so counts never leak across
 * executions.
 *
 * 010-context-measurement: also tracks the REAL input tokens the provider
 * reported, across the same calls counted in `calls`. `reportedCalls`
 * tracks how many of the started calls actually reached `handleLLMEnd`
 * with a usable `usage_metadata` (research R-004) — a call that fails
 * fires `handleLLMError` instead and never reaches `handleLLMEnd`, so it
 * advances `calls` without advancing `reportedCalls`, which is exactly
 * what makes `promptTokens` fall back to `undefined` for the rest of the
 * run: one unreported call makes the whole sum unknown (FR-006).
 */
export class LlmCallCounter extends BaseCallbackHandler {
  name = "LlmCallCounter";
  calls = 0;
  private reportedCalls = 0;
  private promptTokenSum = 0;

  override handleChatModelStart(): void {
    this.calls += 1;
  }

  override handleLLMEnd(output: LLMResult): void {
    const inputTokens = inputTokensFromResult(output);
    if (inputTokens === undefined) return;
    this.reportedCalls += 1;
    this.promptTokenSum += inputTokens;
  }

  /**
   * The real sum of input tokens across every call started on this
   * instance, or `undefined` if any of them didn't end with a reported
   * `usage_metadata`. `0` when `calls === 0` — a run with no calls
   * consumed 0, not "unknown".
   */
  get promptTokens(): number | undefined {
    return this.reportedCalls === this.calls ? this.promptTokenSum : undefined;
  }
}
