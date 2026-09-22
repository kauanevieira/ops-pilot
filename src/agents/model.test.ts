import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  classifyModelError,
  envModelSource,
  createChatModel,
  resilient,
  runWithResilienceScope,
  ModelUnavailableError,
  MAX_PRIMARY_ATTEMPTS,
  MODEL_USED_EVENT,
  MODEL_FALLBACK_EVENT,
  type ModelSource,
  type SourcedModel,
} from "./model.ts";

// --- Test doubles (never in src/ outside *.test.ts) -----------------------

/** A chat model that always throws the given error from `_generate`. */
class FailingModel extends FakeListChatModel {
  attempts = 0;
  constructor(private failWith: Error) {
    super({ responses: ["never used"] });
  }
  override async _generate(): Promise<never> {
    this.attempts += 1;
    throw this.failWith;
  }
}

function okModel(text: string): BaseChatModel {
  return new FakeListChatModel({ responses: [text] });
}

function transientError(): Error {
  const e = new Error("limite de uso excedido") as Error & { status: number };
  e.status = 429;
  return e;
}

function serverError(): Error {
  const e = new Error("falha do provedor") as Error & { status: number };
  e.status = 503;
  return e;
}

function notFoundError(): Error {
  const e = new Error("modelo inexistente") as Error & { status: number };
  e.status = 404;
  return e;
}

function timeoutError(): Error {
  const e = new Error("tempo esgotado");
  e.name = "TimeoutError";
  return e;
}

function networkError(): Error {
  return new TypeError("fetch failed");
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

function fakeSource({ primary, backup }: { primary: FailingModel | BaseChatModel; backup?: BaseChatModel | null }): ModelSource {
  const primarySourced: SourcedModel = { id: "primary-model", model: primary as BaseChatModel };
  const backupSourced: SourcedModel | null = backup ? { id: "backup-model", model: backup } : null;
  return {
    primary: () => primarySourced,
    backup: () => backupSourced,
  };
}

class Collector extends BaseCallbackHandler {
  name = "collector";
  events: { name: string; data: unknown }[] = [];
  override handleCustomEvent(name: string, data: unknown): void {
    this.events.push({ name, data });
  }
}

// --- classifyModelError (MF10) --------------------------------------------

describe("classifyModelError", () => {
  it("classifies status 429 as rate_limit", () => {
    assert.equal(classifyModelError(transientError()), "rate_limit");
  });

  it("classifies status >= 500 as provider_error", () => {
    assert.equal(classifyModelError(serverError()), "provider_error");
  });

  it("classifies name TimeoutError as timeout", () => {
    assert.equal(classifyModelError(timeoutError()), "timeout");
  });

  it("classifies a TypeError as network", () => {
    assert.equal(classifyModelError(networkError()), "network");
  });

  it("classifies status 404 (or 401, or anything else) as non_transient", () => {
    assert.equal(classifyModelError(notFoundError()), "non_transient");
  });

  it("classifies name AbortError as aborted", () => {
    assert.equal(classifyModelError(abortError()), "aborted");
  });

  it("classifies as aborted when the given signal is already aborted, regardless of the error", () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(classifyModelError(notFoundError(), controller.signal), "aborted");
  });
});

// --- MF1: construction never reads env -------------------------------------

describe("construction never reads the environment (MF1)", () => {
  let savedKey: string | undefined;
  let savedModel: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY;
    savedModel = process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
    if (savedModel !== undefined) process.env.OPENROUTER_MODEL = savedModel;
  });

  it("envModelSource() builds without throwing", () => {
    assert.doesNotThrow(() => envModelSource());
  });

  it("resilient(m => m) builds without throwing", () => {
    assert.doesNotThrow(() => resilient((m) => m));
  });
});

// --- envModelSource().backup() (FR-002) ------------------------------------

describe("envModelSource().backup()", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
      OPENROUTER_MODEL_FALLBACK: process.env.OPENROUTER_MODEL_FALLBACK,
    };
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_MODEL = "primary/model";
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is null when OPENROUTER_MODEL_FALLBACK is absent", () => {
    delete process.env.OPENROUTER_MODEL_FALLBACK;
    assert.equal(envModelSource().backup(), null);
  });

  it("is null when OPENROUTER_MODEL_FALLBACK is empty", () => {
    process.env.OPENROUTER_MODEL_FALLBACK = "";
    assert.equal(envModelSource().backup(), null);
  });

  it("is null when OPENROUTER_MODEL_FALLBACK is only whitespace", () => {
    process.env.OPENROUTER_MODEL_FALLBACK = "   ";
    assert.equal(envModelSource().backup(), null);
  });

  it("is null when OPENROUTER_MODEL_FALLBACK equals OPENROUTER_MODEL", () => {
    process.env.OPENROUTER_MODEL_FALLBACK = "primary/model";
    assert.equal(envModelSource().backup(), null);
  });

  it("returns the trimmed id when valid and distinct", () => {
    process.env.OPENROUTER_MODEL_FALLBACK = "  backup/model  ";
    assert.equal(envModelSource().backup()?.id, "backup/model");
  });
});

// --- MF2: maxRetries: 0 -----------------------------------------------------

describe("createChatModel (MF2)", () => {
  it("sets maxRetries: 0 on the client caller", () => {
    const saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      const model = createChatModel("x/y") as unknown as { caller: { maxRetries: number } };
      assert.equal(model.caller.maxRetries, 0);
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });
});

// --- resilient: fast cases (MF3 partial, MF4, MF5, MF6, MF7, MF8) ----------

describe("resilient (fast cases, no retry wait)", () => {
  it("MF3: a non-transient primary failure (404) is attempted once and falls back", async () => {
    const primary = new FailingModel(notFoundError());
    const result = await resilient((m) => m, fakeSource({ primary, backup: okModel("do reserva") })).invoke("oi");
    assert.equal(primary.attempts, 1);
    assert.equal((result as AIMessage).text, "do reserva");
  });

  it("MF3/FR-005: a timeout is attempted once and falls back (not retried)", async () => {
    const primary = new FailingModel(timeoutError());
    const result = await resilient((m) => m, fakeSource({ primary, backup: okModel("do reserva") })).invoke("oi");
    assert.equal(primary.attempts, 1);
    assert.equal((result as AIMessage).text, "do reserva");
  });

  it("MF4: the backup is called at most once", async () => {
    const primary = new FailingModel(notFoundError());
    const backup = okModel("do reserva");
    let backupCalls = 0;
    const wrappedBackup = new Proxy(backup, {
      get(target, prop, receiver) {
        if (prop === "invoke") {
          backupCalls += 1;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await resilient((m) => m, fakeSource({ primary, backup: wrappedBackup })).invoke("oi");
    assert.equal(backupCalls, 1);
  });

  it("MF5: an already-aborted signal rejects with AbortError; primary and backup are never called", async () => {
    const primary = new FailingModel(transientError());
    const backup = okModel("do reserva");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      resilient((m) => m, fakeSource({ primary, backup })).invoke("oi", { signal: controller.signal }),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    assert.equal(primary.attempts, 0);
  });

  it("MF6: with no backup, a non-transient failure rejects with ModelUnavailableError({tried: [primary]})", async () => {
    const primary = new FailingModel(notFoundError());
    await assert.rejects(
      resilient((m) => m, fakeSource({ primary })).invoke("oi"),
      (error: unknown) => {
        assert.ok(error instanceof ModelUnavailableError);
        assert.deepEqual(error.tried, ["primary-model"]);
        assert.equal(error.reason, "non_transient");
        return true;
      },
    );
  });

  it("MF6: with primary and backup both failing (404), ModelUnavailableError lists both, in order", async () => {
    const primary = new FailingModel(notFoundError());
    const backup = new FailingModel(notFoundError());
    await assert.rejects(
      resilient((m) => m, fakeSource({ primary, backup })).invoke("oi"),
      (error: unknown) => {
        assert.ok(error instanceof ModelUnavailableError);
        assert.deepEqual(error.tried, ["primary-model", "backup-model"]);
        return true;
      },
    );
  });

  it("MF7: inside a resilience scope, a second call after a switch skips the primary entirely", async () => {
    await runWithResilienceScope(async () => {
      const primary1 = new FailingModel(notFoundError());
      await resilient((m) => m, fakeSource({ primary: primary1, backup: okModel("b1") })).invoke("oi");
      assert.equal(primary1.attempts, 1);

      const primary2 = new FailingModel(notFoundError());
      const result2 = await resilient((m) => m, fakeSource({ primary: primary2, backup: okModel("b2") })).invoke("oi");
      assert.equal(primary2.attempts, 0);
      assert.equal((result2 as AIMessage).text, "b2");
    });
  });

  it("MF7: no model_fallback event is dispatched by a call that skipped the primary", async () => {
    await runWithResilienceScope(async () => {
      await resilient((m) => m, fakeSource({ primary: new FailingModel(notFoundError()), backup: okModel("b1") })).invoke("oi");

      const collector = new Collector();
      await resilient((m) => m, fakeSource({ primary: new FailingModel(notFoundError()), backup: okModel("b2") })).invoke("oi", {
        callbacks: [collector],
      });
      assert.equal(collector.events.filter((e) => e.name === MODEL_FALLBACK_EVENT).length, 0);
    });
  });

  it("MF7: outside a scope, each call decides independently — the primary is retried again", async () => {
    const primary1 = new FailingModel(notFoundError());
    await resilient((m) => m, fakeSource({ primary: primary1, backup: okModel("b1") })).invoke("oi");
    assert.equal(primary1.attempts, 1);

    const primary2 = new FailingModel(notFoundError());
    await resilient((m) => m, fakeSource({ primary: primary2, backup: okModel("b2") })).invoke("oi");
    assert.equal(primary2.attempts, 1);
  });

  it("MF8: a good call dispatches model_used with the primary's id", async () => {
    const collector = new Collector();
    await resilient((m) => m, fakeSource({ primary: okModel("ok") })).invoke("oi", { callbacks: [collector] });
    assert.deepEqual(collector.events, [{ name: MODEL_USED_EVENT, data: { model: "primary-model" } }]);
  });

  it("MF8: a switch dispatches model_fallback then model_used with the backup's id; no error message leaks", async () => {
    const collector = new Collector();
    await resilient((m) => m, fakeSource({ primary: new FailingModel(notFoundError()), backup: okModel("do reserva") })).invoke("oi", {
      callbacks: [collector],
    });
    assert.deepEqual(collector.events, [
      { name: MODEL_FALLBACK_EVENT, data: { from: "primary-model", to: "backup-model", reason: "non_transient" } },
      { name: MODEL_USED_EVENT, data: { model: "backup-model" } },
    ]);
    for (const event of collector.events) {
      assert.ok(!JSON.stringify(event.data).includes("inexistente"));
    }
  });
});

// --- resilient: slow cases — real library retry wait (~7s total, research R-013) ---

describe("resilient (slow cases: real retry wait)", () => {
  it("MF3: a primary that always fails with a transient error is attempted exactly MAX_PRIMARY_ATTEMPTS times, then falls back", async () => {
    const primary = new FailingModel(transientError());
    const result = await resilient((m) => m, fakeSource({ primary, backup: okModel("do reserva") })).invoke("oi");
    assert.equal(primary.attempts, MAX_PRIMARY_ATTEMPTS);
    assert.equal((result as AIMessage).text, "do reserva");
  });

  it("a transient failure followed by success answers from the primary, with no fallback event", async () => {
    let call = 0;
    class FlakyThenOk extends FakeListChatModel {
      attempts = 0;
      override async _generate(...args: Parameters<FakeListChatModel["_generate"]>) {
        this.attempts += 1;
        call += 1;
        if (call === 1) throw transientError();
        return super._generate(...args);
      }
    }
    const primary = new FlakyThenOk({ responses: ["do principal"] });
    const collector = new Collector();
    const result = await resilient((m) => m, fakeSource({ primary, backup: okModel("do reserva") })).invoke("oi", {
      callbacks: [collector],
    });
    assert.equal((result as AIMessage).text, "do principal");
    assert.equal(primary.attempts, 2);
    assert.equal(collector.events.filter((e) => e.name === MODEL_FALLBACK_EVENT).length, 0);
  });
});

// --- MF5: cancellation during the retry wait --------------------------------

describe("resilient — cancellation during the retry wait (MF5)", () => {
  it("aborting mid-wait rejects quickly with AbortError; backup is never called", async () => {
    const primary = new FailingModel(transientError());
    const backup = okModel("do reserva");
    let backupCalled = false;
    const wrappedBackup = new Proxy(backup, {
      get(target, prop, receiver) {
        if (prop === "invoke") backupCalled = true;
        return Reflect.get(target, prop, receiver);
      },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    await assert.rejects(
      resilient((m) => m, fakeSource({ primary, backup: wrappedBackup })).invoke("oi", { signal: controller.signal }),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    assert.ok(Date.now() - started < 1_000, "should abort quickly, not wait out all retries");
    assert.equal(primary.attempts, 1);
    assert.equal(backupCalled, false);
  });
});
