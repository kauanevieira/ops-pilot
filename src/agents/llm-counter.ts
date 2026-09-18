import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

/**
 * Counts chat-model invocations for a single run (FR-006, R-003). A new
 * instance MUST be created per `run()` call so counts never leak across
 * executions.
 */
export class LlmCallCounter extends BaseCallbackHandler {
  name = "LlmCallCounter";
  calls = 0;

  override handleChatModelStart(): void {
    this.calls += 1;
  }
}
