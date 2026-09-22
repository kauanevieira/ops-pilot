import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOverride,
  routeForSelection,
  strategyLabel,
  ROUTE_SELECTIONS,
  stampNode,
  createProductionGraph,
  type ProductionGraphDeps,
} from "./production-graph.ts";
import type { Route } from "../domain/schemas.ts";
import type { TraceEvent, StrategyResult } from "../trace/types.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { ResolveStrategy, StrategySelection } from "./index.ts";
import type { OpsRepository } from "../store/repository.ts";
import { type Router, capReason, FALLBACK_REASON, ROUTE_REASON_MAX_CHARS } from "./router.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import type { RecalledMemory } from "../domain/schemas.ts";
import { InMemoryConversationStore } from "../store/in-memory-conversation-store.ts";
import { formatHistoryInput } from "../agents/conversation-history.ts";
import { formatMemoriesInput } from "../memory/with-memory.ts";
import { buildContextBreakdown } from "../context/breakdown.ts";

// isOverride (data-model.md): strategy present OR reflect === true.
describe("isOverride", () => {
  it("false without strategy and without reflect", () => {
    assert.equal(isOverride({ strategy: undefined, reflect: false }), false);
  });

  it("true with strategy, even with reflect false", () => {
    assert.equal(isOverride({ strategy: "react", reflect: false }), true);
  });

  it("true with reflect true alone (research R-015)", () => {
    assert.equal(isOverride({ strategy: undefined, reflect: true }), true);
  });
});

// routeForSelection (data-model.md): maps a registry selection to a Route.
describe("routeForSelection", () => {
  it("react, no reflect -> react", () => {
    assert.equal(routeForSelection({ name: "react", reflect: false }), "react");
  });

  it("plan-and-execute, no reflect -> plan-and-execute", () => {
    assert.equal(routeForSelection({ name: "plan-and-execute", reflect: false }), "plan-and-execute");
  });

  it("no name, reflect -> reflect", () => {
    assert.equal(routeForSelection({ name: undefined, reflect: true }), "reflect");
  });

  it("plan-and-execute, reflect -> reflect (reflection over plan-and-execute stays override-only)", () => {
    assert.equal(routeForSelection({ name: "plan-and-execute", reflect: true }), "reflect");
  });

  it("no name, no reflect -> react (the registry's own default)", () => {
    assert.equal(routeForSelection({ name: undefined, reflect: false }), "react");
  });
});

// strategyLabel (data-model.md): the registry's own vocabulary for a selection.
describe("strategyLabel", () => {
  it("no name, no reflect -> \"react\"", () => {
    assert.equal(strategyLabel({ name: undefined, reflect: false }), "react");
  });

  it("plan-and-execute with reflect -> \"reflect:plan-and-execute\"", () => {
    assert.equal(strategyLabel({ name: "plan-and-execute", reflect: true }), "reflect:plan-and-execute");
  });

  it("no name, reflect -> \"reflect:react\"", () => {
    assert.equal(strategyLabel({ name: undefined, reflect: true }), "reflect:react");
  });
});

// G10 (contracts/production-graph.md): ROUTE_SELECTIONS round-trips through routeForSelection.
describe("ROUTE_SELECTIONS", () => {
  it("routeForSelection(ROUTE_SELECTIONS[r]) === r for every route", () => {
    for (const route of Object.keys(ROUTE_SELECTIONS) as Route[]) {
      assert.equal(routeForSelection(ROUTE_SELECTIONS[route]), route);
    }
  });
});

// G11 (contracts/production-graph.md): stampNode copies, never mutates.
describe("stampNode", () => {
  it("returns copies carrying the given nodeName", () => {
    const events: TraceEvent[] = [{ type: "thought", content: "oi" }];
    const stamped = stampNode(events, "react");
    assert.deepEqual(stamped, [{ type: "thought", content: "oi", nodeName: "react" }]);
  });

  it("does not mutate the input array or its events", () => {
    const events: TraceEvent[] = [{ type: "answer", content: "resposta" }];
    const snapshot = structuredClone(events);
    stampNode(events, "response");
    assert.deepEqual(events, snapshot);
  });
});

// --- The graph: G1-G8 (contracts/production-graph.md), RN2-RN7 (contracts/router.md) ---------
//
// Test doubles live only here (never in src/ outside *.test.ts), same rule
// as server.test.ts's own fakes.

function fixedResult(name: string, overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    answer: `resposta de ${name}`,
    trace: [{ type: "answer", content: `resposta de ${name}` }],
    metrics: { llmCalls: 2, latencyMs: 5 },
    stoppedReason: "completed",
    ...overrides,
  };
}

/** A `ReasoningStrategy` whose `run` records every call it received. */
function recordingStrategy(
  name: string,
  result: StrategyResult,
): { strategy: ReasoningStrategy; calls: { input: string; options?: RunOptions }[] } {
  const calls: { input: string; options?: RunOptions }[] = [];
  const strategy: ReasoningStrategy = {
    name,
    async run(input, options) {
      calls.push({ input, options });
      return result;
    },
  };
  return { strategy, calls };
}

/** Never resolves; rejects the moment its `signal` aborts (G7). */
function hangingStrategy(name: string): ReasoningStrategy {
  return {
    name,
    run(_input, options) {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("estratégia abortada")));
      });
    },
  };
}

/** Rejects immediately (G8). */
function throwingStrategy(name: string, error: unknown): ReasoningStrategy {
  return {
    name,
    async run() {
      throw error;
    },
  };
}

/** Records every selection it was asked to resolve (RN6, G1, G2). */
function recordingResolveStrategy(strategy: ReasoningStrategy): { resolveStrategy: ResolveStrategy; calls: StrategySelection[] } {
  const calls: StrategySelection[] = [];
  const resolveStrategy: ResolveStrategy = (selection) => {
    calls.push(selection);
    return strategy;
  };
  return { resolveStrategy, calls };
}

/** Always decides the given route (RN2, RN3). Records every input it received. */
function fixedRouter(route: Route, reason: string): { router: Router; calls: unknown[] } {
  const calls: unknown[] = [];
  const router: Router = async (input) => {
    calls.push(input);
    return { route, reason };
  };
  return { router, calls };
}

/** Always rejects (RN4). */
function rejectingRouter(error: unknown = new Error("falha do roteador")): Router {
  return async () => {
    throw error;
  };
}

/** Returns whatever value the test hands it, valid or not (RN3/RN4). */
function invalidRouter(value: unknown): Router {
  return async () => value;
}

/** Never resolves (RN4, RN5). */
function neverResolvingRouter(): Router {
  return () => new Promise<unknown>(() => {});
}

/** No memory recalled or remembered; `remember`/`forget` fail loudly if ever called by a test that doesn't expect them. */
function fakeMemoryStore(memories: RecalledMemory[] = []): MemoryStore {
  return {
    async remember() {
      throw new Error("fakeMemoryStore.remember não esperado neste teste");
    },
    async recall() {
      return memories;
    },
    forget() {
      throw new Error("fakeMemoryStore.forget não esperado neste teste");
    },
  };
}

/** `recall` always rejects (G8's "recall que rejeita"). */
function rejectingRecallMemoryStore(error: unknown): MemoryStore {
  return {
    async remember() {
      throw new Error("rejectingRecallMemoryStore.remember não esperado neste teste");
    },
    async recall() {
      throw error;
    },
    forget() {
      throw new Error("rejectingRecallMemoryStore.forget não esperado neste teste");
    },
  };
}

/** Deterministic, offline: never calls a model (Constitution, Princípio V). */
function fixedSummarizer(content: string) {
  return async () => content;
}

/** N messages (alternating user/assistant), starting with `user`. */
function seedConversation(store: InMemoryConversationStore, n: number): string {
  const conversationId = store.create();
  for (let i = 0; i < n; i += 1) {
    store.append(conversationId, [{ role: i % 2 === 0 ? "user" : "assistant", content: `mensagem ${i}` }]);
  }
  return conversationId;
}

function makeDeps(overrides: Partial<ProductionGraphDeps> = {}): ProductionGraphDeps {
  const { strategy } = recordingStrategy("react", fixedResult("react"));
  const { resolveStrategy } = recordingResolveStrategy(strategy);
  const { router } = fixedRouter("react", "dublê");
  return {
    // Nenhuma estratégia falsa aqui chama uma ferramenta real, então um
    // `OpsRepository` nunca é lido — só precisa satisfazer o tipo que
    // `resolveStrategy` espera receber.
    store: {} as OpsRepository,
    conversationStore: new InMemoryConversationStore(),
    memoryStore: fakeMemoryStore(),
    resolveStrategy,
    summarizer: fixedSummarizer("resumo falso"),
    summaryTimeoutMs: 1_000,
    router,
    routerTimeoutMs: 1_000,
    ...overrides,
  };
}

describe("createProductionGraph", () => {
  it("G1: exatamente um nó de estratégia roda por pedido", async () => {
    const { strategy, calls } = recordingStrategy("plan-and-execute", fixedResult("plan-and-execute"));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const { router } = fixedRouter("plan-and-execute", "várias etapas dependentes");
    const graph = createProductionGraph(makeDeps({ resolveStrategy, router }));

    const response = await graph.run({ message: "investigue e resolva" }, new AbortController().signal);

    assert.equal(calls.length, 1);
    assert.ok(response.trace.some((e) => e.nodeName === "plan-and-execute"));
    assert.ok(!response.trace.some((e) => e.nodeName === "react" || e.nodeName === "reflect"));
  });

  it("G2: com override, resolveStrategy não é chamado; sem override, uma chamada", async () => {
    const { strategy: overridden, calls: overriddenCalls } = recordingStrategy("plan-and-execute", fixedResult("plan-and-execute"));
    const { resolveStrategy, calls } = recordingResolveStrategy(overridden);
    const graph = createProductionGraph(makeDeps({ resolveStrategy }));

    const withOverride = await graph.run(
      {
        message: "oi",
        override: { selection: { name: "plan-and-execute", reflect: false }, strategy: overridden },
      },
      new AbortController().signal,
    );
    assert.equal(calls.length, 0);
    assert.equal(overriddenCalls.length, 1);
    assert.ok(withOverride.trace.some((e) => e.nodeName === "plan-and-execute"));

    await graph.run({ message: "oi de novo" }, new AbortController().signal);
    assert.equal(calls.length, 1);
  });

  it("G3: a entrada da estratégia é memórias + resumo/histórico + mensagem", async () => {
    const conversationStore = new InMemoryConversationStore();
    const conversationId = seedConversation(conversationStore, 6); // 3 turnos, abaixo da janela — sem sumarização
    const memories: RecalledMemory[] = [{ memoryId: "m1", fact: "prefere respostas curtas", score: 0.9 }];
    const { strategy, calls } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const graph = createProductionGraph(
      makeDeps({ resolveStrategy, conversationStore, memoryStore: fakeMemoryStore(memories) }),
    );

    await graph.run({ message: "e agora?", conversationId, userId: "kauane" }, new AbortController().signal);

    assert.equal(calls.length, 1);
    const conversationContext = conversationStore.getSummary(conversationId);
    assert.equal(conversationContext, null); // confirma que não houve sumarização nesta conversa curta
    const history = { summary: null, summaryCoveredMessages: 0, messages: conversationStore.messagesRange(conversationId, 0, 6) };
    const expected = formatMemoriesInput(memories, formatHistoryInput(history, "e agora?"));
    assert.equal(calls[0]?.input, expected);
  });

  it("G4: route na posição 0 sem resumo; summarize depois route com resumo", async () => {
    // Sem resumo: 1 turno (2 mensagens), bem abaixo do gatilho de 8 pendentes.
    const shortStore = new InMemoryConversationStore();
    const shortConversation = seedConversation(shortStore, 2);
    const { strategy: shortStrategy } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy: shortResolve } = recordingResolveStrategy(shortStrategy);
    const shortGraph = createProductionGraph(makeDeps({ resolveStrategy: shortResolve, conversationStore: shortStore }));
    const shortResponse = await shortGraph.run({ message: "oi", conversationId: shortConversation }, new AbortController().signal);
    assert.equal(shortResponse.trace[0]?.type, "route");
    assert.ok(!shortResponse.trace.some((e) => e.type === "summarize"));

    // Com resumo: 16 mensagens => 8 pendentes, dispara sumarização (011, SUMMARY_BATCH).
    const longStore = new InMemoryConversationStore();
    const longConversation = seedConversation(longStore, 16);
    const { strategy: longStrategy } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy: longResolve } = recordingResolveStrategy(longStrategy);
    const longGraph = createProductionGraph(
      makeDeps({ resolveStrategy: longResolve, conversationStore: longStore, summarizer: fixedSummarizer("resumo do início") }),
    );
    const longResponse = await longGraph.run({ message: "e o resto?", conversationId: longConversation }, new AbortController().signal);
    assert.equal(longResponse.trace[0]?.type, "summarize");
    assert.equal(longResponse.trace[1]?.type, "route");
  });

  it("G5: todo evento traz nodeName, e o rastro de reflect (crítica incluída) sai todo com nó reflect", async () => {
    const reflectTrace: TraceEvent[] = [
      { type: "thought", content: "pensando" },
      { type: "critique", content: "aprovado: ok" },
      { type: "answer", content: "resposta final" },
    ];
    const { strategy } = recordingStrategy("reflect:react", fixedResult("reflect:react", { trace: reflectTrace }));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const { router } = fixedRouter("reflect", "efeito colateral");
    const graph = createProductionGraph(makeDeps({ resolveStrategy, router }));

    const response = await graph.run({ message: "abra um incidente" }, new AbortController().signal);

    assert.ok(response.trace.every((e) => e.nodeName !== undefined));
    const strategyEvents = response.trace.filter((e) => e.type !== "route");
    assert.ok(strategyEvents.every((e) => e.nodeName === "reflect"));
  });

  it("G6: answer/stoppedReason/metrics.llmCalls da estratégia; contextBreakdown recalculado; historyMessages e summaryCoveredMessages presentes", async () => {
    const result = fixedResult("react", { metrics: { llmCalls: 4, latencyMs: 33 }, stoppedReason: "max-iterations" });
    const { strategy } = recordingStrategy("react", result);
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const graph = createProductionGraph(makeDeps({ resolveStrategy }));

    const response = await graph.run({ message: "oi" }, new AbortController().signal);

    assert.equal(response.answer, result.answer);
    assert.equal(response.stoppedReason, "max-iterations");
    assert.equal(response.metrics.llmCalls, 4);
    assert.deepEqual(
      response.metrics.contextBreakdown,
      buildContextBreakdown({ message: "oi", history: [], summary: null, memories: [] }),
    );
    assert.equal(response.metrics.historyMessages, 0);
    assert.equal(response.metrics.summaryCoveredMessages, 0);
  });

  it("G7: abortar o signal de run aborta o signal recebido pela estratégia, e run rejeita", async () => {
    const strategy = hangingStrategy("react");
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const graph = createProductionGraph(makeDeps({ resolveStrategy }));

    const controller = new AbortController();
    const runPromise = graph.run({ message: "oi" }, controller.signal);
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(runPromise);
  });

  it("G8: estratégia que lança rejeita run sem chamar resolveStrategy de novo; recall que rejeita resolve com zero memórias", async () => {
    const error = new Error("falha técnica da estratégia");
    const strategy = throwingStrategy("react", error);
    const { resolveStrategy, calls } = recordingResolveStrategy(strategy);
    const graph = createProductionGraph(makeDeps({ resolveStrategy }));

    await assert.rejects(graph.run({ message: "oi" }, new AbortController().signal));
    assert.equal(calls.length, 1);

    const { strategy: recorded, calls: recordedCalls } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy: recordingResolve } = recordingResolveStrategy(recorded);
    const rejectingGraph = createProductionGraph(
      makeDeps({ resolveStrategy: recordingResolve, memoryStore: rejectingRecallMemoryStore(new Error("recall indisponível")) }),
    );
    const response = await rejectingGraph.run({ message: "oi", userId: "kauane" }, new AbortController().signal);
    assert.equal(response.metrics.recalledMemories, 0);
    assert.equal(recordedCalls[0]?.input, "oi");
  });
});

// --- router node: RN2-RN7 (contracts/router.md) -------------------------

describe("production graph — router node (no override)", () => {
  it("RN2: o roteador é chamado uma vez, com message/summary/messages do contexto preparado, e sem memórias", async () => {
    const conversationStore = new InMemoryConversationStore();
    const conversationId = seedConversation(conversationStore, 4); // 2 turnos, sem sumarização
    const memories: RecalledMemory[] = [{ memoryId: "m1", fact: "prefere respostas curtas", score: 0.9 }];
    const { router, calls } = fixedRouter("react", "dublê");
    const { strategy } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const graph = createProductionGraph(
      makeDeps({ resolveStrategy, router, conversationStore, memoryStore: fakeMemoryStore(memories) }),
    );

    await graph.run({ message: "e agora?", conversationId, userId: "kauane" }, new AbortController().signal);

    assert.equal(calls.length, 1);
    const call = calls[0] as { message: string; summary: string | null; messages: unknown[] };
    assert.equal(call.message, "e agora?");
    assert.equal(call.summary, null);
    assert.equal(call.messages.length, 4);
    assert.deepEqual(Object.keys(call).sort(), ["message", "messages", "summary"]);
  });

  it("RN3: para cada rota, resolveStrategy recebe a seleção de ROUTE_SELECTIONS, e o route traz source router e o motivo cortado", async () => {
    const longReason = "motivo ".repeat(80); // > ROUTE_REASON_MAX_CHARS
    for (const route of Object.keys(ROUTE_SELECTIONS) as Route[]) {
      const { strategy } = recordingStrategy(route, fixedResult(route));
      const { resolveStrategy, calls } = recordingResolveStrategy(strategy);
      const { router } = fixedRouter(route, longReason);
      const graph = createProductionGraph(makeDeps({ resolveStrategy, router }));

      const response = await graph.run({ message: "oi" }, new AbortController().signal);

      assert.deepEqual(calls[0], ROUTE_SELECTIONS[route]);
      const routeEvent = response.trace.find((e) => e.type === "route");
      assert.equal(routeEvent?.type, "route");
      if (routeEvent?.type === "route") {
        assert.equal(routeEvent.source, "router");
        assert.equal(routeEvent.reason, capReason(longReason));
        assert.ok(routeEvent.reason.length <= ROUTE_REASON_MAX_CHARS);
      }
    }
  });

  it("RN4: erro, rota inválida ou tempo esgotado do roteador recuam para react, sem erro para o cliente", async () => {
    const cases: { label: string; router: Router }[] = [
      { label: "rejeita", router: rejectingRouter() },
      { label: "rota fora do enum", router: invalidRouter({ route: "planner", reason: "x" }) },
      { label: "não é um objeto", router: invalidRouter("react") },
      { label: "objeto vazio", router: invalidRouter({}) },
    ];

    for (const { router } of cases) {
      const { strategy } = recordingStrategy("react", fixedResult("react"));
      const { resolveStrategy } = recordingResolveStrategy(strategy);
      const graph = createProductionGraph(makeDeps({ resolveStrategy, router }));

      const response = await graph.run({ message: "oi" }, new AbortController().signal);
      const routeEvent = response.trace.find((e) => e.type === "route");
      assert.equal(routeEvent?.type, "route");
      if (routeEvent?.type === "route") {
        assert.equal(routeEvent.route, "react");
        assert.equal(routeEvent.source, "fallback");
        assert.equal(routeEvent.reason, FALLBACK_REASON);
      }
    }

    // Tempo esgotado: recua do mesmo jeito, sem lançar.
    const { strategy: timeoutStrategy } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy: timeoutResolve } = recordingResolveStrategy(timeoutStrategy);
    const timeoutGraph = createProductionGraph(
      makeDeps({ resolveStrategy: timeoutResolve, router: neverResolvingRouter(), routerTimeoutMs: 20 }),
    );
    const timeoutResponse = await timeoutGraph.run({ message: "oi" }, new AbortController().signal);
    const timeoutRouteEvent = timeoutResponse.trace.find((e) => e.type === "route");
    assert.equal(timeoutRouteEvent?.type, "route");
    if (timeoutRouteEvent?.type === "route") {
      assert.equal(timeoutRouteEvent.route, "react");
      assert.equal(timeoutRouteEvent.source, "fallback");
      assert.equal(timeoutRouteEvent.reason, FALLBACK_REASON);
    }
  });

  it("RN5: um signal de run abortado durante o roteamento rejeita run, sem recuar", async () => {
    const { strategy } = recordingStrategy("react", fixedResult("react"));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const graph = createProductionGraph(
      makeDeps({ resolveStrategy, router: neverResolvingRouter(), routerTimeoutMs: 5_000 }),
    );

    const controller = new AbortController();
    const runPromise = graph.run({ message: "oi" }, controller.signal);
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(runPromise);
  });

  it("RN6: resolveStrategy que lança depois de uma decisão válida rejeita run (falha técnica, não recuo)", async () => {
    const { router } = fixedRouter("react", "dublê");
    const resolveStrategy: ResolveStrategy = () => {
      throw new Error("registro quebrado");
    };
    const graph = createProductionGraph(makeDeps({ resolveStrategy, router }));

    await assert.rejects(graph.run({ message: "oi" }, new AbortController().signal));
  });

  it("RN7: llmCalls reflete só a estratégia — o roteador não contribui", async () => {
    const { strategy } = recordingStrategy("react", fixedResult("react", { metrics: { llmCalls: 3, latencyMs: 9 } }));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const { router } = fixedRouter("react", "dublê");
    const graph = createProductionGraph(makeDeps({ resolveStrategy, router }));

    const response = await graph.run({ message: "oi" }, new AbortController().signal);

    assert.equal(response.metrics.llmCalls, 3);
  });
});
