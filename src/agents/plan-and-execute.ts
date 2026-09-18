import { Annotation, END, START, StateGraph, GraphRecursionError } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createModel } from "./model.ts";
import { createOpsTools } from "./tools.ts";
import { LlmCallCounter } from "./llm-counter.ts";
import { messagesToTrace } from "../trace/from-messages.ts";
import type { OpsRepository } from "../store/repository.ts";
import { DEFAULT_MAX_ITERATIONS, type ReasoningStrategy, type RunOptions } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";
import { planSchema, replanSchema, type Plan, type Replan } from "./plan-schemas.ts";

const MAX_STEPS = 8;

const PLANNER_PROMPT =
  "Você monta um plano de passos curtos para resolver o pedido de um plantonista de operações, usando as ferramentas disponíveis (list_alerts, open_incident, resolve_incident). Cada passo deve ser uma frase de ação simples e executável. Se o pedido já estiver resolvido ou não exigir nenhuma ação, devolva uma lista vazia de passos.";

const REPLANNER_PROMPT =
  'Você revisa um plano de operações à luz do que já foi executado (campo "done": pares [passo, resultado]) e do que resta ("plan"). Escolha uma decisão: "encerrar" quando tudo que era necessário já foi feito — nesse caso preencha "answer" com a resposta final para o plantonista; "ajustar" quando o plano restante precisa mudar à luz dos resultados — nesse caso preencha "plan" com a nova lista de passos restantes; "seguir" quando o plano restante continua válido como está.';

/**
 * Internal graph state (adapted from the team's PEState reference): `plan`
 * is a list of remaining step descriptions (fixed from the reference's
 * `Annotation<string>()`, since the planner writes `plan.steps`, an array);
 * `done` accumulates [step, result] pairs — its length doubles as the step
 * counter for the 8-step ceiling, so no separate counter field is needed.
 */
const PEState = Annotation.Root({
  input: Annotation<string>(),
  plan: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  done: Annotation<[string, string][]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  answer: Annotation<string>(),
  trace: Annotation<TraceEvent[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

function toRecursionLimit(maxIterations: number): number {
  return 2 * maxIterations + 1;
}

export interface PlanAndExecuteOptions {
  /**
   * bench.ts's `--no-replanner`: skip the replanner's plan-revision LLM
   * call between steps entirely — execute the initial plan straight
   * through, and synthesize the answer from the last step's own result
   * with no extra model call. Trades away mid-run replanning (an empty
   * plan with nothing executed still yields an empty answer, same as the
   * "planejador devolve plano vazio" edge case) for fewer llmCalls, which
   * is exactly what the flag exists to measure.
   */
  disableReplanner?: boolean;
}

export function createPlanAndExecuteStrategy(
  store: OpsRepository,
  options: PlanAndExecuteOptions = {},
): ReasoningStrategy {
  const disableReplanner = options.disableReplanner ?? false;

  return {
    name: "plan-and-execute",
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const started = Date.now();
      const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const counter = new LlmCallCounter();
      const tools = createOpsTools(store);

      async function planner(state: typeof PEState.State) {
        const plan = await createModel().withStructuredOutput<Plan>(planSchema).invoke(
          [
            ["system", PLANNER_PROMPT],
            ["user", state.input],
          ],
          { callbacks: [counter], signal: options?.signal },
        );
        return {
          plan: plan.steps,
          trace: [{ type: "plan", steps: plan.steps, revision: 0 }] satisfies TraceEvent[],
        };
      }

      async function executor(state: typeof PEState.State) {
        const [step, ...rest] = state.plan;
        if (!step) {
          return { plan: rest };
        }

        // Resolves the single step with the ops tools, then pushes it to `done`.
        const stepAgent = createReactAgent({ llm: createModel(), tools });
        const stepResult = await stepAgent.invoke(
          { messages: [{ role: "user", content: step }] },
          { recursionLimit: 5, callbacks: [counter], signal: options?.signal },
        );
        // messagesToTrace labels the last AI message "answer", which is right
        // for a top-level strategy but wrong here: this is one step's own
        // wrap-up, not the overall Plan-and-Execute answer (only the
        // replanner's "encerrar" decision produces that). Relabel it as a
        // thought so the trace has exactly one "answer" event at the end.
        const stepTrace = messagesToTrace(stepResult.messages).map((event) =>
          event.type === "answer" ? ({ type: "thought", content: event.content } satisfies TraceEvent) : event,
        );
        const lastMessage = stepResult.messages.at(-1);
        const resultText =
          typeof lastMessage?.content === "string"
            ? lastMessage.content
            : JSON.stringify(lastMessage?.content ?? "");

        return {
          plan: rest,
          done: [[step, resultText]] as [string, string][],
          trace: stepTrace,
        };
      }

      async function replanner(state: typeof PEState.State) {
        const replan = await createModel().withStructuredOutput<Replan>(replanSchema).invoke(
          [
            ["system", REPLANNER_PROMPT],
            [
              "user",
              JSON.stringify({ input: state.input, done: state.done, plan: state.plan }),
            ],
          ],
          { callbacks: [counter], signal: options?.signal },
        );

        if (replan.decision === "encerrar") {
          const answer = replan.answer ?? "";
          return { answer, trace: [{ type: "answer", content: answer }] satisfies TraceEvent[] };
        }

        const nextPlan = replan.decision === "ajustar" ? replan.plan : state.plan;
        const revision = state.done.length;
        return {
          plan: nextPlan,
          trace: [{ type: "plan", steps: nextPlan, revision }] satisfies TraceEvent[],
        };
      }

      // No LLM call: only produces `answer` when the plan actually ran out
      // (mirrors the replanner's "encerrar" outcome without the call).
      // Reaching this node with steps still pending means the step ceiling
      // was hit — leave `answer` empty so the same stoppedReason
      // classification below (unchanged either way) reads it as
      // "max-steps", not "completed".
      function finisher(state: typeof PEState.State) {
        if (state.plan.length > 0) return {};
        const lastResult = state.done.at(-1)?.[1] ?? "";
        return { answer: lastResult, trace: [{ type: "answer", content: lastResult }] satisfies TraceEvent[] };
      }

      const graph = disableReplanner
        ? new StateGraph(PEState)
            .addNode("planner", planner)
            .addNode("executor", executor)
            .addNode("finisher", finisher)
            .addEdge(START, "planner")
            .addEdge("planner", "executor")
            .addConditionalEdges("executor", (state) => {
              if (state.plan.length === 0) return "finisher";
              if (state.done.length >= MAX_STEPS) return "finisher";
              return "executor";
            })
            .addEdge("finisher", END)
            .compile()
        : new StateGraph(PEState)
            .addNode("planner", planner)
            .addNode("executor", executor)
            .addNode("replanner", replanner)
            .addEdge(START, "planner")
            .addEdge("planner", "executor")
            .addEdge("executor", "replanner")
            .addConditionalEdges("replanner", (state) => {
              if (state.answer) return END;
              if (state.done.length >= MAX_STEPS) return END;
              if (state.plan.length === 0) return END;
              return "executor";
            })
            .compile();

      let lastState: typeof PEState.State | undefined;
      try {
        const stream = await graph.stream(
          { input },
          { recursionLimit: toRecursionLimit(maxIterations), streamMode: "values", signal: options?.signal },
        );
        for await (const chunk of stream) {
          lastState = chunk as typeof PEState.State;
        }
      } catch (error) {
        if (!(error instanceof GraphRecursionError)) throw error;
      }

      const trace = lastState?.trace ?? [];
      const doneCount = lastState?.done.length ?? 0;
      const answer = lastState?.answer ?? "";
      const stoppedReason = answer ? "completed" : doneCount >= MAX_STEPS ? "max-steps" : "max-iterations";

      return {
        answer,
        trace,
        metrics: { llmCalls: counter.calls, latencyMs: Date.now() - started },
        stoppedReason,
      };
    },
  };
}
