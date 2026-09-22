import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createModelDistiller, DISTILLER_PROMPT } from "./distiller.ts";
import type { ModelSource, SourcedModel } from "../agents/model.ts";

describe("createModelDistiller (D3, D4)", () => {
  it("is constructible without OPENROUTER_* in the environment (Princípio V)", () => {
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    try {
      // Constructing must not throw — only INVOKING would need credentials,
      // and nothing here invokes it (resilient(...) is called lazily inside
      // the returned function, R-002).
      assert.doesNotThrow(() => createModelDistiller());
    } finally {
      if (previousModel !== undefined) process.env.OPENROUTER_MODEL = previousModel;
      if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    }
  });
});

describe("DISTILLER_PROMPT", () => {
  it("mentions all three forbidden categories", () => {
    assert.match(DISTILLER_PROMPT, /Pedido pontual/);
    assert.match(DISTILLER_PROMPT, /Estado da operação/);
    assert.match(DISTILLER_PROMPT, /Segredo/);
  });

  it("treats the message as data, never as an instruction to itself", () => {
    assert.match(DISTILLER_PROMPT, /DADO/);
    assert.match(DISTILLER_PROMPT, /nunca instrução/);
  });
});

// --- 013-model-resilience (US1): createModelDistiller survives a primary failure ---

describe("createModelDistiller — 013-model-resilience (US1)", () => {
  it("decides from the backup when the primary fails with a non-transient error", async () => {
    class FailingModel extends FakeListChatModel {
      override async _generate(): Promise<never> {
        const e = new Error("modelo inexistente") as Error & { status: number };
        e.status = 404;
        throw e;
      }
    }
    const primary = new FailingModel({ responses: ["never used"] });
    const backup = new FakeListChatModel({ responses: ['{"hasLearning": false, "fact": ""}'] });
    const source: ModelSource = {
      primary: () => ({ id: "primary-model", model: primary }) as SourcedModel,
      backup: () => ({ id: "backup-model", model: backup }) as SourcedModel,
    };
    const distiller = createModelDistiller(source);

    const decision = await distiller("abre um incidente no checkout", new AbortController().signal);

    assert.deepEqual(decision, { hasLearning: false, fact: "" });
  });
});
