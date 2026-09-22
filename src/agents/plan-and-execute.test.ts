import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createPlanAndExecuteStrategy } from "./plan-and-execute.ts";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { baselineState } from "../store/seed.ts";
import type { ModelSource, SourcedModel } from "./model.ts";

// --- Test doubles (013-model-resilience) ------------------------------------

/**
 * A chat model that always throws the given error from `_generate`.
 * `bindTools` is overridden to return `this` — see react.test.ts for why
 * (`FakeListChatModel.bindTools` silently drops subclass overrides).
 * `withStructuredOutput` doesn't need the same treatment: it's implemented
 * in terms of `this.invoke(...)`, which still reaches this subclass's
 * `_generate`.
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

function fakeSource({ primary, backup }: { primary: BaseChatModel; backup: BaseChatModel }): ModelSource {
  const primarySourced: SourcedModel = { id: "primary-model", model: primary };
  const backupSourced: SourcedModel = { id: "backup-model", model: backup };
  return { primary: () => primarySourced, backup: () => backupSourced };
}

describe("createPlanAndExecuteStrategy — 013-model-resilience (US1)", () => {
  it("answers from the backup when the primary fails with a non-transient error, planner and executor alike", async () => {
    const store = new InMemoryOpsRepository(baselineState());
    // Both the planner's structured output (JSON) and the executor's react
    // step (plain text) go through the SAME primary/backup pair — the
    // backup has to answer both shapes. `withStructuredOutput`'s default
    // fake implementation (`FakeListChatModel`) parses the response text as
    // JSON, so the backup cycles between a plan and a plain answer.
    const primary = new FailingModel(notFoundError());
    const backup = new FakeListChatModel({ responses: ['{"steps": ["listar alertas"]}', "passo concluído"] });
    const strategy = createPlanAndExecuteStrategy(store, {
      disableReplanner: true,
      source: fakeSource({ primary, backup }),
    });

    const result = await strategy.run("quais alertas estão abertos?");

    assert.equal(result.stoppedReason, "completed");
    assert.equal(result.answer, "passo concluído");
  });
});
