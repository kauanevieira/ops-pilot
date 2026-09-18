import { Annotation, END, START, StateGraph, GraphRecursionError } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createModel } from "./model.ts";
import { createOpsTools } from "./tools.ts";
import { LlmCallCounter } from "./llm-counter.ts";
import { messagesToTrace } from "../trace/from-messages.ts";
import type { OpsRepository } from "../store/repository.ts";
import { DEFAULT_MAX_ITERATIONS, type ReasoningStrategy, type RunOptions } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";
import { planSchema, replanSchema } from "./plan-schemas.ts";

const MAX_STEPS = 8;

const PlanState = Annotation.Root({
  input: Annotation<string>(),
  plan: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  pastSteps: Annotation<[string, string][]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  stepCount: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  response: Annotation<string | null>({ reducer: (_left, right) => right, default: () => null }),
  trace: Annotation<TraceEvent[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
});

function toRecursionLimit(maxIterations: number): number {
  return 2 * maxIterations + 1;
}

export function createPlanAndExecuteStrategy(store: OpsRepository): ReasoningStrategy {
  return {
    name: "plan-and-execute",
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const started = Date.now();
      const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const counter = new LlmCallCounter();
      const tools = createOpsTools(store);

      const planner = createModel().withStructuredOutput(planSchema);
      const replanner = createModel().withStructuredOutput(replanSchema);

      const graph = new StateGraph(PlanState)
        .addNode("planner", async (state) => {
          const plan = await planner.invoke(
            [
              {
                role: "system",
                content:
                  "Você monta um plano de passos curtos para resolver o pedido de um plantonista de operações, usando as ferramentas disponíveis (list_alerts, open_incident, resolve_incident). Cada passo deve ser uma frase de ação simples.",
              },
              { role: "user", content: state.input },
            ],
            { callbacks: [counter] },
          );
          return {
            plan: plan.steps,
            trace: [{ type: "plan", steps: plan.steps, revision: 0 }] satisfies TraceEvent[],
          };
        })
        .addNode("executor", async (state) => {
          const [step, ...rest] = state.plan;
          if (!step) {
            return { plan: rest };
          }

          const stepAgent = createReactAgent({ llm: createModel(), tools });
          const stepResult = await stepAgent.invoke(
            { messages: [{ role: "user", content: step }] },
            { recursionLimit: 5, callbacks: [counter] },
          );
          const stepTrace = messagesToTrace(stepResult.messages);
          const lastMessage = stepResult.messages.at(-1);
          const resultText =
            typeof lastMessage?.content === "string" ? lastMessage.content : JSON.stringify(lastMessage?.content ?? "");

          return {
            plan: rest,
            pastSteps: [[step, resultText]] as [string, string][],
            stepCount: state.stepCount + 1,
            trace: stepTrace,
          };
        })
        .addNode("replanner", async (state) => {
          const replan = await replanner.invoke(
            [
              {
                role: "system",
                content:
                  "Você revisa um plano de operações à luz do que já foi executado. Se tudo que era necessário já foi feito, devolva remainingSteps vazio e uma resposta final em response. Caso contrário, devolva os passos que restam em remainingSteps e response nulo.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  input: state.input,
                  pastSteps: state.pastSteps,
                  remainingPlan: state.plan,
                }),
              },
            ],
            { callbacks: [counter] },
          );

          const revision = state.stepCount;
          const events: TraceEvent[] =
            replan.response != null
              ? [{ type: "answer", content: replan.response }]
              : [{ type: "plan", steps: replan.remainingSteps, revision }];

          return {
            plan: replan.remainingSteps,
            response: replan.response,
            trace: events,
          };
        })
        .addEdge(START, "planner")
        .addEdge("planner", "executor")
        .addEdge("executor", "replanner")
        .addConditionalEdges("replanner", (state) => {
          if (state.response != null) return END;
          if (state.stepCount >= MAX_STEPS) return END;
          if (state.plan.length === 0) return END;
          return "executor";
        })
        .compile();

      let lastState: typeof PlanState.State | undefined;
      try {
        const stream = await graph.stream(
          { input },
          { recursionLimit: toRecursionLimit(maxIterations), streamMode: "values" },
        );
        for await (const chunk of stream) {
          lastState = chunk as typeof PlanState.State;
        }
      } catch (error) {
        if (!(error instanceof GraphRecursionError)) throw error;
      }

      const finalState = lastState;
      const trace = finalState?.trace ?? [];
      const stepCount = finalState?.stepCount ?? 0;
      const response = finalState?.response ?? null;

      const stoppedReason = response != null ? "completed" : stepCount >= MAX_STEPS ? "max-steps" : "max-iterations";

      return {
        answer: response ?? "",
        trace,
        metrics: { llmCalls: counter.calls, latencyMs: Date.now() - started },
        stoppedReason,
      };
    },
  };
}
