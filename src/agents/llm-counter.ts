import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { inputTokensFromResult } from "../context/tokens.ts";
import { MODEL_USED_EVENT, MODEL_FALLBACK_EVENT } from "./model.ts";
import type { FailureKind } from "../domain/schemas.ts";
import type { TraceEvent } from "../trace/types.ts";

/**
 * Counts chat-model invocations for a single run (FR-006, R-003). A new
 * instance MUST be created per `run()` call so counts never leak across
 * executions.
 *
 * 010-context-measurement: also tracks the REAL input tokens the provider
 * reported, across the same calls counted in `calls`.
 *
 * 013-model-resilience, research R-010 (emends 010): `calls` now counts in
 * `handleLLMEnd`, not `handleChatModelStart` — a call that never completes
 * (an attempt `resilient` retries or falls back away from) must NOT count,
 * or a single transient failure would inflate `llmCalls` by the number of
 * attempts it took (FR-024). `reportedCalls` still tracks how many of
 * those COMPLETED calls carried a usable `usage_metadata` (research R-004
 * of 010) — a call that ended without one still counts in `calls`, but
 * makes `promptTokens` fall back to `undefined` for the whole run (FR-006
 * of 010).
 *
 * Also collects the `fallback` events and the last model used, dispatched
 * by `resilient` (`model.ts`) as custom callback events (research R-007) —
 * this is the ONLY place a strategy learns whether/where a switch to the
 * backup happened, since `resilient` itself never touches the trace.
 */
export class LlmCallCounter extends BaseCallbackHandler {
  name = "LlmCallCounter";
  calls = 0;
  fallbackEvents: TraceEvent[] = [];
  modelUsed: string | undefined;
  private reportedCalls = 0;
  private promptTokenSum = 0;

  /**
   * Deliberately a no-op (research R-010): counting moved to
   * `handleLLMEnd`, kept overridden (rather than removed) only so it has a
   * concrete signature callable from tests without an optional-call guard.
   */
  override handleChatModelStart(): void {}

  override handleLLMEnd(output: LLMResult): void {
    this.calls += 1;
    const inputTokens = inputTokensFromResult(output);
    if (inputTokens === undefined) return;
    this.reportedCalls += 1;
    this.promptTokenSum += inputTokens;
  }

  override handleCustomEvent(name: string, data: unknown): void {
    if (name === MODEL_FALLBACK_EVENT) {
      const { from, to, reason } = data as { from: string; to: string; reason: FailureKind };
      this.fallbackEvents.push({ type: "fallback", from, to, reason });
    } else if (name === MODEL_USED_EVENT) {
      this.modelUsed = (data as { model: string }).model;
    }
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

/** Same "omit when absent" pattern as `promptTokensField` (010, `context/tokens.ts`). */
export function modelUsedField(value: string | undefined): { modelUsed?: string } {
  return value === undefined ? {} : { modelUsed: value };
}
