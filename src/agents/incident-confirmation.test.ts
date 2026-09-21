import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureIncidentConfirmation, withIncidentConfirmation } from "./incident-confirmation.ts";
import type { ReasoningStrategy } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";

const openIncidentObservation = (id: string): TraceEvent => ({
  type: "observation",
  tool: "open_incident",
  content: JSON.stringify({
    id,
    title: "Falha no pagamento",
    serviceId: "payments",
    severity: "critical",
    status: "open",
    openedAt: "2026-09-21T18:11:46.914Z",
    resolvedAt: null,
    summary: null,
  }),
});

describe("ensureIncidentConfirmation", () => {
  it("nenhum open_incident no rastro -> resposta do modelo inalterada", () => {
    const trace: TraceEvent[] = [{ type: "observation", tool: "list_alerts", content: "[]" }];
    assert.equal(ensureIncidentConfirmation(trace, "não há nada aberto"), "não há nada aberto");
  });

  it("open_incident com erro de domínio (sem id real) -> resposta do modelo inalterada", () => {
    const trace: TraceEvent[] = [
      { type: "observation", tool: "open_incident", content: JSON.stringify({ error: "Service not found: x" }) },
    ];
    assert.equal(ensureIncidentConfirmation(trace, "não encontrei o serviço"), "não encontrei o serviço");
  });

  it("resposta do modelo já cita o id real verbatim -> permanece como está (a favor da prosa do modelo)", () => {
    const trace = [openIncidentObservation("inc-real-123")];
    const answer = "Aberto! ID inc-real-123, tudo certo.";
    assert.equal(ensureIncidentConfirmation(trace, answer), answer);
  });

  it("resposta do modelo com id FABRICADO (não bate com o real) -> substituída pela confirmação determinística", () => {
    const trace = [openIncidentObservation("inc-real-123")];
    const answer = "Incidente aberto! ID: inc_0000000-fake";
    const result = ensureIncidentConfirmation(trace, answer);
    assert.notEqual(result, answer);
    assert.match(result, /^Incidente aberto com sucesso:/);
    assert.match(result, /- ID: inc-real-123/);
    assert.match(result, /- Título: Falha no pagamento/);
    assert.match(result, /- Serviço: payments/);
    assert.match(result, /- Severidade: critical/);
    assert.match(result, /- Status: open/);
    // O id fabricado nunca deve sobreviver na resposta final.
    assert.doesNotMatch(result, /fake/);
  });

  it("resposta do modelo sem NENHUM id -> substituída pela confirmação determinística", () => {
    const trace = [openIncidentObservation("inc-real-456")];
    const result = ensureIncidentConfirmation(trace, "Prontinho, incidente registrado com sucesso!");
    assert.match(result, /inc-real-456/);
  });

  it("dois incidentes abertos na mesma execução, resposta cita só um -> os DOIS aparecem na confirmação", () => {
    const trace = [openIncidentObservation("inc-aaa"), openIncidentObservation("inc-bbb")];
    const result = ensureIncidentConfirmation(trace, "abri o de id inc-aaa");
    assert.match(result, /inc-aaa/);
    assert.match(result, /inc-bbb/);
  });

  it("dois incidentes, resposta cita os dois ids reais -> permanece como está", () => {
    const trace = [openIncidentObservation("inc-aaa"), openIncidentObservation("inc-bbb")];
    const answer = "Abri dois: inc-aaa e inc-bbb.";
    assert.equal(ensureIncidentConfirmation(trace, answer), answer);
  });
});

describe("withIncidentConfirmation", () => {
  function fakeStrategy(result: StrategyResult): ReasoningStrategy {
    return { name: "fake", run: async () => result };
  }

  it("preserva metrics, stoppedReason e trace; só o campo answer pode mudar", async () => {
    const trace = [openIncidentObservation("inc-real-789")];
    const base = fakeStrategy({
      answer: "sem id nenhum aqui",
      trace,
      metrics: { llmCalls: 3, latencyMs: 42 },
      stoppedReason: "completed",
    });
    const wrapped = withIncidentConfirmation(base);
    const result = await wrapped.run("abra um incidente");

    assert.equal(wrapped.name, "fake");
    assert.deepEqual(result.trace, trace);
    assert.deepEqual(result.metrics, { llmCalls: 3, latencyMs: 42 });
    assert.equal(result.stoppedReason, "completed");
    assert.match(result.answer, /inc-real-789/);
  });
});
