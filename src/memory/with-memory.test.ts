import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { formatMemoriesInput, withMemory } from "./with-memory.ts";
import { withReflection } from "../agents/reflection.ts";
import { withConversationHistory } from "../agents/conversation-history.ts";
import type { Critic } from "../agents/critic.ts";
import type { RecalledMemory } from "../domain/schemas.ts";
import type { ReasoningStrategy, RunOptions } from "../agents/types.ts";
import type { StrategyResult } from "../trace/types.ts";

function makeResult(answer: string, llmCalls = 1): StrategyResult {
  return {
    answer,
    trace: [{ type: "answer", content: answer }],
    metrics: { llmCalls, latencyMs: 5 },
    stoppedReason: "completed",
  };
}

function fakeStrategy(
  name: string,
  results: StrategyResult[],
): ReasoningStrategy & { calls: { input: string; options?: RunOptions }[] } {
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

function memories(...entries: [string, string, number][]): RecalledMemory[] {
  return entries.map(([memoryId, fact, score]) => ({ memoryId, fact, score }));
}

function fakeTool(name: string) {
  return tool(async () => "ok", { name, description: "fake tool for tests", schema: z.object({}) });
}

describe("formatMemoriesInput", () => {
  it("returns the input untouched when there are no memories", () => {
    assert.equal(formatMemoriesInput([], "quais serviços são meus?"), "quais serviços são meus?");
  });

  it("prefixes the input with a bracketed-id block, most relevant first", () => {
    const m = memories(["mem-1", "Sou responsável pelo checkout", 0.8], ["mem-2", "Prefiro respostas curtas", 0.5]);
    const composed = formatMemoriesInput(m, "quais serviços são meus?");
    assert.match(composed, /\[mem-1\] Sou responsável pelo checkout/);
    assert.match(composed, /\[mem-2\] Prefiro respostas curtas/);
    assert.match(composed, /quais serviços são meus\?$/);
    assert.ok(composed.indexOf("mem-1") < composed.indexOf("mem-2"));
  });
});

describe("withMemory", () => {
  it("passes the input through unchanged with no memories, and reports recalledMemories: 0", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const wrapped = withMemory(base, { memories: [], tools: [] });

    const result = await wrapped.run("oi");

    assert.equal(base.calls[0]!.input, "oi");
    assert.equal(result.metrics.recalledMemories, 0);
  });

  it("delivers the memory-composed input and reports the recalled count", async () => {
    const base = fakeStrategy("react", [makeResult("checkout-api")]);
    const m = memories(["mem-1", "Sou responsável pelo checkout", 0.8]);
    const wrapped = withMemory(base, { memories: m, tools: [] });

    const result = await wrapped.run("quais serviços são meus?");

    assert.match(base.calls[0]!.input, /\[mem-1\] Sou responsável pelo checkout/);
    assert.equal(result.metrics.recalledMemories, 1);
    assert.equal(result.answer, "checkout-api");
  });

  it("appends its tools to any extraTools already present in options", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const preexisting = fakeTool("preexisting_tool");
    const memoryTool = fakeTool("forget_preference");
    const wrapped = withMemory(base, { memories: [], tools: [memoryTool] });

    await wrapped.run("oi", { extraTools: [preexisting] });

    const toolNames = base.calls[0]!.options?.extraTools?.map((t) => (t as { name: string }).name);
    assert.deepEqual(toolNames, ["preexisting_tool", "forget_preference"]);
  });

  it("passes its tools through even with no prior extraTools", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const memoryTool = fakeTool("forget_preference");
    const wrapped = withMemory(base, { memories: [], tools: [memoryTool] });

    await wrapped.run("oi");

    const toolNames = base.calls[0]!.options?.extraTools?.map((t) => (t as { name: string }).name);
    assert.deepEqual(toolNames, ["forget_preference"]);
  });

  it("keeps the base strategy's name and every other metric untouched", async () => {
    const base = fakeStrategy("plan-and-execute", [makeResult("ok", 4)]);
    const wrapped = withMemory(base, { memories: memories(["mem-1", "fato", 0.5]), tools: [] });

    assert.equal(wrapped.name, "plan-and-execute");
    const result = await wrapped.run("oi");
    assert.equal(result.metrics.llmCalls, 4);
  });
});

describe("composition with withReflection (R-012, same reasoning as 007 R-008)", () => {
  function alwaysApproves(): Critic {
    return async () => ({ approved: true, feedback: "" });
  }

  it("survives being applied OUTSIDE withReflection: recalledMemories is not lost", async () => {
    const base = fakeStrategy("react", [makeResult("resposta")]);
    const reflected = withReflection(base, { maxReflections: 2, critic: alwaysApproves() });
    const wrapped = withMemory(reflected, { memories: memories(["mem-1", "fato", 0.5]), tools: [] });

    const result = await wrapped.run("pergunta");

    assert.equal(result.metrics.recalledMemories, 1);
  });

  it("the critic judges the memory-enriched input", async () => {
    const base = fakeStrategy("react", [makeResult("resposta")]);
    let seenInput = "";
    const critic: Critic = async (context) => {
      seenInput = context.input;
      return { approved: true, feedback: "" };
    };
    const reflected = withReflection(base, { maxReflections: 1, critic });
    const wrapped = withMemory(reflected, {
      memories: memories(["mem-1", "Sou responsável pelo checkout", 0.8]),
      tools: [],
    });

    await wrapped.run("quais serviços são meus?");

    assert.match(seenInput, /\[mem-1\] Sou responsável pelo checkout/);
  });
});

describe("composition with withConversationHistory (contracts/chat-endpoint.md order)", () => {
  it("facts come before history, which comes before the message", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const withMem = withMemory(base, { memories: memories(["mem-1", "Sou responsável pelo checkout", 0.8]), tools: [] });
    const withHistoryAndMem = withConversationHistory(withMem, [
      { role: "user", content: "oi", createdAt: new Date() },
      { role: "assistant", content: "olá!", createdAt: new Date() },
    ]);

    await withHistoryAndMem.run("quais serviços são meus?");

    const seenInput = base.calls[0]!.input;
    const factIndex = seenInput.indexOf("Sou responsável pelo checkout");
    const historyIndex = seenInput.indexOf("[plantonista] oi");
    const messageIndex = seenInput.indexOf("quais serviços são meus?");
    assert.ok(factIndex >= 0 && historyIndex > factIndex && messageIndex > historyIndex);
  });

  it("both metrics survive together", async () => {
    const base = fakeStrategy("react", [makeResult("ok")]);
    const withMem = withMemory(base, { memories: memories(["mem-1", "fato", 0.5]), tools: [] });
    const withHistoryAndMem = withConversationHistory(withMem, [
      { role: "user", content: "oi", createdAt: new Date() },
    ]);

    const result = await withHistoryAndMem.run("pergunta");
    assert.equal(result.metrics.recalledMemories, 1);
    assert.equal(result.metrics.historyMessages, 1);
  });
});
