import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Route, NodeName, RecalledMemory } from "../domain/schemas.ts";
import { routeDecisionSchema } from "../domain/schemas.ts";
import type { StrategySelection, ResolveStrategy } from "./index.ts";
import type { ReasoningStrategy } from "./types.ts";
import { DEFAULT_MAX_ITERATIONS } from "./types.ts";
import type { TraceEvent, StrategyResult } from "../trace/types.ts";
import type { OpsRepository } from "../store/repository.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import { createMemoryTools } from "../memory/memory-tools.ts";
import { withMemory } from "../memory/with-memory.ts";
import { withConversationHistory } from "./conversation-history.ts";
import type { Summarizer } from "../context/summarizer.ts";
import {
  prepareConversationContext,
  EMPTY_CONVERSATION_CONTEXT,
  type ConversationContext,
} from "../context/conversation-context.ts";
import { buildContextBreakdown } from "../context/breakdown.ts";
import { withTimeout } from "../lib/with-timeout.ts";
import {
  type Router,
  type RouterInput,
  ROUTER_TIMEOUT_MS,
  FALLBACK_REASON,
  OVERRIDE_REASON,
  capReason,
} from "./router.ts";

/**
 * Whether a `/chat` request imposes its own strategy instead of being
 * routed (research R-015): `strategy` present, or `reflect: true` — the
 * latter kept as an override on its own so existing clients that only ever
 * set `reflect: true` (meaning "reflection over react") keep behaving
 * exactly as before this feature. `reflect: false` (explicit or defaulted
 * by `chatRequestSchema`) never counts as an override on its own.
 */
export function isOverride(selection: { strategy?: string; reflect?: boolean }): boolean {
  return selection.strategy !== undefined || selection.reflect === true;
}

/**
 * The registry selection each route maps to (research R-002,
 * data-model.md). `reflect` is reflection over ReAct — the same
 * combination `reflect: true` alone produces today. Reflection over
 * plan-and-execute stays reachable only by override (spec Assumptions).
 */
export const ROUTE_SELECTIONS: Record<Route, StrategySelection> = {
  react: { name: "react", reflect: false },
  "plan-and-execute": { name: "plan-and-execute", reflect: false },
  reflect: { name: "react", reflect: true },
};

/**
 * The inverse of `ROUTE_SELECTIONS` (contracts/production-graph.md, G10):
 * given any selection (from an override or from a routed decision), which
 * graph node runs. Mirrors `resolveStrategy`'s own defaulting (`name`
 * undefined -> react) so a selection built from a request body maps the
 * same way whether or not `strategy` was given.
 */
export function routeForSelection(selection: { name?: string; reflect?: boolean }): Route {
  if (selection.reflect) return "reflect";
  return selection.name === "plan-and-execute" ? "plan-and-execute" : "react";
}

/**
 * The `strategy` field of the `route` trace event: the exact combination
 * that ran, in the registry's own vocabulary (`react`,
 * `plan-and-execute`, `reflect:react`, `reflect:plan-and-execute`) — the
 * same prefix convention `agents/index.ts` uses to derive its
 * `reflect:*` entries. Needed alongside `route` because `route` alone
 * can't tell a routed `reflect` (always `reflect:react`) from an
 * overridden `plan-and-execute` with reflection (`reflect:plan-and-execute`),
 * both of which run on the `reflect` node.
 */
export function strategyLabel(selection: { name?: string; reflect?: boolean }): string {
  const base = selection.name ?? "react";
  return selection.reflect ? `reflect:${base}` : base;
}

/**
 * Stamps every event with the node that produced it (research R-011):
 * pure and non-mutating — returns copies, so a node can stamp the
 * strategy's own trace without the strategy (or any other reader holding
 * a reference to the same array) ever seeing `nodeName` appear on its
 * events.
 */
export function stampNode(events: readonly TraceEvent[], node: NodeName): TraceEvent[] {
  return events.map((event) => ({ ...event, nodeName: node }));
}

// --- The graph (research R-001, R-002, R-011 to R-013; contracts/production-graph.md) --------

/** An already-resolved strategy imposed by the request's own `strategy`/`reflect` fields (research R-003). */
export interface OverrideChoice {
  selection: StrategySelection;
  strategy: ReasoningStrategy;
}

export interface ProductionGraphDeps {
  store: OpsRepository;
  conversationStore: ConversationStore;
  memoryStore: MemoryStore;
  resolveStrategy: ResolveStrategy;
  summarizer: Summarizer;
  summaryTimeoutMs: number;
  router: Router;
  routerTimeoutMs: number;
}

export interface ProductionGraphInput {
  message: string;
  /** Already checked to exist by the handler (404 happens before `run`). */
  conversationId?: string;
  userId?: string;
  /** Present exactly when `isOverride` was true for this request (research R-003). */
  override?: OverrideChoice;
}

/**
 * Internal graph state (data-model.md). `trace` is the only accumulating
 * channel — every node appends its own already-`stampNode`d slice; every
 * other channel is last-value, written once by the node that owns it.
 */
const ProductionGraphState = Annotation.Root({
  message: Annotation<string>(),
  conversationId: Annotation<string | undefined>(),
  userId: Annotation<string | undefined>(),
  override: Annotation<OverrideChoice | undefined>(),
  conversationContext: Annotation<ConversationContext>({
    reducer: (_left, right) => right,
    default: () => EMPTY_CONVERSATION_CONTEXT,
  }),
  memories: Annotation<RecalledMemory[]>({ reducer: (_left, right) => right, default: () => [] }),
  route: Annotation<Route | undefined>(),
  strategy: Annotation<ReasoningStrategy | undefined>(),
  trace: Annotation<TraceEvent[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  result: Annotation<StrategyResult | undefined>(),
  output: Annotation<StrategyResult | undefined>(),
});

type GraphState = typeof ProductionGraphState.State;

/**
 * Compiles the graph once per `createProductionGraph` call (`createChatHandler`
 * calls this once, not per request — research R-001). No checkpointer: each
 * `run` is a single, self-contained invocation.
 */
export function createProductionGraph(deps: ProductionGraphDeps): {
  run(input: ProductionGraphInput, signal: AbortSignal): Promise<StrategyResult>;
} {
  const { store, conversationStore, memoryStore, resolveStrategy, summarizer, summaryTimeoutMs, router, routerTimeoutMs } = deps;

  /**
   * `context` node (FR-002, R-013): the exact `Promise.all` of
   * `prepareConversationContext` (011) and `memoryStore.recall` (008) the
   * `/chat` handler ran before this feature, moved here unchanged — same
   * fail-open rules, same log message. Emits the `summarize` event,
   * stamped `context`, when a summary was produced and saved this request.
   */
  async function contextNode(state: GraphState, config: LangGraphRunnableConfig): Promise<Partial<GraphState>> {
    let memories: RecalledMemory[] = [];

    const [conversationContext] = await Promise.all([
      state.conversationId
        ? prepareConversationContext(
            { conversationStore, summarizer, timeoutMs: summaryTimeoutMs },
            state.conversationId,
            config.signal as AbortSignal,
          )
        : Promise.resolve<ConversationContext>(EMPTY_CONVERSATION_CONTEXT),
      state.userId
        ? memoryStore
            .recall(state.userId, state.message)
            .then((recalled) => {
              memories = recalled;
            })
            .catch((error: unknown) => {
              console.error("Falha ao recuperar memória semântica:", error);
            })
        : Promise.resolve(),
    ]);

    const trace = conversationContext.summarizeEvent ? stampNode([conversationContext.summarizeEvent], "context") : [];
    return { conversationContext, memories, trace };
  }

  /**
   * `router` node (FR-007 to FR-018, R-003, R-008, R-012; contracts/router.md
   * RN1-RN7). With `override`, the router is never consulted (RN1). Without
   * it, the router is called once, raced against `routerTimeoutMs` and the
   * request's own `signal`; any failure that isn't the request itself being
   * aborted recovers to `react` (RN4/RN5). `resolveStrategy` runs exactly
   * once either way (research R-003), and never inside the recovered-from
   * `try` (RN6) — a broken registry is a technical failure (500), not a
   * router fallback.
   */
  async function routerNode(state: GraphState, config: LangGraphRunnableConfig): Promise<Partial<GraphState>> {
    const override = state.override;

    let route: Route;
    let strategy: ReasoningStrategy;
    let reason: string;
    let source: "router" | "override" | "fallback";

    if (override) {
      route = routeForSelection(override.selection);
      strategy = override.strategy;
      reason = OVERRIDE_REASON;
      source = "override";
    } else {
      const routerInput: RouterInput = {
        message: state.message,
        summary: state.conversationContext.summary,
        messages: state.conversationContext.messages,
      };

      let decided: { route: Route; reason: string } | undefined;
      try {
        const raw = await withTimeout(routerTimeoutMs, (innerSignal) => router(routerInput, innerSignal), {
          parentSignal: config.signal,
          timeoutMessage: "Tempo limite do roteador excedido.",
        });
        const parsed = routeDecisionSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error("Decisão do roteador fora do formato esperado.");
        }
        decided = { route: parsed.data.route, reason: capReason(parsed.data.reason) };
      } catch (error) {
        // RN5: an aborted REQUEST (not a router failure) must not be
        // recovered from — it has to propagate so the handler's own race
        // against its deadline still resolves as a 504.
        if (config.signal?.aborted) throw error;
        console.error("Falha ao rotear pedido:", error);
      }

      if (decided) {
        route = decided.route;
        reason = decided.reason;
        source = "router";
      } else {
        route = "react";
        reason = FALLBACK_REASON;
        source = "fallback";
      }
      strategy = resolveStrategy(ROUTE_SELECTIONS[route], store);
    }

    const label = override ? strategyLabel(override.selection) : strategyLabel(ROUTE_SELECTIONS[route]);
    const trace = stampNode([{ type: "route", route, strategy: label, reason, source }], "router");
    return { route, strategy, trace };
  }

  /**
   * One factory shared by the three strategy nodes (research R-002): each
   * runs whatever `resolveStrategy`/`override` produced, wrapped with the
   * same decorators and in the same order the `/chat` handler used before
   * this feature — `withMemory` inside `withConversationHistory` (007/008,
   * R-008 in both) — then stamps the strategy's own trace, critique
   * included, with this node's name (G5).
   */
  function createStrategyNode(node: NodeName) {
    return async function strategyNode(state: GraphState, config: LangGraphRunnableConfig): Promise<Partial<GraphState>> {
      let strategyToRun = state.strategy as ReasoningStrategy;
      if (state.userId) {
        strategyToRun = withMemory(strategyToRun, {
          memories: state.memories,
          tools: createMemoryTools(memoryStore, state.userId),
        });
      }
      const finalStrategy = withConversationHistory(strategyToRun, state.conversationContext);
      const result = await finalStrategy.run(state.message, {
        maxIterations: DEFAULT_MAX_ITERATIONS,
        signal: config.signal,
      });
      return { result, trace: stampNode(result.trace, node) };
    };
  }

  /**
   * `response` node (FR-005, G6): the final `StrategyResult` — the
   * strategy's own `answer`/`stoppedReason`/`metrics`, the accumulated
   * `trace` channel (context's `summarize`, `router`'s `route`, then the
   * strategy's own events, in that order — G4), and `contextBreakdown`
   * computed the same way the handler did before this feature. Written to
   * the `output` channel, not `response` — LangGraph rejects a node whose
   * name collides with a state channel, and `response` is this node's
   * name, per the contract (`NodeName`).
   */
  function responseNode(state: GraphState): Partial<GraphState> {
    const result = state.result as StrategyResult;
    const contextBreakdown = buildContextBreakdown({
      message: state.message,
      history: state.conversationContext.messages,
      summary: state.conversationContext.summary,
      memories: state.memories,
    });
    const response: StrategyResult = {
      ...result,
      trace: state.trace,
      metrics: { ...result.metrics, contextBreakdown },
    };
    return { output: response };
  }

  const graph = new StateGraph(ProductionGraphState)
    .addNode("context", contextNode)
    .addNode("router", routerNode)
    .addNode("react", createStrategyNode("react"))
    .addNode("plan-and-execute", createStrategyNode("plan-and-execute"))
    .addNode("reflect", createStrategyNode("reflect"))
    .addNode("response", responseNode)
    .addEdge(START, "context")
    .addEdge("context", "router")
    .addConditionalEdges("router", (state) => state.route as Route, ["react", "plan-and-execute", "reflect"])
    .addEdge("react", "response")
    .addEdge("plan-and-execute", "response")
    .addEdge("reflect", "response")
    .addEdge("response", END)
    .compile();

  return {
    async run(input: ProductionGraphInput, signal: AbortSignal): Promise<StrategyResult> {
      const finalState = (await graph.invoke(input, { signal })) as GraphState;
      return finalState.output as StrategyResult;
    },
  };
}
