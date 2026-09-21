import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SqliteMemoryStore, type MemoryStore } from "./memory-store.ts";
import { createTableEmbedder, queryVector } from "./table-embedder.ts";
import { createLearningReflector, LEARNING_TIMEOUT_MS } from "./learning-reflector.ts";
import type { Distiller } from "./distiller.ts";
import type { LearningDecision } from "../domain/schemas.ts";

function freshStore(table: Record<string, Float32Array> = {}): MemoryStore {
  return new SqliteMemoryStore(new DatabaseSync(":memory:"), createTableEmbedder(table));
}

function fixedDistiller(decision: LearningDecision): Distiller {
  return async () => decision;
}

describe("createLearningReflector — fluxo feliz", () => {
  it("um fato válido é guardado para o userId, com trim aplicado (L3, L4)", async () => {
    // `remember` embeds the TRIMMED fact (L3) — the table only plans the
    // trimmed key, so a lookup with the untrimmed value would throw.
    const memoryStore = freshStore({ "É do time de pagamentos.": queryVector() });
    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "  É do time de pagamentos.  " }),
    });

    const outcome = await reflect("ana", "sou do time de pagamentos");
    assert.equal(outcome.kind, "learned");
    if (outcome.kind !== "learned") return;
    assert.equal(outcome.result.created, true);
    assert.equal(outcome.result.fact, "É do time de pagamentos.");

    const recalled = await memoryStore.recall("ana", "É do time de pagamentos.");
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0]!.fact, "É do time de pagamentos.");
  });

  it("uma paráfrase de um fato já guardado não duplica (created: false)", async () => {
    const memoryStore = freshStore({
      "É do time de pagamentos.": queryVector(),
    });
    await memoryStore.remember("ana", "É do time de pagamentos.");

    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "É do time de pagamentos." }),
    });

    const outcome = await reflect("ana", "trabalho com pagamentos");
    assert.equal(outcome.kind, "learned");
    if (outcome.kind !== "learned") return;
    assert.equal(outcome.result.created, false);
  });
});

describe("createLearningReflector — nada a aprender", () => {
  it("hasLearning: false não grava nada", async () => {
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: false, fact: "" }),
    });

    const outcome = await reflect("ana", "quais alertas estão abertos?");
    assert.deepEqual(outcome, { kind: "skipped", userId: "ana", reason: "no-learning" });
  });

  it("hasLearning: true com fato vazio é 'skipped/invalid-fact', não uma falha (FR-014, L6)", async () => {
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "" }),
    });

    const outcome = await reflect("ana", "oi");
    assert.deepEqual(outcome, { kind: "skipped", userId: "ana", reason: "invalid-fact" });
  });

  it("hasLearning: true com fato só de espaços é 'skipped/invalid-fact'", async () => {
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "   " }),
    });

    const outcome = await reflect("ana", "oi");
    assert.equal(outcome.kind, "skipped");
    if (outcome.kind === "skipped") assert.equal(outcome.reason, "invalid-fact");
  });

  it("hasLearning: true com fato de 501 caracteres é 'skipped/invalid-fact'", async () => {
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "a".repeat(501) }),
    });

    const outcome = await reflect("ana", "oi");
    assert.equal(outcome.kind, "skipped");
    if (outcome.kind === "skipped") assert.equal(outcome.reason, "invalid-fact");
  });
});

describe("createLearningReflector — guarda de credenciais (US2)", () => {
  it("mensagem com forma de credencial é barrada antes do distiller (secret-in-message)", async () => {
    const memoryStore = freshStore();
    let distillerCalled = false;
    const distiller: Distiller = async () => {
      distillerCalled = true;
      return { hasLearning: false, fact: "" };
    };
    const reflect = createLearningReflector({ memoryStore, distiller });

    const outcome = await reflect("ana", "a senha do grafana é Pr0d!2024");
    assert.deepEqual(outcome, { kind: "skipped", userId: "ana", reason: "secret-in-message" });
    assert.equal(distillerCalled, false);
  });

  it("um fato proposto com forma de credencial é barrado antes de guardar (secret-in-fact)", async () => {
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "A senha do grafana é Pr0d!2024" }),
    });

    const outcome = await reflect("ana", "oi");
    assert.deepEqual(outcome, { kind: "skipped", userId: "ana", reason: "secret-in-fact" });
  });
});

describe("createLearningReflector — falhas (L1, L5)", () => {
  it("distiller que rejeita produz 'failed/distill', sem lançar (L1)", async () => {
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: async () => {
        throw new Error("modelo indisponível");
      },
    });

    const outcome = await reflect("ana", "oi");
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") assert.equal(outcome.stage, "distill");
  });

  it("distiller que nunca resolve produz 'failed/distill' quando o prazo esgota, e recebe um signal abortado (L5)", async () => {
    let observedSignal: AbortSignal | undefined;
    // Settled after the assertions (not left dangling forever) so the test
    // runner doesn't flag a still-pending promise once this test ends —
    // the reflector itself must still not wait for it (that's the point).
    let releaseHang: (() => void) | undefined;
    const memoryStore = freshStore();
    const reflect = createLearningReflector({
      memoryStore,
      distiller: (_message, signal) => {
        observedSignal = signal;
        return new Promise((_resolve, reject) => {
          releaseHang = () => reject(new Error("test cleanup: releasing hung distiller"));
        });
      },
      timeoutMs: 20,
    });

    const outcome = await reflect("ana", "oi");
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") assert.equal(outcome.stage, "distill");
    assert.equal(observedSignal?.aborted, true);

    releaseHang?.();
  });

  it("memoryStore.remember que rejeita produz 'failed/remember' (L1)", async () => {
    const failingStore: MemoryStore = {
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
    const reflect = createLearningReflector({
      memoryStore: failingStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "É do time de pagamentos." }),
    });

    const outcome = await reflect("ana", "sou do time de pagamentos");
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") assert.equal(outcome.stage, "remember");
  });

  it("no máximo uma chamada a remember por exame (L2)", async () => {
    let rememberCalls = 0;
    const countingStore: MemoryStore = {
      async remember(_userId, fact) {
        rememberCalls += 1;
        return { memoryId: "mem-1", fact, created: true };
      },
      async recall() {
        return [];
      },
      forget() {
        return false;
      },
    };
    const reflect = createLearningReflector({
      memoryStore: countingStore,
      distiller: fixedDistiller({ hasLearning: true, fact: "É do time de pagamentos." }),
    });

    await reflect("ana", "sou do time de pagamentos");
    assert.equal(rememberCalls, 1);
  });
});

describe("createLearningReflector — o distiller recebe exatamente a mensagem (D1)", () => {
  it("passa a mensagem recebida, sem alteração", async () => {
    const memoryStore = freshStore();
    let received: string | undefined;
    const reflect = createLearningReflector({
      memoryStore,
      distiller: async (message) => {
        received = message;
        return { hasLearning: false, fact: "" };
      },
    });

    await reflect("ana", "quais alertas estão abertos?");
    assert.equal(received, "quais alertas estão abertos?");
  });
});

describe("LEARNING_TIMEOUT_MS", () => {
  it("é 30 segundos por padrão", () => {
    assert.equal(LEARNING_TIMEOUT_MS, 30_000);
  });
});
