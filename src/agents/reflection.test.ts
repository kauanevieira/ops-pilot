import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { withReflection, DEFAULT_MAX_REFLECTIONS } from "./reflection.ts";
import type { Critic, CritiqueContext } from "./critic.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";
import { MODEL_FALLBACK_EVENT, MODEL_USED_EVENT } from "./model.ts";

/**
 * `promptTokens` is `undefined` by default (010-context-measurement, R2):
 * a fake attempt that never mentions token usage must leave the decorated
 * result's `promptTokens` key absent, the same way a real attempt with an
 * unreported call would.
 */
function makeResult(answer: string, trace: TraceEvent[] = [], llmCalls = 1, promptTokens?: number, modelUsed?: string): StrategyResult {
  return {
    answer,
    trace: [...trace, { type: "answer", content: answer }],
    metrics: {
      llmCalls,
      latencyMs: 5,
      ...(promptTokens !== undefined && { promptTokens }),
      ...(modelUsed !== undefined && { modelUsed }),
    },
    stoppedReason: "completed",
  };
}

/** An `LLMResult` whose `AIMessage` reports the given input token count. */
function usageResult(inputTokens: number): LLMResult {
  return {
    generations: [
      [{ text: "", message: new AIMessage({ content: "", usage_metadata: { input_tokens: inputTokens, output_tokens: 0, total_tokens: inputTokens } }) } as never],
    ],
  };
}

/** An `LLMResult` that completed without reporting `usage_metadata` (013-model-resilience, research R-010). */
function noUsageResult(): LLMResult {
  return { generations: [[{ text: "", message: new AIMessage({ content: "" }) } as never]] };
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
 * A critic that starts a chat-model call and then fails BEFORE it
 * completes — `handleLLMEnd` never fires (013-model-resilience, research
 * R-010: `LlmCallCounter` now counts on `handleLLMEnd`, so a call that
 * never reaches it never counts at all, and can no longer make
 * `promptTokens` absent — that's the whole point of the change: a
 * retried/replaced attempt must not inflate `llmCalls`).
 */
function throwingCriticAfterStart(): Critic {
  return async (_context, callbacks) => {
    for (const handler of callbacks) {
      (handler as { handleChatModelStart?: () => void }).handleChatModelStart?.();
    }
    throw new Error("crítico indisponível depois de iniciar a chamada");
  };
}

/**
 * A critic fake that also reports a call count, to test metrics summing.
 * `state` is returned by reference (not destructured), so callers read the
 * live count after `run()` resolves, instead of a snapshot taken early.
 *
 * Always fires `handleLLMEnd` — a real critic call always completes one
 * way or another (013-model-resilience, research R-010: only completed
 * calls count). `promptTokens`, when given, makes that `handleLLMEnd`
 * report usage (010-context-measurement, R1); omitted, it completes
 * WITHOUT usage — simulating a real call whose provider didn't report
 * consumption, which still counts in `llmCalls` but makes `promptTokens`
 * absent (R2).
 */
function countingCritic(
  verdicts: { approved: boolean; feedback: string; promptTokens?: number }[],
): { critic: Critic; state: { calls: number } } {
  const state = { calls: 0 };
  const critic: Critic = async (_context: CritiqueContext, callbacks) => {
    state.calls += 1;
    const verdict = verdicts[Math.min(state.calls - 1, verdicts.length - 1)]!;
    // Simulate a real critic firing its callbacks, the way createLlmCritic does.
    for (const handler of callbacks) {
      const h = handler as { handleChatModelStart?: () => void; handleLLMEnd?: (result: LLMResult) => void };
      h.handleChatModelStart?.();
      h.handleLLMEnd?.(verdict.promptTokens !== undefined ? usageResult(verdict.promptTokens) : noUsageResult());
    }
    return verdict;
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

  describe("promptTokens (010-context-measurement)", () => {
    it("sums the attempt's and the critic's promptTokens on approval (R1)", async () => {
      const base = fakeStrategy("base", [makeResult("r1", [], 1, 100)]);
      const { critic } = countingCritic([{ approved: true, feedback: "", promptTokens: 40 }]);
      const decorated = withReflection(base, { critic });

      const result = await decorated.run("pedido");

      assert.equal(result.metrics.promptTokens, 140);
    });

    it("sums every attempt and every critic call across a regeneration (R1)", async () => {
      const base = fakeStrategy("base", [makeResult("r1", [], 1, 100), makeResult("r2", [], 1, 150)]);
      const { critic } = countingCritic([
        { approved: false, feedback: "falta evidência", promptTokens: 40 },
        { approved: true, feedback: "", promptTokens: 40 },
      ]);
      const decorated = withReflection(base, { critic });

      const result = await decorated.run("pedido");

      assert.equal(result.metrics.promptTokens, 100 + 150 + 40 + 40);
    });

    it("leaves promptTokens absent when an attempt didn't report it (R2)", async () => {
      const base = fakeStrategy("base", [makeResult("r1")]); // no promptTokens
      const { critic } = countingCritic([{ approved: true, feedback: "", promptTokens: 40 }]);
      const decorated = withReflection(base, { critic });

      const result = await decorated.run("pedido");

      assert.equal("promptTokens" in result.metrics, false);
    });

    it("keeps the attempt's own promptTokens when the critic started a call and then failed before completing (R3, revised by 013-model-resilience research R-010)", async () => {
      const base = fakeStrategy("base", [makeResult("r1", [], 1, 100)]);
      const decorated = withReflection(base, { critic: throwingCriticAfterStart() });

      const result = await decorated.run("pedido");

      // The critic's own call never reached `handleLLMEnd`, so it never
      // counted at all (research R-010) — it can no longer poison the
      // sum the way an "unreported" call used to.
      assert.equal(result.metrics.promptTokens, 100);
    });

    it("maxReflections: 0 returns the attempt's own promptTokens untouched", async () => {
      const base = fakeStrategy("base", [makeResult("r1", [], 1, 100)]);
      const { critic } = countingCritic([{ approved: false, feedback: "x" }]);
      const decorated = withReflection(base, { maxReflections: 0, critic });

      const result = await decorated.run("pedido");

      assert.equal(result.metrics.promptTokens, 100);
    });
  });

  // --- 013-model-resilience (US2): modelUsed and the critic's own fallback events ---

  describe("modelUsed and fallback events (013-model-resilience, US2)", () => {
    it("modelUsed is copied from the last attempt, in all four return points", async () => {
      // Approval on the first critique — the "verdict.approved" return point.
      const approved = fakeStrategy("base", [makeResult("r1", [], 1, undefined, "primary-model")]);
      const resultApproved = await withReflection(approved, { critic: alwaysApproves() }).run("pedido");
      assert.equal(resultApproved.metrics.modelUsed, "primary-model");

      // Regeneration exhausts maxReflections — the final return point, after the loop.
      const exhausted = fakeStrategy("base", [
        makeResult("r1", [], 1, undefined, "primary-model"),
        makeResult("r2", [], 1, undefined, "backup-model"),
      ]);
      const resultExhausted = await withReflection(exhausted, { maxReflections: 1, critic: alwaysRejects() }).run("pedido");
      assert.equal(resultExhausted.metrics.modelUsed, "backup-model");

      // maxReflections: 0 — the short-circuit return point, before the loop.
      const shortCircuit = fakeStrategy("base", [makeResult("r1", [], 1, undefined, "primary-model")]);
      const resultShortCircuit = await withReflection(shortCircuit, { maxReflections: 0 }).run("pedido");
      assert.equal(resultShortCircuit.metrics.modelUsed, "primary-model");
    });

    it("a critic call that switches models produces a fallback event right before its own critique", async () => {
      const base = fakeStrategy("base", [makeResult("r1")]);
      const fallingBackCritic: Critic = async (_context, callbacks) => {
        for (const handler of callbacks) {
          const h = handler as { handleCustomEvent?: (name: string, data: unknown) => void };
          h.handleCustomEvent?.(MODEL_FALLBACK_EVENT, { from: "primary-model", to: "backup-model", reason: "non_transient" });
          h.handleCustomEvent?.(MODEL_USED_EVENT, { model: "backup-model" });
        }
        return { approved: true, feedback: "ok" };
      };
      const decorated = withReflection(base, { critic: fallingBackCritic });

      const result = await decorated.run("pedido");

      const fallbackIndex = result.trace.findIndex((e) => e.type === "fallback");
      const critiqueIndex = result.trace.findIndex((e) => e.type === "critique");
      assert.ok(fallbackIndex >= 0 && critiqueIndex >= 0);
      assert.ok(fallbackIndex < critiqueIndex);
      assert.deepEqual(result.trace[fallbackIndex], {
        type: "fallback",
        from: "primary-model",
        to: "backup-model",
        reason: "non_transient",
      });
    });
  });
});
