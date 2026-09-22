import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { GraphRecursionError } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { resilient, envModelSource, type ModelSource } from "./model.ts";
import { createOpsTools } from "./tools.ts";
import { LlmCallCounter, modelUsedField } from "./llm-counter.ts";
import { promptTokensField } from "../context/tokens.ts";
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

export interface ReactStrategyOptions {
  /** 013-model-resilience: injectable model source, defaulting to `envModelSource()`. */
  source?: ModelSource;
}

export function createReactStrategy(store: OpsRepository, options: ReactStrategyOptions = {}): ReasoningStrategy {
  const source = options.source ?? envModelSource();

  return {
    name: "react",
    async run(input: string, runOptions?: RunOptions): Promise<StrategyResult> {
      const started = Date.now();
      const maxIterations = runOptions?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const counter = new LlmCallCounter();

      // extraTools (008-semantic-memory, R-011): whatever the HTTP handler
      // scoped to this request (e.g. forget_preference for one
      // userId), appended to the strategy's own ops tools. Empty/absent for
      // arena, bench and MCP — unchanged behavior.
      const toolClasses = [...createOpsTools(store), ...(runOptions?.extraTools ?? [])];
      // `llm` as a FUNCTION, not a bound model (013-model-resilience,
      // research R-001): `withRetry`/`withFallbacks` return a plain
      // `Runnable` with no `bindTools`, so the model is prepared (tools
      // bound) BEFORE `resilient` wraps it, and `createReactAgent`'s
      // dynamic-`llm` path — which calls this function fresh on every
      // ReAct iteration — accepts an already-tool-bound runnable without
      // trying to re-bind `tools` itself.
      const agent = createReactAgent({
        // `bindTools` is optional on `BaseChatModel` in general, but every
        // model `resilient`/`createChatModel` ever builds is a
        // `ChatOpenAI`, which always implements it.
        llm: () => resilient((m) => m.bindTools!(toolClasses), source),
        tools: toolClasses,
      });

      // Stream (rather than invoke) so the last-seen message list survives a
      // GraphRecursionError, letting a limit-hit run still return a partial
      // trace instead of an empty one (FR-005).
      let lastMessages: BaseMessage[] = [];
      try {
        const stream = await agent.stream(
          { messages: [{ role: "user", content: input }] },
          {
            recursionLimit: toRecursionLimit(maxIterations),
            callbacks: [counter],
            streamMode: "values",
            signal: runOptions?.signal,
          },
        );
        for await (const chunk of stream) {
          lastMessages = (chunk as { messages: BaseMessage[] }).messages;
        }

        // 013-model-resilience, FR-013/FR-014/FR-015: the fallback events
        // this run collected go BEFORE the strategy's own trace, and
        // `modelUsed` names the model that produced the final answer.
        const trace = [...counter.fallbackEvents, ...messagesToTrace(lastMessages)];
        return {
          answer: lastAnswer(trace),
          trace,
          metrics: {
            llmCalls: counter.calls,
            latencyMs: Date.now() - started,
            ...promptTokensField(counter.promptTokens),
            ...modelUsedField(counter.modelUsed),
          },
          stoppedReason: "completed",
        };
      } catch (error) {
        if (error instanceof GraphRecursionError) {
          const trace = [...counter.fallbackEvents, ...messagesToTrace(lastMessages)];
          return {
            answer: "",
            trace,
            metrics: {
              llmCalls: counter.calls,
              latencyMs: Date.now() - started,
              ...promptTokensField(counter.promptTokens),
              ...modelUsedField(counter.modelUsed),
            },
            stoppedReason: "max-iterations",
          };
        }
        throw error;
      }
    },
  };
}
