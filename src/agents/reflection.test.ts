import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withReflection, DEFAULT_MAX_REFLECTIONS } from "./reflection.ts";
import type { Critic, CritiqueContext } from "./critic.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";

function makeResult(answer: string, trace: TraceEvent[] = [], llmCalls = 1): StrategyResult {
  return {
    answer,
    trace: [...trace, { type: "answer", content: answer }],
    metrics: { llmCalls, latencyMs: 5 },
    stoppedReason: "completed",
  };
}

/**
 * A base strategy fake that records every `input`/`RunOptions` it was
 * invoked with, and hands back one scripted result per call (looping the
 * last one if called more times than scripted) — everything the reflection
 * cycle tests need, offline (T009, R-004).
 */
function fakeStrategy(name: string, results: StrategyResult[]): ReasoningStrategy & { calls: { input: string; options?: RunOptions }[] } {
  const calls: { input: string; options?: RunOptions }[] = [];
  return {
    name,
    calls,
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      calls.push({ input, options });
      return results[Math.min(calls.length - 1, results.length - 1)]!;
    },
  };
}

function alwaysApproves(): Critic {
  return async () => ({ approved: true, feedback: "" });
}

function alwaysRejects(feedback = "faltou evidência"): Critic {
  return async () => ({ approved: false, feedback });
}

function rejectsThenApproves(): Critic {
  let calls = 0;
  return async () => {
    calls += 1;
    return calls === 1 ? { approved: false, feedback: "primeira reprovação" } : { approved: true, feedback: "" };
  };
}

function throwingCritic(): Critic {
  return async () => {
    throw new Error("crítico indisponível");
  };
}

/**
 * A critic fake that also reports a call count, to test metrics summing.
 * `state` is returned by reference (not destructured), so callers read the
 * live count after `run()` resolves, instead of a snapshot taken early.
 */
function countingCritic(verdicts: { approved: boolean; feedback: string }[]): { critic: Critic; state: { calls: number } } {
  const state = { calls: 0 };
  const critic: Critic = async (_context: CritiqueContext, callbacks) => {
    state.calls += 1;
    // Simulate a real critic firing its callbacks, the way createLlmCritic does.
    for (const handler of callbacks) {
      (handler as { handleChatModelStart?: () => void }).handleChatModelStart?.();
    }
    return verdicts[Math.min(state.calls - 1, verdicts.length - 1)]!;
  };
  return { critic, state };
}

describe("withReflection", () => {
  it("derives its name from the base strategy's name (FR-003)", () => {
    const decorated = withReflection(fakeStrategy("react", [makeResult("ok")]));
    assert.equal(decorated.name, "reflect:react");
  });

  it("approves on the first attempt: base runs once, answer is the first attempt's", async () => {
    const base = fakeStrategy("base", [makeResult("resposta 1")]);
    const decorated = withReflection(base, { critic: alwaysApproves() });

    const result = await decorated.run("pedido");

    assert.equal(base.calls.length, 1);
    assert.equal(result.answer, "resposta 1");
    assert.equal(result.stoppedReason, "completed");
  });

  it("regenerates once when rejected, then approves: base runs twice, answer is the second attempt's", async () => {
    const base = fakeStrategy("base", [makeResult("resposta 1"), makeResult("resposta 2")]);
    const decorated = withReflection(base, { critic: rejectsThenApproves() });

    const result = await decorated.run("pedido");

    assert.equal(base.calls.length, 2);
    assert.equal(result.answer, "resposta 2");
    assert.equal(result.stoppedReason, "completed");
  });

  it("exhausts maxReflections without approval: base runs maxReflections+1 times, stoppedReason is max-reflections (FR-014, FR-015, SC-003)", async () => {
    const base = fakeStrategy("base", [makeResult("r1"), makeResult("r2"), makeResult("r3")]);
    const decorated = withReflection(base, { maxReflections: 2, critic: alwaysRejects() });

    const result = await decorated.run("pedido");

    assert.equal(base.calls.length, 3);
    assert.equal(result.answer, "r3");
    assert.equal(result.stoppedReason, "max-reflections");
  });

  it("maxReflections: 0 returns the base result untouched — no critique event, no extra call (FR-016)", async () => {
    const base = fakeStrategy("base", [makeResult("r1")]);
    const decorated = withReflection(base, { maxReflections: 0, critic: alwaysRejects() });

    const result = await decorated.run("pedido");

    assert.equal(base.calls.length, 1);
    assert.equal(result.trace.some((e) => e.type === "critique"), false);
    assert.equal(result.metrics.llmCalls, 1);
    assert.equal(result.stoppedReason, "completed");
  });

  it("a failing critic resolves the run instead of rejecting it, delivering the current answer (FR-017, SC-006)", async () => {
    const base = fakeStrategy("base", [makeResult("r1")]);
    const decorated = withReflection(base, { critic: throwingCritic() });

    const result = await decorated.run("pedido");

    assert.equal(result.answer, "r1");
    assert.equal(base.calls.length, 1);
  });

  it("marks an unavailable critique distinguishably from a rejection in the trace (FR-020)", async () => {
    const base = fakeStrategy("base", [makeResult("r1")]);
    const decorated = withReflection(base, { critic: throwingCritic() });

    const result = await decorated.run("pedido");

    const critiques = result.trace.filter((e) => e.type === "critique");
    assert.equal(critiques.length, 1);
    assert.match((critiques[0] as { content: string }).content, /^indisponível:/);
  });

  it("passes RunOptions through untouched to every attempt (FR-005)", async () => {
    const base = fakeStrategy("base", [makeResult("r1"), makeResult("r2")]);
    const decorated = withReflection(base, { critic: rejectsThenApproves() });

    await decorated.run("pedido", { maxIterations: 7 });

    assert.deepEqual(base.calls[0]?.options, { maxIterations: 7 });
    assert.deepEqual(base.calls[1]?.options, { maxIterations: 7 });
  });

  it("two calls to run() on the same instance do not share state (FR-002)", async () => {
    const base = fakeStrategy("base", [makeResult("a1"), makeResult("a2")]);
    const decorated = withReflection(base, { critic: alwaysApproves() });

    const first = await decorated.run("pedido 1");
    const second = await decorated.run("pedido 2");

    assert.equal(first.answer, "a1");
    assert.equal(second.answer, "a2");
    assert.equal(first.metrics.llmCalls, second.metrics.llmCalls);
  });

  it("defaults maxReflections to 2 when not configured (FR-004)", async () => {
    // Rejects always; if the default were anything but 2, base.calls.length would differ.
    const base = fakeStrategy("base", [makeResult("r1"), makeResult("r2"), makeResult("r3"), makeResult("r4")]);
    const decorated = withReflection(base, { critic: alwaysRejects() });

    await decorated.run("pedido");

    assert.equal(DEFAULT_MAX_REFLECTIONS, 2);
    assert.equal(base.calls.length, 3);
  });

  describe("trace assembly (US2)", () => {
    it("concatenates every attempt's events in order, with critique right after the answer it judged (FR-019, R-007)", async () => {
      const base = fakeStrategy("base", [
        makeResult("r1", [{ type: "action", tool: "list_alerts", args: {} }]),
        makeResult("r2"),
      ]);
      const decorated = withReflection(base, { critic: rejectsThenApproves() });

      const result = await decorated.run("pedido");

      const types = result.trace.map((e) => e.type);
      assert.deepEqual(types, ["action", "answer", "critique", "answer", "critique"]);
    });

    it("keeps the rejected attempt's answer in the trace for auditability", async () => {
      const base = fakeStrategy("base", [makeResult("resposta ruim"), makeResult("resposta boa")]);
      const decorated = withReflection(base, { critic: rejectsThenApproves() });

      const result = await decorated.run("pedido");

      const answers = result.trace.filter((e) => e.type === "answer").map((e) => (e as { content: string }).content);
      assert.deepEqual(answers, ["resposta ruim", "resposta boa"]);
    });

    it("never emits more critique events than maxReflections", async () => {
      const base = fakeStrategy("base", [makeResult("r1"), makeResult("r2"), makeResult("r3")]);
      const decorated = withReflection(base, { maxReflections: 2, critic: alwaysRejects() });

      const result = await decorated.run("pedido");

      assert.equal(result.trace.filter((e) => e.type === "critique").length, 2);
    });

    it("prefixes the critique content with aprovado/reprovado depending on the verdict (FR-018)", async () => {
      const base = fakeStrategy("base", [makeResult("r1"), makeResult("r2")]);
      const decorated = withReflection(base, { critic: rejectsThenApproves() });

      const result = await decorated.run("pedido");

      const critiques = result.trace.filter((e) => e.type === "critique").map((e) => (e as { content: string }).content);
      assert.match(critiques[0]!, /^reprovado: /);
      assert.match(critiques[1]!, /^aprovado: /);
    });
  });

  describe("metrics (US2)", () => {
    it("sums llmCalls across every attempt plus the critic's calls (FR-022)", async () => {
      const base = fakeStrategy("base", [makeResult("r1", [], 3), makeResult("r2", [], 4)]);
      const { critic, state } = countingCritic([
        { approved: false, feedback: "falta evidência" },
        { approved: true, feedback: "" },
      ]);
      const decorated = withReflection(base, { critic });

      const result = await decorated.run("pedido");

      assert.equal(result.metrics.llmCalls, 3 + 4 + 2);
      assert.equal(state.calls, 2);
    });

    it("does not add critic calls when maxReflections is 0", async () => {
      const base = fakeStrategy("base", [makeResult("r1", [], 5)]);
      const { critic } = countingCritic([{ approved: false, feedback: "x" }]);
      const decorated = withReflection(base, { maxReflections: 0, critic });

      const result = await decorated.run("pedido");

      assert.equal(result.metrics.llmCalls, 5);
    });

    it("measures latencyMs for the whole decorated run, not the sum of attempts", async () => {
      const base = fakeStrategy("base", [makeResult("r1")]);
      const decorated = withReflection(base, { critic: alwaysApproves() });

      const result = await decorated.run("pedido");

      assert.equal(typeof result.metrics.latencyMs, "number");
      assert.ok(result.metrics.latencyMs >= 0);
    });
  });
});
