import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkProviderStatus, formatProviderStatus } from "./provider-status.ts";

/**
 * Zero network (FR-035): every scenario below, including the failure ones,
 * uses a fake `fetch`. None of these tests wait 5 real seconds (FR-038) —
 * the timeout fake rejects immediately with the same `name` a real
 * `AbortSignal.timeout` produces (research.md R-002, R-011).
 */

const validBody = (indicator = "none", description = "All Systems Operational") =>
  JSON.stringify({
    page: { id: "kctbh9vrtdwd", name: "GitHub" },
    status: { indicator, description },
    components: [{ id: "a" }, { id: "b" }],
  });

function timeoutError(): never {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

describe("checkProviderStatus — sucesso (US1)", () => {
  it("devolve indicador e descrição a partir do corpo validado, descartando o resto (FR-023, FR-026)", async () => {
    const fetchImpl = async () => new Response(validBody());
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.deepEqual(result, {
      ok: true,
      provider: "github",
      indicator: "none",
      description: "All Systems Operational",
    });
    assert.ok(!("page" in result));
    assert.ok(!("components" in result));
  });

  it("usa a URL da tabela para cada provedor, nunca uma montada (FR-005, R-012)", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string | Request | URL) => {
      seen.push(String(url));
      return new Response(validBody());
    };
    await checkProviderStatus("github", { fetchImpl });
    await checkProviderStatus("cloudflare", { fetchImpl });
    assert.deepEqual(seen, [
      "https://www.githubstatus.com/api/v2/status.json",
      "https://www.cloudflarestatus.com/api/v2/status.json",
    ]);
  });

  it("os quatro indicadores traduzem para a linha formatada (FR-024)", () => {
    assert.equal(
      formatProviderStatus({ ok: true, provider: "github", indicator: "none", description: "All Systems Operational" }),
      "github: operacional — All Systems Operational",
    );
    assert.equal(
      formatProviderStatus({ ok: true, provider: "github", indicator: "minor", description: "x" }),
      "github: degradação parcial — x",
    );
    assert.equal(
      formatProviderStatus({ ok: true, provider: "github", indicator: "major", description: "x" }),
      "github: interrupção grave — x",
    );
    assert.equal(
      formatProviderStatus({ ok: true, provider: "github", indicator: "critical", description: "x" }),
      "github: interrupção crítica — x",
    );
  });
});

describe("checkProviderStatus — resiliência (US2)", () => {
  it("espera esgotada nas duas tentativas -> falha 'timeout', 2 tentativas (FR-009, FR-010, FR-038)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      timeoutError();
    };
    const result = await checkProviderStatus("cloudflare", { fetchImpl });
    assert.deepEqual(result, { ok: false, provider: "cloudflare", failure: "timeout", attempts: 2 });
    assert.equal(calls, 2);
  });

  it("nenhuma tentativa recebe um sinal já abortado (R-003) — protege contra o sinal compartilhado entre tentativas", async () => {
    const signalsSeen: AbortSignal[] = [];
    let calls = 0;
    const fetchImpl = async (_url: string | Request | URL, init?: RequestInit) => {
      calls++;
      if (init?.signal) signalsSeen.push(init.signal);
      // Falha de rede nas duas tentativas, para forçar as duas chamadas.
      throw new TypeError("fetch failed");
    };
    await checkProviderStatus("github", { fetchImpl });
    assert.equal(calls, 2);
    assert.equal(signalsSeen.length, 2);
    for (const signal of signalsSeen) {
      assert.equal(signal.aborted, false, "um sinal criado fora do laço chegaria aqui já abortado");
    }
  });

  it("falha de rede seguida de sucesso: resultado é o de sucesso, sem vestígio da falha (US2 cenário 2)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(validBody());
    };
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it("5xx seguido de sucesso: resultado é o de sucesso (US2 cenário 3)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) return new Response("boom", { status: 503 });
      return new Response(validBody());
    };
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it("5xx nas duas tentativas -> falha 'unavailable', 2 tentativas", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("boom", { status: 503 });
    };
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.deepEqual(result, { ok: false, provider: "github", failure: "unavailable", attempts: 2 });
    assert.equal(calls, 2);
  });

  it("4xx: falha 'unavailable' SEM retentativa — repetir dá o mesmo resultado (FR-011)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("nope", { status: 404 });
    };
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.deepEqual(result, { ok: false, provider: "github", failure: "unavailable", attempts: 1 });
    assert.equal(calls, 1);
  });

  it("linhas de falha começam por 'não foi possível confirmar o status' e nunca podem ser lidas como estado válido (FR-016 a FR-019)", () => {
    const line = formatProviderStatus({ ok: false, provider: "github", failure: "timeout", attempts: 2 });
    assert.match(line, /^github: não foi possível confirmar o status/);
    assert.doesNotMatch(line, /operacional|degradação|interrupção/);
    assert.doesNotMatch(line, / at | node_modules|\.ts:\d/);
  });
});

describe("checkProviderStatus — validação da resposta (US3)", () => {
  it("corpo não-JSON -> falha 'invalid-response', 1 tentativa, sem retentativa (FR-012)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("<html>oops</html>");
    };
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.deepEqual(result, { ok: false, provider: "github", failure: "invalid-response", attempts: 1 });
    assert.equal(calls, 1);
  });

  it("JSON válido mas 'status' ausente -> resposta inválida", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ page: {} }));
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "invalid-response");
  });

  it("JSON válido mas 'description' ausente -> resposta inválida", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ status: { indicator: "none" } }));
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "invalid-response");
  });

  it("indicador de tipo errado -> resposta inválida", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ status: { indicator: 1, description: "x" } }));
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "invalid-response");
  });

  it("indicador desconhecido -> resposta inválida, nunca repassado como estado (R-009, SC-007)", async () => {
    const fetchImpl = async () => new Response(validBody("catastrophic", "x"));
    const result = await checkProviderStatus("github", { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "invalid-response");
  });
});
