import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planConversationContext,
  verbatimStart,
  prepareConversationContext,
  SUMMARY_BATCH,
  MAX_VERBATIM_MESSAGES,
} from "./conversation-context.ts";
import { InMemoryConversationStore } from "../store/in-memory-conversation-store.ts";
import type { SummarizerInput, Summarizer } from "./summarizer.ts";

// --- P1/P2: planConversationContext, verbatimStart (pure) -----------------

describe("planConversationContext (P1)", () => {
  const cases: Array<{ total: number; covered: number; summarize: { offset: number; count: number } | null }> = [
    { total: 0, covered: 0, summarize: null },
    { total: 8, covered: 0, summarize: null },
    { total: 14, covered: 0, summarize: null },
    { total: 16, covered: 0, summarize: { offset: 0, count: 8 } },
    { total: 18, covered: 8, summarize: null },
    { total: 24, covered: 8, summarize: { offset: 8, count: 8 } },
    { total: 40, covered: 0, summarize: { offset: 0, count: 32 } },
  ];

  for (const { total, covered, summarize } of cases) {
    it(`total=${total} covered=${covered} -> ${JSON.stringify(summarize)}`, () => {
      const result = planConversationContext({ totalMessages: total, coveredMessages: covered });
      assert.deepEqual(result.summarize, summarize);
    });
  }

  it("does not mutate its input (P3)", () => {
    const args = { totalMessages: 16, coveredMessages: 0 };
    const snapshot = { ...args };
    planConversationContext(args);
    assert.deepEqual(args, snapshot);
  });
});

describe("verbatimStart (P2)", () => {
  const cases: Array<{ total: number; covered: number; start: number }> = [
    { total: 8, covered: 0, start: 0 },
    { total: 16, covered: 8, start: 8 },
    { total: 24, covered: 8, start: 9 }, // max(8, 24-15) = 9
    { total: 40, covered: 0, start: 25 }, // max(0, 40-15) = 25
  ];

  for (const { total, covered, start } of cases) {
    it(`total=${total} covered=${covered} -> ${start}`, () => {
      assert.equal(verbatimStart({ totalMessages: total, coveredMessages: covered }), start);
    });
  }
});

// --- Helpers for the orchestration tests -----------------------------------

function appendTurns(store: InMemoryConversationStore, conversationId: string, count: number): void {
  for (let i = 0; i < count; i += 1) {
    store.append(conversationId, [
      { role: "user", content: `pergunta ${i}` },
      { role: "assistant", content: `resposta ${i}` },
    ]);
  }
}

/** Records every SummarizerInput it receives and replies deterministically. */
function recordingSummarizer(): { summarizer: Summarizer; calls: SummarizerInput[] } {
  const calls: SummarizerInput[] = [];
  const summarizer: Summarizer = async (input) => {
    calls.push(input);
    return `resumo#${calls.length}`;
  };
  return { summarizer, calls };
}

function rejectingSummarizer(error: unknown = new Error("falha do sumarizador")): Summarizer {
  return async () => {
    throw error;
  };
}

function emptySummarizer(): Summarizer {
  return async () => "   ";
}

function neverResolvingSummarizer(): Summarizer {
  return () => new Promise<string>(() => {});
}

// --- C1-C8: prepareConversationContext (orchestration) ---------------------

describe("prepareConversationContext — sem sumarização (C1)", () => {
  it("com 14 mensagens (6 pendentes < SUMMARY_BATCH), o sumarizador não é chamado e tudo é entregue na íntegra", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 7); // 14 messages
    const { summarizer, calls } = recordingSummarizer();

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer, timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(calls.length, 0);
    assert.equal(context.summary, null);
    assert.equal(context.messages.length, 14);
    assert.equal(context.summarizeEvent, undefined);
  });
});

describe("prepareConversationContext — primeira sumarização (C3)", () => {
  it("com 16 mensagens, o sumarizador recebe previousSummary: null e as 8 primeiras; grava cobertura 8; entrega 8 na íntegra e o evento", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8); // 16 messages
    const { summarizer, calls } = recordingSummarizer();

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer, timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.previousSummary, null);
    assert.deepEqual(
      calls[0]!.messages.map((m) => m.content),
      Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? `pergunta ${i / 2}` : `resposta ${(i - 1) / 2}`)),
    );

    assert.equal(context.summary, "resumo#1");
    assert.equal(context.summaryCoveredMessages, 8);
    assert.equal(context.messages.length, 8);
    assert.deepEqual(context.summarizeEvent, { type: "summarize", content: "resumo#1", absorbedMessages: 8 });

    assert.equal(store.getSummary(id)?.content, "resumo#1");
    assert.equal(store.getSummary(id)?.coveredMessages, 8);
  });
});

describe("prepareConversationContext — falha do sumarizador (C4)", () => {
  it("sumarizador que rejeita: resolve sem resumo novo; sem resumo anterior, messages têm até 15", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8); // 16 messages, 8 pending

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: rejectingSummarizer(), timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(context.summary, null);
    assert.equal(context.summaryCoveredMessages, 0);
    assert.equal(store.getSummary(id), null);
    assert.equal(context.summarizeEvent, undefined);
    assert.equal(context.messages.length, 15); // MAX_VERBATIM_MESSAGES, since 16 > 15
  });

  it("sumarizador que devolve resumo vazio: mesmo comportamento de falha", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8);

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: emptySummarizer(), timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(context.summary, null);
    assert.equal(context.summarizeEvent, undefined);
  });

  it("sumarizador que nunca resolve, com timeoutMs curto: resolve dentro do prazo, sem resumo novo", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8);
    const start = Date.now();

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: neverResolvingSummarizer(), timeoutMs: 20 },
      id,
      new AbortController().signal,
    );

    assert.ok(Date.now() - start < 1000);
    assert.equal(context.summary, null);
    assert.equal(context.summarizeEvent, undefined);
  });

  it("com resumo anterior de cobertura 8 e sumarizador que rejeita: o resumo anterior fica intacto, e as mensagens na íntegra ficam entre 8 e 15 (verbatimStart = max(8, 24-15) = 9)", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 12); // 24 messages
    store.saveSummary(id, { content: "resumo prévio", coveredMessages: 8 });

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: rejectingSummarizer(), timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(context.summary, "resumo prévio");
    assert.equal(context.summaryCoveredMessages, 8);
    assert.equal(context.messages.length, 15); // 24 - 9 = 15
    assert.equal(context.summarizeEvent, undefined);
  });
});

describe("prepareConversationContext — teto de mensagens na íntegra (C7)", () => {
  it("40 mensagens e sumarizador que rejeita: exatamente as 15 últimas são entregues", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 20); // 40 messages

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: rejectingSummarizer(), timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(context.messages.length, MAX_VERBATIM_MESSAGES);
    assert.deepEqual(
      context.messages.map((m) => m.content),
      ["resposta 12", "pergunta 13", "resposta 13", "pergunta 14", "resposta 14", "pergunta 15", "resposta 15",
        "pergunta 16", "resposta 16", "pergunta 17", "resposta 17", "pergunta 18", "resposta 18", "pergunta 19", "resposta 19"],
    );
  });
});

describe("prepareConversationContext — cancelamento (C6)", () => {
  it("um AbortController já abortado faz a preparação resolver sem resumo novo", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8);
    const controller = new AbortController();
    controller.abort();

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: neverResolvingSummarizer(), timeoutMs: 5000 },
      id,
      controller.signal,
    );

    assert.equal(context.summary, null);
    assert.equal(context.summarizeEvent, undefined);
  });
});

describe("capSummary aplicado ao resultado gravado", () => {
  it("uma saída acima de SUMMARY_MAX_CHARS é gravada já cortada", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8);
    const longSummarizer: Summarizer = async () => "x".repeat(900);

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer: longSummarizer, timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(context.summary?.length, 800);
    assert.ok(context.summary?.endsWith("…"));
  });
});

// --- 011-history-summarization US2: cadência e mesclagem (C2, SC-001, SC-003) --

describe("prepareConversationContext — mesclagem (C2)", () => {
  it("com resumo vigente de cobertura 8 e 24 mensagens, a próxima sumarização recebe previousSummary e exatamente as mensagens 8..15", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 12); // 24 messages
    store.saveSummary(id, { content: "R1", coveredMessages: 8 });
    const { summarizer, calls } = recordingSummarizer();

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer, timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.previousSummary, "R1");
    assert.deepEqual(
      calls[0]!.messages.map((m) => m.content),
      ["pergunta 4", "resposta 4", "pergunta 5", "resposta 5", "pergunta 6", "resposta 6", "pergunta 7", "resposta 7"],
    );
    assert.equal(context.summaryCoveredMessages, 16);
    assert.equal(store.getSummary(id)?.content, "resumo#1");
  });
});

describe("prepareConversationContext — cadência exata ao longo de uma conversa (SC-001, SC-003)", () => {
  it("chama o sumarizador exatamente nos turnos 9, 13 e 17, sempre com o resumo anterior", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    const { summarizer, calls } = recordingSummarizer();

    let expectedCalls = 0;
    for (let turn = 1; turn <= 20; turn += 1) {
      const totalBefore = store.countMessages(id);
      const covered = store.getSummary(id)?.coveredMessages ?? 0;
      const pending = Math.max(0, totalBefore - SUMMARY_BATCH - covered);
      if (pending >= SUMMARY_BATCH) expectedCalls += 1;

      await prepareConversationContext(
        { conversationStore: store, summarizer, timeoutMs: 1000 },
        id,
        new AbortController().signal,
      );
      store.append(id, [
        { role: "user", content: `pergunta turno ${turn}` },
        { role: "assistant", content: `resposta turno ${turn}` },
      ]);

      assert.equal(calls.length, expectedCalls, `turno ${turn}`);
    }

    assert.equal(calls.length, 3);
    // Every call after the first received the previous call's summary.
    for (let i = 1; i < calls.length; i += 1) {
      assert.equal(calls[i]!.previousSummary, `resumo#${i}`);
    }
  });
});

// --- 011-history-summarization US2: concorrência (C5, C8) -----------------

describe("prepareConversationContext — concorrência (C5)", () => {
  it("dois pedidos simultâneos que disparam a mesma sumarização: só um grava, os dois devolvem o mesmo resumo, nenhum rejeita", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8); // 16 messages, 8 pending

    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    let calls = 0;
    const summarizer: Summarizer = async () => {
      calls += 1;
      if (calls === 1) return new Promise<string>((resolve) => (resolveFirst = resolve));
      return new Promise<string>((resolve) => (resolveSecond = resolve));
    };

    const p1 = prepareConversationContext(
      { conversationStore: store, summarizer, timeoutMs: 5000 },
      id,
      new AbortController().signal,
    );
    const p2 = prepareConversationContext(
      { conversationStore: store, summarizer, timeoutMs: 5000 },
      id,
      new AbortController().signal,
    );

    // Let both reach their summarizer call before resolving either.
    await new Promise((r) => setTimeout(r, 10));
    resolveFirst("resumo A");
    resolveSecond("resumo B");

    const [c1, c2] = await Promise.all([p1, p2]);

    assert.equal(c1.summary, c2.summary);
    assert.equal(store.getSummary(id)?.content, c1.summary);
    // Exactly one of the two produced a summarize event.
    const events = [c1.summarizeEvent, c2.summarizeEvent].filter(Boolean);
    assert.equal(events.length, 1);
  });
});

describe("prepareConversationContext — fotografia do total (C8)", () => {
  it("mensagens gravadas por outro pedido enquanto o sumarizador está pendente não entram nesta preparação", async () => {
    const store = new InMemoryConversationStore();
    const id = store.create();
    appendTurns(store, id, 8); // 16 messages

    const summarizer: Summarizer = async (input) => {
      // Simulate another request appending a new turn while this one summarizes.
      store.append(id, [
        { role: "user", content: "intruso" },
        { role: "assistant", content: "intruso resposta" },
      ]);
      return `resumo(${input.messages.length})`;
    };

    const context = await prepareConversationContext(
      { conversationStore: store, summarizer, timeoutMs: 1000 },
      id,
      new AbortController().signal,
    );

    assert.equal(context.messages.length, 8);
    assert.ok(!context.messages.some((m) => m.content.includes("intruso")));
  });
});
