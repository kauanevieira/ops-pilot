import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEmbedderFromLoader, createLocalEmbedder, EMBEDDING_DIM } from "./embeddings.ts";
import { SqliteMemoryStore } from "./memory-store.ts";
import { DatabaseSync } from "node:sqlite";

/** A fake "pipeline" shaped just enough for createEmbedderFromLoader to drive it. */
function fakeExtractor() {
  return async (_text: string, _options?: unknown) => ({
    data: new Float32Array(EMBEDDING_DIM).fill(1 / Math.sqrt(EMBEDDING_DIM)),
  });
}

// --- E1-E3: singleton/retry behavior, no real model involved ---------------

describe("createEmbedderFromLoader (singleton/retry, no real model)", () => {
  it("E2: nothing is loaded before the first embed() call", async () => {
    let loads = 0;
    createEmbedderFromLoader(async () => {
      loads += 1;
      return fakeExtractor() as never;
    });
    assert.equal(loads, 0);
  });

  it("E1: the loader runs once even under concurrent embed() calls made while it's loading", async () => {
    let loads = 0;
    let resolveLoad!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    const embedder = createEmbedderFromLoader(async () => {
      loads += 1;
      await gate;
      return fakeExtractor() as never;
    });

    const calls = [embedder.embed("a"), embedder.embed("b"), embedder.embed("c")];
    // Give the three calls a chance to all reach getExtractor() before the load resolves.
    await new Promise((resolve) => setTimeout(resolve, 10));
    resolveLoad();
    const results = await Promise.all(calls);

    assert.equal(loads, 1);
    assert.equal(results.length, 3);
  });

  it("E3: a failed load is not memoized — the next call retries", async () => {
    let loads = 0;
    const embedder = createEmbedderFromLoader(async () => {
      loads += 1;
      if (loads === 1) throw new Error("sem rede");
      return fakeExtractor() as never;
    });

    await assert.rejects(() => embedder.embed("oi"), /sem rede/);
    assert.equal(loads, 1);

    const vector = await embedder.embed("oi");
    assert.equal(loads, 2);
    assert.equal(vector.length, EMBEDDING_DIM);
  });

  it("embed() returns a copy of the extractor's output, sized EMBEDDING_DIM", async () => {
    const embedder = createEmbedderFromLoader(async () => fakeExtractor() as never);
    const vector = await embedder.embed("oi");
    assert.ok(vector instanceof Float32Array);
    assert.equal(vector.length, EMBEDDING_DIM);
  });
});

// --- E4/E5 + FR-034: the real model, skipped when not cached ---------------

describe("createLocalEmbedder (real model)", () => {
  it("E4/E5: produces a normalized EMBEDDING_DIM vector, and recalls a fact with no shared words (FR-034)", async (t) => {
    const embedder = createLocalEmbedder({ allowRemote: false });

    let probe: Float32Array;
    try {
      probe = await embedder.embed("teste");
    } catch {
      t.skip("modelo não está em cache — rode `npm run memory:model` antes de rodar este teste");
      return;
    }

    // E5: normalized, EMBEDDING_DIM positions.
    assert.equal(probe.length, EMBEDDING_DIM);
    const norm = Math.sqrt(probe.reduce((sum, x) => sum + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-3, `expected norm ~1, got ${norm}`);

    // FR-034: recalled by sentence with NO shared words with the fact.
    const db = new DatabaseSync(":memory:");
    const store = new SqliteMemoryStore(db, embedder);
    await store.remember("kauane", "Meu time de plantão é o de pagamentos");

    const related = await store.recall("kauane", "quem cobre cobranças e faturamento?");
    assert.ok(related.length >= 1, "expected the fact to be recalled by a related, wordless-overlap query");
    assert.match(related[0]!.fact, /pagamentos/);

    const unrelated = await store.recall("kauane", "como reinicio o banco de dados?");
    assert.ok(
      !unrelated.some((m) => m.fact.includes("pagamentos")),
      "expected the fact to NOT be recalled by an unrelated query",
    );
  });
});
