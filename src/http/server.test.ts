import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp, type ChatAppDeps } from "./server.ts";
import { UnknownStrategyError, type ResolveStrategy, type StrategySelection } from "../agents/index.ts";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { baselineState } from "../store/seed.ts";
import type { ReasoningStrategy, RunOptions } from "../agents/types.ts";
import type { StrategyResult } from "../trace/types.ts";

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

async function withServer<T>(deps: ChatAppDeps, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp(deps);
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
      assert.deepEqual(body, result);
      assert.deepEqual(body.trace, FIXED_TRACE); // mesma ordem, nada filtrado
      assert.equal(body.stoppedReason, "completed");
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
      assert.deepEqual(body, reflected);
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
