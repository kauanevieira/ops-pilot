import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createReactStrategy } from "./react.ts";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { baselineState } from "../store/seed.ts";
import type { ModelSource, SourcedModel } from "./model.ts";

// --- Test doubles (013-model-resilience) ------------------------------------

/**
 * A chat model that always throws the given error from `_generate`.
 * `bindTools` is overridden to return `this`: `FakeListChatModel`'s own
 * `bindTools` (verified in the installed `@langchain/core`) builds a
 * brand-new plain `FakeListChatModel` internally, which would silently
 * drop this subclass's `_generate` override — exactly the kind of tool
 * binding `react.ts` always does before handing the model to `resilient`.
 */
class FailingModel extends FakeListChatModel {
  constructor(private failWith: Error) {
    super({ responses: ["never used"] });
  }
  override async _generate(): Promise<never> {
    throw this.failWith;
  }
  override bindTools() {
    return this;
  }
}

function notFoundError(): Error {
  const e = new Error("modelo inexistente") as Error & { status: number };
  e.status = 404;
  return e;
}

function fakeSource({ primary, backup }: { primary: BaseChatModel; backup?: BaseChatModel }): ModelSource {
  const primarySourced: SourcedModel = { id: "primary-model", model: primary };
  const backupSourced: SourcedModel | null = backup ? { id: "backup-model", model: backup } : null;
  return { primary: () => primarySourced, backup: () => backupSourced };
}

describe("createReactStrategy — 013-model-resilience (US1)", () => {
  it("answers from the backup when the primary fails with a non-transient error", async () => {
    const store = new InMemoryOpsRepository(baselineState());
    const primary = new FailingModel(notFoundError());
    const backup = new FakeListChatModel({ responses: ["resposta do reserva"] });
    const strategy = createReactStrategy(store, { source: fakeSource({ primary, backup }) });

    const result = await strategy.run("quais alertas estão abertos?");

    assert.equal(result.answer, "resposta do reserva");
    assert.equal(result.stoppedReason, "completed");
    assert.equal(result.metrics.llmCalls, 1);
  });
});

// --- 013-model-resilience (US2): metrics.modelUsed and the fallback trace event ---

describe("createReactStrategy — 013-model-resilience (US2)", () => {
  it("without a switch, modelUsed is the primary and no fallback event appears", async () => {
    const store = new InMemoryOpsRepository(baselineState());
    const primary = new FakeListChatModel({ responses: ["resposta direta"] });
    const strategy = createReactStrategy(store, { source: fakeSource({ primary }) });

    const result = await strategy.run("quais alertas estão abertos?");

    assert.equal(result.metrics.modelUsed, "primary-model");
    assert.ok(!result.trace.some((e) => e.type === "fallback"));
  });

  it("with a switch, modelUsed is the backup and trace[0] is the fallback event", async () => {
    const store = new InMemoryOpsRepository(baselineState());
    const primary = new FailingModel(notFoundError());
    const backup = new FakeListChatModel({ responses: ["resposta do reserva"] });
    const strategy = createReactStrategy(store, { source: fakeSource({ primary, backup }) });

    const result = await strategy.run("quais alertas estão abertos?");

    assert.equal(result.metrics.modelUsed, "backup-model");
    assert.deepEqual(result.trace[0], {
      type: "fallback",
      from: "primary-model",
      to: "backup-model",
      reason: "non_transient",
    });
  });
});
