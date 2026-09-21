import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "./with-timeout.ts";

describe("withTimeout", () => {
  it("resolves with the value when work finishes before the deadline", async () => {
    const value = await withTimeout(1000, async () => "ok");
    assert.equal(value, "ok");
  });

  it("rejects with the same error when work rejects", async () => {
    const boom = new Error("boom");
    await assert.rejects(
      withTimeout(1000, async () => {
        throw boom;
      }),
      boom,
    );
  });

  it("rejects with the given message when work never resolves, and aborts work's signal", async () => {
    let sawAborted = false;
    const promise = withTimeout(
      20,
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAborted = true;
            reject(new Error("aborted"));
          });
        }),
      { timeoutMessage: "custom timeout" },
    );
    await assert.rejects(promise, /custom timeout/);
    assert.equal(sawAborted, true);
  });

  it("settles on the timeout even when work ignores its signal", async () => {
    const start = Date.now();
    await assert.rejects(
      withTimeout(20, () => new Promise<void>(() => {})),
      /Tempo limite excedido\./,
    );
    assert.ok(Date.now() - start < 500);
  });

  it("rejects when parentSignal aborts during work, and aborts work's own signal", async () => {
    const parentController = new AbortController();
    let sawAborted = false;
    const promise = withTimeout(
      5000,
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAborted = true;
            reject(new Error("aborted"));
          });
        }),
      { parentSignal: parentController.signal },
    );
    setTimeout(() => parentController.abort(), 10);
    await assert.rejects(promise);
    assert.equal(sawAborted, true);
  });

  it("rejects immediately when parentSignal is already aborted", async () => {
    const parentController = new AbortController();
    parentController.abort();
    const start = Date.now();
    await assert.rejects(
      withTimeout(5000, async () => "should not get here", { parentSignal: parentController.signal }),
    );
    assert.ok(Date.now() - start < 500);
  });
});
