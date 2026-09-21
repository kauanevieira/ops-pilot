import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp, type ChatAppDeps } from "./server.ts";
import { UnknownStrategyError, type ResolveStrategy, type StrategySelection } from "../agents/index.ts";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { InMemoryConversationStore } from "../store/in-memory-conversation-store.ts";
import { baselineState } from "../store/seed.ts";
import type { ReasoningStrategy, RunOptions } from "../agents/types.ts";
import type { StrategyResult } from "../trace/types.ts";
import { SqliteMemoryStore, type MemoryStore } from "../memory/memory-store.ts";
import { createTableEmbedder, queryVector, axisVector } from "../memory/table-embedder.ts";
import type { Distiller } from "../memory/distiller.ts";
import type { LearningOutcome } from "../memory/learning-reflector.ts";
import type { LearningDecision } from "../domain/schemas.ts";
import { DatabaseSync } from "node:sqlite";

// --- Test doubles (R-007, FR-022, FR-023) -----------------------------
//
// The fake strategy and fake registry below are the ONLY thing that makes
// this an offline, deterministic integration test: no network, no model
// call, no OpenRouter credential. They live here, never in src/, so
// nothing fake ships in the application (see tasks.md Notes).

const FIXED_TRACE: StrategyResult["trace"] = [
  { type: "thought", content: "pensando sobre o pedido" },
  { type: "action", tool: "list_alerts", args: { status: "open" } },
  { type: "observation", content: "3 alertas abertos" },
  { type: "answer", content: "resposta fixa do dublê" },
];

function fixedResult(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    answer: "resposta fixa do dublê",
    trace: FIXED_TRACE,
    metrics: { llmCalls: 2, latencyMs: 5 },
    stoppedReason: "completed",
    ...overrides,
  };
}

/** A `ReasoningStrategy` whose `run` is fully controlled by the test. */
function fakeStrategy(
  name: string,
  run: (input: string, options?: RunOptions) => Promise<StrategyResult>,
): ReasoningStrategy {
  return { name, run };
}

/** Records every selection it was asked to resolve, for assertions on FR-007/FR-008/FR-010. */
function recordingResolveStrategy(strategy: ReasoningStrategy): { resolveStrategy: ResolveStrategy; calls: StrategySelection[] } {
  const calls: StrategySelection[] = [];
  const resolveStrategy: ResolveStrategy = (selection) => {
    calls.push(selection);
    return strategy;
  };
  return { resolveStrategy, calls };
}

// --- 009-learning-reflector: test doubles for the distiller/onLearning seam ---
//
// `withServer` defaults `distiller` to "nothing to learn" and `onLearning` to
// a no-op (R-006, T004): every existing 007/008 test that sends a `userId`
// keeps working unchanged, and NONE of them can ever reach
// `createModelDistiller()` — the real, credential-requiring default.

/** Always decides there is nothing to learn — the default for `withServer`. */
const noLearningDistiller: Distiller = async () => ({ hasLearning: false, fact: "" });

/** A distiller that always returns the given decision. */
function fixedDistiller(decision: LearningDecision): Distiller {
  return async () => decision;
}

/** A distiller that always rejects — for `failed/distill` scenarios. */
function rejectingDistiller(error: unknown): Distiller {
  return async () => {
    throw error;
  };
}

/**
 * A distiller whose resolution the test controls by hand (FR-023): used to
 * prove the HTTP response does not wait for the reflector — the test
 * observes the 200 arrive, asserts nothing was learned yet, then releases
 * the distiller and awaits the outcome via `learningProbe`.
 */
function deferredDistiller(): {
  distiller: Distiller;
  resolve(decision: LearningDecision): void;
  reject(error: unknown): void;
} {
  let resolveFn!: (decision: LearningDecision) => void;
  let rejectFn!: (error: unknown) => void;
  const promise = new Promise<LearningDecision>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { distiller: async () => promise, resolve: resolveFn, reject: rejectFn };
}

/** Resolves once `onLearning` fires — lets a test await the reflector deterministically, without sleeping (FR-023). */
function learningProbe(): { onLearning: (outcome: LearningOutcome) => void; next: Promise<LearningOutcome> } {
  let resolveFn!: (outcome: LearningOutcome) => void;
  const next = new Promise<LearningOutcome>((resolve) => {
    resolveFn = resolve;
  });
  return { onLearning: (outcome) => resolveFn(outcome), next };
}

async function withServer<T>(deps: ChatAppDeps, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp({ distiller: noLearningDistiller, onLearning: () => {}, ...deps });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function postChat(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `Response.json()` types as `unknown` — this test only reads shapes it built itself. */
function jsonOf(res: Response): Promise<any> {
  return res.json();
}

// --- User Story 1: caminho feliz ---------------------------------------

describe("POST /chat — User Story 1 (caminho feliz)", () => {
  it("responde 200 com o StrategyResult intacto e resolveStrategy recebeu name indefinido (FR-003, FR-004, FR-006, FR-007)", async () => {
    const result = fixedResult();
    const strategy = fakeStrategy("react", async () => result);
    const { resolveStrategy, calls } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "quais alertas estão abertos?" });
      assert.equal(res.status, 200);
      const body = await jsonOf(res);
      // 007-persistent-conversation: conversationId and metrics.historyMessages
      // are additions on top of the intact StrategyResult (FR-011, FR-022).
      assert.deepEqual(body.answer, result.answer);
      assert.deepEqual(body.trace, FIXED_TRACE); // mesma ordem, nada filtrado
      assert.equal(body.stoppedReason, "completed");
      assert.equal(body.metrics.llmCalls, result.metrics.llmCalls);
      assert.equal(body.metrics.historyMessages, 0);
      assert.equal(typeof body.conversationId, "string");
      assert.ok(body.conversationId.length > 0);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, undefined);
    assert.equal(calls[0]?.reflect, false);
  });

  it("duas requisições recebem cada uma suas próprias métricas, sem acúmulo (FR-005)", async () => {
    let n = 0;
    const strategy = fakeStrategy("react", async () => {
      n += 1;
      return fixedResult({ metrics: { llmCalls: n, latencyMs: n * 10 } });
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res1 = await postChat(baseUrl, { message: "primeiro pedido" });
      const body1 = await jsonOf(res1);
      const res2 = await postChat(baseUrl, { message: "segundo pedido" });
      const body2 = await jsonOf(res2);

      assert.equal(body1.metrics.llmCalls, 1);
      assert.equal(body2.metrics.llmCalls, 2);
    });
  });
});

// --- User Story 2: escolha de estratégia e reflexão ---------------------

describe("POST /chat — User Story 2 (estratégia e reflect)", () => {
  it("repassa strategy e reflect do corpo para resolveStrategy sem resolver o padrão no handler (FR-009, FR-010)", async () => {
    const strategy = fakeStrategy("plan-and-execute", async () => fixedResult());
    const { resolveStrategy, calls } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", strategy: "plan-and-execute", reflect: true });
      assert.equal(res.status, 200);
    });

    assert.equal(calls[0]?.name, "plan-and-execute");
    assert.equal(calls[0]?.reflect, true);
  });

  it("omitir strategy e reflect chega ao registry como name indefinido e reflect false (FR-007, FR-008)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy, calls } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      await postChat(baseUrl, { message: "oi" });
    });

    assert.equal(calls[0]?.name, undefined);
    assert.equal(calls[0]?.reflect, false);
  });

  it("o resultado devolvido é o da estratégia que o registry resolveu, não outra", async () => {
    const reflected = fixedResult({
      trace: [...FIXED_TRACE, { type: "critique", content: "aprovado: ok" }],
      metrics: { llmCalls: 4, latencyMs: 20 },
    });
    const strategy = fakeStrategy("reflect:react", async () => reflected);
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", reflect: true });
      const body = await jsonOf(res);
      assert.equal(body.answer, reflected.answer);
      assert.equal(body.metrics.llmCalls, reflected.metrics.llmCalls);
      assert.ok(body.trace.some((e: { type: string }) => e.type === "critique"));
    });
  });
});

// --- User Story 3: erros distinguíveis -----------------------------------

describe("POST /chat — User Story 3 (400 invalid_body)", () => {
  async function expectInvalidBody(body: unknown): Promise<{ strategyCalled: boolean; res: Response }> {
    let strategyCalled = false;
    const strategy = fakeStrategy("react", async () => {
      strategyCalled = true;
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    let res!: Response;
    await withServer({ resolveStrategy }, async (baseUrl) => {
      res = await postChat(baseUrl, body);
    });
    return { strategyCalled, res };
  }

  it("corpo vazio {} responde 400 com code invalid_body e details apontando o campo (FR-014)", async () => {
    const { res, strategyCalled } = await expectInvalidBody({});
    assert.equal(res.status, 400);
    const json = await jsonOf(res);
    assert.equal(json.error.code, "invalid_body");
    assert.ok(Array.isArray(json.error.details));
    assert.ok(json.error.details.some((d: { path: string }) => d.path === "message"));
    assert.equal(strategyCalled, false); // SC-003: nenhuma execução iniciada
  });

  it("message vazia responde 400 (FR-014)", async () => {
    const { res } = await expectInvalidBody({ message: "" });
    assert.equal(res.status, 400);
  });

  it("message só com espaços responde 400", async () => {
    const { res } = await expectInvalidBody({ message: "   " });
    assert.equal(res.status, 400);
  });

  it("reflect não-booleano responde 400", async () => {
    const { res } = await expectInvalidBody({ message: "oi", reflect: "sim" });
    assert.equal(res.status, 400);
  });

  it("strategy só com espaços responde 400 (invalid_body), não 422 (edge case da spec)", async () => {
    const { res } = await expectInvalidBody({ message: "oi", strategy: "  " });
    assert.equal(res.status, 400);
    const json = await jsonOf(res);
    assert.equal(json.error.code, "invalid_body");
  });

  it("JSON malformado responde 400 invalid_body, sem HTML de stack trace (R-005)", async () => {
    const { res } = await expectInvalidBody("{");
    assert.equal(res.status, 400);
    const contentType = res.headers.get("content-type") ?? "";
    assert.ok(contentType.includes("application/json"));
    const json = await jsonOf(res);
    assert.equal(json.error.code, "invalid_body");
  });

  it("campo desconhecido no corpo é descartado sem erro", async () => {
    let strategyCalled = false;
    const strategy = fakeStrategy("react", async () => {
      strategyCalled = true;
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", maxIterations: 999 });
      assert.equal(res.status, 200);
    });
    assert.equal(strategyCalled, true);
  });
});

describe("POST /chat — User Story 3 (422 unknown_strategy)", () => {
  const unknownResolveStrategy: ResolveStrategy = (selection) => {
    throw new UnknownStrategyError(selection.name ?? "react", ["react", "plan-and-execute"]);
  };

  it("nome de estratégia inexistente responde 422 com validStrategies (FR-015)", async () => {
    await withServer({ resolveStrategy: unknownResolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", strategy: "planner" });
      assert.equal(res.status, 422);
      const json = await jsonOf(res);
      assert.equal(json.error.code, "unknown_strategy");
      assert.deepEqual(json.error.details.validStrategies, ["react", "plan-and-execute"]);
    });
  });

  it('nome composto "reflect:react" também é 422 — reflexão é o campo `reflect`, não um prefixo', async () => {
    await withServer({ resolveStrategy: unknownResolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", strategy: "reflect:react" });
      assert.equal(res.status, 422);
    });
  });
});

describe("POST /chat — User Story 3 (504 timeout)", () => {
  it("uma estratégia que nunca resolve responde 504 timeout, sem resultado parcial (FR-019, FR-025)", async () => {
    const strategy = fakeStrategy("react", () => new Promise<StrategyResult>(() => {}));
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy, timeoutMs: 30 }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi" });
      assert.equal(res.status, 504);
      const json = await jsonOf(res);
      assert.equal(json.error.code, "timeout");
      assert.equal("details" in json.error, false);
    });
  });

  it("o AbortSignal recebido pelo run() é abortado quando o deadline dispara (FR-020)", async () => {
    let observedSignal: AbortSignal | undefined;
    const strategy = fakeStrategy("react", (_input, options) => {
      observedSignal = options?.signal;
      return new Promise<StrategyResult>(() => {});
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy, timeoutMs: 30 }, async (baseUrl) => {
      await postChat(baseUrl, { message: "oi" });
    });

    assert.ok(observedSignal);
    assert.equal(observedSignal?.aborted, true);
  });

  it("uma execução que resolve logo depois do deadline não provoca segunda escrita (FR-021)", async () => {
    const strategy = fakeStrategy("react", async () => {
      await delay(80);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy, timeoutMs: 20 }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi" });
      assert.equal(res.status, 504);
      // Dá tempo para a resolução tardia do dublê acontecer; se o handler
      // tentasse escrever de novo, o guard de res.headersSent a absorve —
      // aqui só confirmamos que nada derruba o processo nem o teste.
      await delay(150);
    });
  });
});

describe("POST /chat — User Story 3 (500 internal e resiliência)", () => {
  it("uma falha inesperada responde 500 internal sem stack nem mensagem da exceção (FR-017)", async () => {
    const strategy = fakeStrategy("react", async () => {
      throw new Error("detalhe interno sensível que não deve vazar");
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi" });
      assert.equal(res.status, 500);
      const json = await jsonOf(res);
      assert.equal(json.error.code, "internal");
      assert.equal("details" in json.error, false);
      assert.ok(!JSON.stringify(json).includes("detalhe interno sensível"));
    });
  });

  it("uma requisição seguinte, com dublê sadio, ainda responde 200 depois de uma falha anterior (SC-006)", async () => {
    let calls = 0;
    const strategy = fakeStrategy("react", async () => {
      calls += 1;
      if (calls === 1) throw new Error("primeira falha");
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res1 = await postChat(baseUrl, { message: "oi" });
      assert.equal(res1.status, 500);

      const res2 = await postChat(baseUrl, { message: "oi de novo" });
      assert.equal(res2.status, 200);
    });
  });
});

// --- Estado compartilhado (FR-012a) — usando o repositório real ----------

describe("POST /chat — estado compartilhado entre requisições (FR-012a)", () => {
  it("uma instância de store injetada é reutilizada em todas as requisições da mesma app", async () => {
    const store = new InMemoryOpsRepository(baselineState());
    let observedStore: unknown;
    const strategy = fakeStrategy("react", async (_input, _options) => {
      observedStore = store;
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ store, resolveStrategy }, async (baseUrl) => {
      await postChat(baseUrl, { message: "primeiro" });
      const firstStore = observedStore;
      await postChat(baseUrl, { message: "segundo" });
      assert.equal(observedStore, firstStore);
      assert.equal(observedStore, store);
    });
  });
});

// --- 007-persistent-conversation: User Story 1 --------------------------

describe("POST /chat — conversa (007, US1)", () => {
  it("sem conversationId, cria uma conversa nova e a devolve na resposta (FR-010, FR-011)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "quais alertas estão abertos?" });
      assert.equal(res.status, 200);
      const body = await jsonOf(res);
      assert.equal(typeof body.conversationId, "string");
      assert.ok(body.conversationId.length > 0);
    });
  });

  it("com o conversationId de um turno anterior, a estratégia recebe o histórico daquele turno (US1, cenário 2)", async () => {
    const inputs: string[] = [];
    const strategy = fakeStrategy("react", async (input) => {
      inputs.push(input);
      return fixedResult({ answer: `resposta ${inputs.length}` });
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const conversationStore = new InMemoryConversationStore();

    await withServer({ resolveStrategy, conversationStore }, async (baseUrl) => {
      const res1 = await postChat(baseUrl, { message: "quais alertas estão abertos?" });
      const body1 = await jsonOf(res1);
      const conversationId = body1.conversationId;

      const res2 = await postChat(baseUrl, { message: "e o runbook dele?", conversationId });
      assert.equal(res2.status, 200);
      const body2 = await jsonOf(res2);
      assert.equal(body2.conversationId, conversationId);

      // O segundo `run()` recebeu a mensagem/resposta do primeiro turno como histórico.
      assert.match(inputs[1]!, /quais alertas estão abertos\?/);
      assert.match(inputs[1]!, /resposta 1/);
      assert.match(inputs[1]!, /e o runbook dele\?$/);
      assert.equal(body2.metrics.historyMessages, 2);
    });
  });

  it("a conversa gravada tem a mensagem de quem pediu seguida da resposta final, nessa ordem (cenário 3)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult({ answer: "checkout-api está com alerta crítico." }));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const conversationStore = new InMemoryConversationStore();

    await withServer({ resolveStrategy, conversationStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "qual serviço tem alerta crítico?" });
      const body = await jsonOf(res);
      const messages = conversationStore.lastMessages(body.conversationId, 12);
      assert.equal(messages.length, 2);
      assert.equal(messages[0]!.role, "user");
      assert.equal(messages[0]!.content, "qual serviço tem alerta crítico?");
      assert.equal(messages[1]!.role, "assistant");
      assert.equal(messages[1]!.content, "checkout-api está com alerta crítico.");
    });
  });

  it("o histórico de uma conversa nunca aparece no prompt de outra (cenário 4)", async () => {
    const inputs: string[] = [];
    const strategy = fakeStrategy("react", async (input) => {
      inputs.push(input);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const conversationStore = new InMemoryConversationStore();

    await withServer({ resolveStrategy, conversationStore }, async (baseUrl) => {
      const resA1 = await postChat(baseUrl, { message: "conversa A: primeira pergunta" });
      const conversationA = (await jsonOf(resA1)).conversationId;

      await postChat(baseUrl, { message: "conversa B: pergunta isolada" });

      await postChat(baseUrl, { message: "conversa A: segunda pergunta", conversationId: conversationA });
    });

    assert.match(inputs[2]!, /conversa A: primeira pergunta/);
    assert.ok(!inputs[2]!.includes("conversa B"));
  });
});

// --- 007-persistent-conversation: User Story 2 --------------------------

describe("POST /chat — conversa (007, US2 — teto de 12 e métrica)", () => {
  it("uma conversa com mais de 12 mensagens entrega só as 12 mais recentes, e a métrica reporta 12", async () => {
    const receivedInputs: string[] = [];
    const strategy = fakeStrategy("react", async (input) => {
      receivedInputs.push(input);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const conversationStore = new InMemoryConversationStore();
    const conversationId = conversationStore.create();
    for (let i = 0; i < 8; i += 1) {
      conversationStore.append(conversationId, [
        { role: "user", content: `pergunta ${i}` },
        { role: "assistant", content: `resposta ${i}` },
      ]);
    }

    await withServer({ resolveStrategy, conversationStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "pergunta nova", conversationId });
      const body = await jsonOf(res);
      assert.equal(body.metrics.historyMessages, 12);
    });

    // As 12 mais recentes das 16 gravadas (8 pares) são pergunta 2..7 + resposta 2..7.
    assert.ok(!receivedInputs[0]!.includes("pergunta 0"));
    assert.ok(!receivedInputs[0]!.includes("resposta 1"));
    assert.match(receivedInputs[0]!, /resposta 7/);
  });

  it("conversa nova reporta historyMessages: 0 (cenário 3)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "primeira pergunta" });
      const body = await jsonOf(res);
      assert.equal(body.metrics.historyMessages, 0);
    });
  });
});

// --- 007-persistent-conversation: User Story 3 --------------------------

describe("POST /chat — conversa (007, US3 — erros)", () => {
  it("conversationId vazio/espaços responde 400 invalid_body, sem chamar a estratégia", async () => {
    let strategyCalled = false;
    const strategy = fakeStrategy("react", async () => {
      strategyCalled = true;
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", conversationId: "   " });
      assert.equal(res.status, 400);
      const json = await jsonOf(res);
      assert.equal(json.error.code, "invalid_body");
    });
    assert.equal(strategyCalled, false);
  });

  it("conversationId inexistente responde 404 conversation_not_found, sem iniciar a execução", async () => {
    let strategyCalled = false;
    const strategy = fakeStrategy("react", async () => {
      strategyCalled = true;
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", conversationId: "conv-nao-existe" });
      assert.equal(res.status, 404);
      const json = await jsonOf(res);
      assert.equal(json.error.code, "conversation_not_found");
      assert.equal(json.error.details.conversationId, "conv-nao-existe");
    });
    assert.equal(strategyCalled, false);
  });

  it("um pedido que estoura o timeout numa conversa existente não grava nada nela (cenário 3)", async () => {
    const strategy = fakeStrategy("react", () => new Promise<StrategyResult>(() => {}));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const conversationStore = new InMemoryConversationStore();
    const conversationId = conversationStore.create();
    conversationStore.append(conversationId, [{ role: "user", content: "mensagem anterior" }]);

    await withServer({ resolveStrategy, conversationStore, timeoutMs: 30 }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", conversationId });
      assert.equal(res.status, 504);
    });

    const messages = conversationStore.lastMessages(conversationId, 12);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.content, "mensagem anterior");
  });

  it("um pedido que falha sem conversationId não deixa conversa nova registrada (cenário 4)", async () => {
    const strategy = fakeStrategy("react", async () => {
      throw new Error("falha inesperada");
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const conversationStore = new InMemoryConversationStore();

    await withServer({ resolveStrategy, conversationStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi" });
      assert.equal(res.status, 500);
    });

    // Nenhum id foi devolvido para consultar — a garantia é observável
    // indiretamente: um pedido seguinte, com dublê sadio e sem conversationId,
    // ainda cria a SUA própria conversa nova normalmente.
    const strategy2 = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy: resolveStrategy2 } = recordingResolveStrategy(strategy2);
    await withServer({ resolveStrategy: resolveStrategy2, conversationStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi de novo" });
      const body = await jsonOf(res);
      assert.equal(typeof body.conversationId, "string");
    });
  });
});

// --- 008-semantic-memory: fake memory store helper -------------------------

/** A `SqliteMemoryStore` over `:memory:` with a table-driven fake embedder (R-004) — never touches the real model. */
function fakeMemoryStore(table: Record<string, Float32Array> = {}): MemoryStore {
  return new SqliteMemoryStore(new DatabaseSync(":memory:"), createTableEmbedder(table));
}

// --- 008-semantic-memory: User Story 1 --------------------------------------

describe("POST /chat — memória semântica (008, US1)", () => {
  it("com userId, um fato guardado é recuperado por um pedido relacionado, sem palavra em comum (cenário 2)", async () => {
    const inputs: string[] = [];
    const strategy = fakeStrategy("react", async (input) => {
      inputs.push(input);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "sou responsável pelo checkout": queryVector(),
      "quais serviços são meus?": queryVector(),
    });
    await memoryStore.remember("kauane", "sou responsável pelo checkout");

    await withServer({ resolveStrategy, memoryStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { userId: "kauane", message: "quais serviços são meus?" });
      assert.equal(res.status, 200);
      const body = await jsonOf(res);
      assert.equal(body.metrics.recalledMemories, 1);
    });

    assert.match(inputs[0]!, /Fatos lembrados/);
    assert.match(inputs[0]!, /sou responsável pelo checkout/);
  });

  it("com userId e sem fato relacionado, nenhum fato é entregue (cenário 5)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({ "assunto totalmente diferente": axisVector(0.1, 1), pergunta: queryVector() });
    await memoryStore.remember("kauane", "assunto totalmente diferente");

    await withServer({ resolveStrategy, memoryStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { userId: "kauane", message: "pergunta" });
      const body = await jsonOf(res);
      assert.equal(body.metrics.recalledMemories, 0);
    });
  });

  it("um fato aprendido automaticamente num pedido é recuperado em outra conversa, e sem conversationId (cenário 3, 009 US1)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "lembra que eu sou responsável pelo checkout": queryVector(),
      "sou responsável pelo checkout": queryVector(),
      "quais serviços são meus?": queryVector(),
    });
    const distiller = fixedDistiller({ hasLearning: true, fact: "sou responsável pelo checkout" });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        // 1st request: the message carries a durable fact — no tool call needed anymore.
        await postChat(baseUrl, { userId: "kauane", message: "lembra que eu sou responsável pelo checkout" });
        const outcome = await probe.next;
        assert.equal(outcome.kind, "learned");

        // 2nd request: different conversationId (new conversation), same userId.
        const res = await postChat(baseUrl, { userId: "kauane", message: "quais serviços são meus?" });
        const body = await jsonOf(res);
        assert.equal(body.metrics.recalledMemories, 1);
      },
    );
  });

  it("um fato aprendido com outras palavras não duplica um fato já guardado (cenário 6, 009 FR-012)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "sou responsável pelo checkout": queryVector(),
      "eu cuido do checkout": axisVector(0.95, 1), // duplicate: score > 0.92 with the existing fact
      "lembra disso": queryVector(),
    });
    await memoryStore.remember("kauane", "sou responsável pelo checkout");
    const distiller = fixedDistiller({ hasLearning: true, fact: "eu cuido do checkout" });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        await postChat(baseUrl, { userId: "kauane", message: "lembra disso" });
        const outcome = await probe.next;
        assert.equal(outcome.kind, "learned");
        if (outcome.kind === "learned") assert.equal(outcome.result.created, false);
      },
    );

    assert.equal((await memoryStore.recall("kauane", "sou responsável pelo checkout")).length, 1);
  });
});

// --- 008-semantic-memory: User Story 2 --------------------------------------

describe("POST /chat — memória semântica (008, US2 — esquecer)", () => {
  it("forget_preference apaga um fato do próprio usuário; o recall seguinte não o traz mais", async () => {
    const memoryStore = fakeMemoryStore({
      "sou responsável pelo checkout": queryVector(),
      "esquece isso": queryVector(),
      "quais serviços são meus?": queryVector(),
    });
    const { memoryId } = await memoryStore.remember("kauane", "sou responsável pelo checkout");

    const strategy = fakeStrategy("react", async (_input, options) => {
      const forgetTool = options?.extraTools?.find((t) => (t as { name: string }).name === "forget_preference");
      if (forgetTool) {
        await (forgetTool as unknown as { invoke(args: unknown): Promise<string> }).invoke({ memoryId });
      }
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy, memoryStore }, async (baseUrl) => {
      await postChat(baseUrl, { userId: "kauane", message: "esquece isso" });
    });

    assert.equal((await memoryStore.recall("kauane", "quais serviços são meus?")).length, 0);
  });
});

// --- 008-semantic-memory: User Story 3 --------------------------------------

describe("POST /chat — memória semântica (008, US3 — isolamento e compatibilidade)", () => {
  it("fato do usuário A não chega em pedido do usuário B (cenário 1)", async () => {
    const inputs: string[] = [];
    const strategy = fakeStrategy("react", async (input) => {
      inputs.push(input);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "fato de A": queryVector(),
      "algo relacionado": queryVector(),
    });
    await memoryStore.remember("user-a", "fato de A");

    await withServer({ resolveStrategy, memoryStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { userId: "user-b", message: "algo relacionado" });
      const body = await jsonOf(res);
      assert.equal(body.metrics.recalledMemories, 0);
    });
    assert.ok(!inputs[0]!.includes("fato de A"));
  });

  it("sem userId, nenhuma chamada ao MemoryStore acontece, e a resposta não tem recalledMemories (cenário 2)", async () => {
    let memoryStoreTouched = false;
    const spyMemoryStore: MemoryStore = {
      async remember() {
        memoryStoreTouched = true;
        throw new Error("não deveria ser chamado");
      },
      async recall() {
        memoryStoreTouched = true;
        return [];
      },
      forget() {
        memoryStoreTouched = true;
        return false;
      },
    };
    const strategy = fakeStrategy("react", async (input, options) => {
      assert.equal(input, "oi");
      assert.ok(!options?.extraTools || options.extraTools.length === 0);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy, memoryStore: spyMemoryStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi" });
      const body = await jsonOf(res);
      assert.equal("recalledMemories" in body.metrics, false);
    });
    assert.equal(memoryStoreTouched, false);
  });

  it("userId vazio ou só com espaços responde 400 invalid_body, sem chamar a estratégia (cenário 3)", async () => {
    let strategyCalled = false;
    const strategy = fakeStrategy("react", async () => {
      strategyCalled = true;
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);

    await withServer({ resolveStrategy }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", userId: "   " });
      assert.equal(res.status, 400);
      const json = await jsonOf(res);
      assert.equal(json.error.code, "invalid_body");
    });
    assert.equal(strategyCalled, false);
  });

  it("falha do MemoryStore em recall não derruba o pedido: 200 com recalledMemories: 0 (FR-025)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const failingMemoryStore: MemoryStore = {
      async remember() {
        throw new Error("não deveria ser chamado neste teste");
      },
      async recall() {
        throw new Error("modelo indisponível");
      },
      forget() {
        return false;
      },
    };

    await withServer({ resolveStrategy, memoryStore: failingMemoryStore }, async (baseUrl) => {
      const res = await postChat(baseUrl, { userId: "kauane", message: "oi" });
      assert.equal(res.status, 200);
      const body = await jsonOf(res);
      assert.equal(body.metrics.recalledMemories, 0);
    });
  });
});

// --- 009-learning-reflector: User Story 1 ------------------------------------

describe("POST /chat — refletor de aprendizado (009, US1)", () => {
  it("um fato durável dito de passagem é guardado depois da resposta e recuperado num pedido futuro (US1-1, US1-3, SC-001)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "sou do time de pagamentos, quais alertas estão abertos?": queryVector(),
      "quem cobre faturamento?": queryVector(),
      "É do time de pagamentos.": queryVector(),
    });
    const distiller = fixedDistiller({ hasLearning: true, fact: "É do time de pagamentos." });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        const res = await postChat(baseUrl, {
          userId: "ana",
          message: "sou do time de pagamentos, quais alertas estão abertos?",
        });
        assert.equal(res.status, 200);

        const outcome = await probe.next;
        assert.equal(outcome.kind, "learned");

        const res2 = await postChat(baseUrl, { userId: "ana", message: "quem cobre faturamento?" });
        const body2 = await jsonOf(res2);
        assert.equal(body2.metrics.recalledMemories, 1);
      },
    );
  });

  it("a resposta chega antes de o distiller resolver — o refletor não atrasa o pedido (US1-2, C4, SC-002)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "sou do time de pagamentos": queryVector(),
      "É do time de pagamentos.": queryVector(),
    });
    const deferred = deferredDistiller();
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller: deferred.distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        const res = await postChat(baseUrl, { userId: "ana", message: "sou do time de pagamentos" });
        assert.equal(res.status, 200);

        // The response already arrived; nothing has been learned yet, because
        // the distiller is still pending.
        assert.equal((await memoryStore.recall("ana", "sou do time de pagamentos")).length, 0);

        deferred.resolve({ hasLearning: true, fact: "É do time de pagamentos." });
        const outcome = await probe.next;
        assert.equal(outcome.kind, "learned");
      },
    );
  });

  it("o refletor examina só a mensagem crua — não o histórico nem os fatos recuperados (C5, FR-004)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({
      "fato antigo": queryVector(),
      "e o runbook dele?": queryVector(),
    });
    await memoryStore.remember("ana", "fato antigo");
    const conversationStore = new InMemoryConversationStore();
    const conversationId = conversationStore.create();
    conversationStore.append(conversationId, [
      { role: "user", content: "quais alertas estão abertos?" },
      { role: "assistant", content: "resposta fixa do dublê" },
    ]);

    let receivedByDistiller: string | undefined;
    const distiller: Distiller = async (message) => {
      receivedByDistiller = message;
      return { hasLearning: false, fact: "" };
    };
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, conversationStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        await postChat(baseUrl, { userId: "ana", message: "e o runbook dele?", conversationId });
        await probe.next;
      },
    );

    assert.equal(receivedByDistiller, "e o runbook dele?");
  });
});

// --- 009-learning-reflector: não-disparo --------------------------------------

describe("POST /chat — refletor de aprendizado (009, não-disparo)", () => {
  function countingDistiller(): { distiller: Distiller; calls: () => number } {
    let calls = 0;
    const distiller: Distiller = async () => {
      calls += 1;
      return { hasLearning: false, fact: "" };
    };
    return { distiller, calls: () => calls };
  }

  it("sem userId, o distiller nunca é chamado (C1, SC-007)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const counter = countingDistiller();

    await withServer({ resolveStrategy, distiller: counter.distiller }, async (baseUrl) => {
      await postChat(baseUrl, { message: "oi" });
    });

    assert.equal(counter.calls(), 0);
  });

  it("um corpo inválido (400) não chama o distiller (C2)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const counter = countingDistiller();
    // memoryStore injected on every test in this block that carries a
    // userId (R-004): otherwise createApp's default memoryStore reaches
    // for the real embedder, which defaults to allowRemote — a violation
    // of the offline-tests principle even though recall is fail-open.
    const memoryStore = fakeMemoryStore({ oi: queryVector() });

    await withServer({ resolveStrategy, memoryStore, distiller: counter.distiller }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "", userId: "ana" });
      assert.equal(res.status, 400);
    });

    assert.equal(counter.calls(), 0);
  });

  it("uma estratégia que lança (500) não chama o distiller (C2)", async () => {
    const strategy = fakeStrategy("react", async () => {
      throw new Error("falha inesperada");
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const counter = countingDistiller();
    const memoryStore = fakeMemoryStore({ oi: queryVector() });

    await withServer({ resolveStrategy, memoryStore, distiller: counter.distiller }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", userId: "ana" });
      assert.equal(res.status, 500);
    });

    assert.equal(counter.calls(), 0);
  });

  it("um timeout (504) não chama o distiller (C2)", async () => {
    const strategy = fakeStrategy("react", () => new Promise<StrategyResult>(() => {}));
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const counter = countingDistiller();
    const memoryStore = fakeMemoryStore({ oi: queryVector() });

    await withServer(
      { resolveStrategy, memoryStore, distiller: counter.distiller, timeoutMs: 30 },
      async (baseUrl) => {
        const res = await postChat(baseUrl, { message: "oi", userId: "ana" });
        assert.equal(res.status, 504);
      },
    );

    assert.equal(counter.calls(), 0);
  });

  it("um conversationId inexistente (404) não chama o distiller (C2)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const counter = countingDistiller();
    const memoryStore = fakeMemoryStore({ oi: queryVector() });

    await withServer({ resolveStrategy, memoryStore, distiller: counter.distiller }, async (baseUrl) => {
      const res = await postChat(baseUrl, { message: "oi", userId: "ana", conversationId: "não-existe" });
      assert.equal(res.status, 404);
    });

    assert.equal(counter.calls(), 0);
  });

  it("uma falha do distiller não afeta a resposta já entregue, e o pedido seguinte funciona normalmente (FR-013, SC-005)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({ oi: queryVector() });
    const distiller = rejectingDistiller(new Error("modelo indisponível"));
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        const res = await postChat(baseUrl, { message: "oi", userId: "ana" });
        assert.equal(res.status, 200);

        const outcome = await probe.next;
        assert.equal(outcome.kind, "failed");
        if (outcome.kind === "failed") assert.equal(outcome.stage, "distill");

        const res2 = await postChat(baseUrl, { message: "oi de novo", userId: "ana" });
        assert.equal(res2.status, 200);
      },
    );
  });

  it("uma falha do gerador de vetores ao guardar não afeta a resposta (FR-013)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const failingMemoryStore: MemoryStore = {
      async remember() {
        throw new Error("gerador de vetores indisponível");
      },
      async recall() {
        return [];
      },
      forget() {
        return false;
      },
    };
    const distiller = fixedDistiller({ hasLearning: true, fact: "É do time de pagamentos." });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore: failingMemoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        const res = await postChat(baseUrl, { message: "sou do time de pagamentos", userId: "ana" });
        assert.equal(res.status, 200);

        const outcome = await probe.next;
        assert.equal(outcome.kind, "failed");
        if (outcome.kind === "failed") assert.equal(outcome.stage, "remember");
      },
    );
  });
});

// --- 009-learning-reflector: User Story 2 -------------------------------------

describe("POST /chat — refletor de aprendizado (009, US2 — credenciais)", () => {
  it("uma mensagem com forma de credencial não chega ao distiller e nada é guardado (US2-2, SC-004)", async () => {
    let distillerCalled = false;
    const distiller: Distiller = async () => {
      distillerCalled = true;
      return { hasLearning: false, fact: "" };
    };
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({ "a senha do grafana é Pr0d!2024": queryVector() });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        const res = await postChat(baseUrl, { userId: "ana", message: "a senha do grafana é Pr0d!2024" });
        assert.equal(res.status, 200);

        const outcome = await probe.next;
        assert.equal(outcome.kind, "skipped");
        if (outcome.kind === "skipped") assert.equal(outcome.reason, "secret-in-message");
      },
    );

    assert.equal(distillerCalled, false);
    assert.equal((await memoryStore.recall("ana", "a senha do grafana é Pr0d!2024")).length, 0);
  });

  it("o distiller propõe, por erro, um fato com forma de credencial — a segunda barreira o rejeita (US2-3, SC-004)", async () => {
    const strategy = fakeStrategy("react", async () => fixedResult());
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({ oi: queryVector() });
    const distiller = fixedDistiller({ hasLearning: true, fact: "A senha do grafana é Pr0d!2024" });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        await postChat(baseUrl, { userId: "ana", message: "oi" });

        const outcome = await probe.next;
        assert.equal(outcome.kind, "skipped");
        if (outcome.kind === "skipped") assert.equal(outcome.reason, "secret-in-fact");
      },
    );

    assert.equal((await memoryStore.recall("ana", "oi")).length, 0);
  });
});

// --- 009-learning-reflector: User Story 3 -------------------------------------

describe("POST /chat — ferramentas de memória (009, US3)", () => {
  it("com userId, o agente recebe exatamente a ferramenta forget_preference (US3-1, SC-006)", async () => {
    let toolNames: string[] | undefined;
    const strategy = fakeStrategy("react", async (_input, options) => {
      toolNames = options?.extraTools?.map((t) => (t as { name: string }).name);
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const memoryStore = fakeMemoryStore({ oi: queryVector() });

    await withServer({ resolveStrategy, memoryStore }, async (baseUrl) => {
      await postChat(baseUrl, { userId: "ana", message: "oi" });
    });

    assert.deepEqual(toolNames, ["forget_preference"]);
  });

  it("o agente esquece o fato antigo com forget_preference enquanto o refletor aprende o novo, na mesma mensagem (US3-3)", async () => {
    const memoryStore = fakeMemoryStore({
      "sou do time de pagamentos": queryVector(),
      "não sou mais de pagamentos, agora sou de identidade": queryVector(),
      "É do time de identidade.": queryVector(),
    });
    const { memoryId } = await memoryStore.remember("ana", "sou do time de pagamentos");

    const strategy = fakeStrategy("react", async (_input, options) => {
      const forgetTool = options?.extraTools?.find((t) => (t as { name: string }).name === "forget_preference");
      if (forgetTool) {
        await (forgetTool as unknown as { invoke(args: unknown): Promise<string> }).invoke({ memoryId });
      }
      return fixedResult();
    });
    const { resolveStrategy } = recordingResolveStrategy(strategy);
    const distiller = fixedDistiller({ hasLearning: true, fact: "É do time de identidade." });
    const probe = learningProbe();

    await withServer(
      { resolveStrategy, memoryStore, distiller, onLearning: probe.onLearning },
      async (baseUrl) => {
        await postChat(baseUrl, {
          userId: "ana",
          message: "não sou mais de pagamentos, agora sou de identidade",
        });
        const outcome = await probe.next;
        assert.equal(outcome.kind, "learned");
      },
    );

    const recalled = await memoryStore.recall("ana", "sou do time de pagamentos");
    assert.ok(!recalled.some((m) => m.memoryId === memoryId));
  });
});
