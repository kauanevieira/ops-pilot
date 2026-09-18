import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { GraphRecursionError } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { createModel } from "./model.ts";
import { createOpsTools } from "./tools.ts";
import { LlmCallCounter } from "./llm-counter.ts";
import { messagesToTrace } from "../trace/from-messages.ts";
import type { OpsRepository } from "../store/repository.ts";
import { DEFAULT_MAX_ITERATIONS, type ReasoningStrategy, type RunOptions } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";

function lastAnswer(trace: TraceEvent[]): string {
  const last = [...trace].reverse().find((e) => e.type === "answer");
  return last?.type === "answer" ? last.content : "";
}

/**
 * Converts our "iterations" limit into LangGraph's recursionLimit. A ReAct
 * cycle costs two super-steps (agent node + tools node); 2n+1 keeps
 * --max-iterations meaning what the user asked for (R-004).
 */
function toRecursionLimit(maxIterations: number): number {
  return 2 * maxIterations + 1;
}

export function createReactStrategy(store: OpsRepository): ReasoningStrategy {
  return {
    name: "react",
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const started = Date.now();
      const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const counter = new LlmCallCounter();

      const agent = createReactAgent({
        llm: createModel(),
        tools: createOpsTools(store),
      });

      // Stream (rather than invoke) so the last-seen message list survives a
      // GraphRecursionError, letting a limit-hit run still return a partial
      // trace instead of an empty one (FR-005).
      let lastMessages: BaseMessage[] = [];
      try {
        const stream = await agent.stream(
          { messages: [{ role: "user", content: input }] },
          { recursionLimit: toRecursionLimit(maxIterations), callbacks: [counter], streamMode: "values" },
        );
        for await (const chunk of stream) {
          lastMessages = (chunk as { messages: BaseMessage[] }).messages;
        }

        const trace = messagesToTrace(lastMessages);
        return {
          answer: lastAnswer(trace),
          trace,
          metrics: { llmCalls: counter.calls, latencyMs: Date.now() - started },
          stoppedReason: "completed",
        };
      } catch (error) {
        if (error instanceof GraphRecursionError) {
          const trace = messagesToTrace(lastMessages);
          return {
            answer: "",
            trace,
            metrics: { llmCalls: counter.calls, latencyMs: Date.now() - started },
            stoppedReason: "max-iterations",
          };
        }
        throw error;
      }
    },
  };
}
