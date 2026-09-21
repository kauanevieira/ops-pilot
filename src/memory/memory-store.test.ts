import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEDUP_THRESHOLD,
  RECALL_MIN_SCORE,
  RECALL_LIMIT,
  SqliteMemoryStore,
  isDuplicateScore,
  isRecallable,
} from "./memory-store.ts";
import { axisVector, createTableEmbedder, queryVector, unitVector } from "./table-embedder.ts";

// --- M2/M5 boundary semantics, tested as pure predicates ---------------
//
// Deliberately NOT tested by constructing a vector whose score is
// "exactly" 0.92 or 0.3 through the embedder: a stored embedding is
// Float32, and float32(0.92) as a double is 0.9200000166893005 (verified
// against the runtime) — always slightly ABOVE the float64 literal 0.92.
// Any such vector would read back as a duplicate regardless of which
// comparison operator memory-store.ts used, so it would test float32
// rounding, not the `>`/`>=` decision. These pure functions are exactly
// that decision, isolated from storage.

describe("isDuplicateScore / isRecallable (M2, M5 — exact boundary)", () => {
  it("M2: a score exactly AT the dedup threshold is NOT a duplicate (strict >)", () => {
    assert.equal(isDuplicateScore(DEDUP_THRESHOLD), false);
  });

  it("M2: a score just above the dedup threshold IS a duplicate", () => {
    assert.equal(isDuplicateScore(DEDUP_THRESHOLD + Number.EPSILON * 100), true);
  });

  it("M5: a score exactly AT the recall minimum IS recallable (inclusive >=)", () => {
    assert.equal(isRecallable(RECALL_MIN_SCORE), true);
  });

  it("M5: a score just below the recall minimum is NOT recallable", () => {
    assert.equal(isRecallable(RECALL_MIN_SCORE - Number.EPSILON * 100), false);
  });
});

/**
 * Builds an Embedder from {text: angle} pairs (contracts/memory-store.md).
 * Two texts at angles a1/a2 have an EXACT dot product of cos(a1 - a2) — see
 * table-embedder.ts — which is what lets these tests assert exact scores
 * at the threshold boundaries (0.92, 0.3) instead of approximate ones.
 */
function angledEmbedder(pairs: Record<string, number>) {
  return createTableEmbedder(Object.fromEntries(Object.entries(pairs).map(([text, angle]) => [text, unitVector(angle)])));
}

const ANGLE_FOR_SCORE = (score: number) => Math.acos(score);

function freshStore(pairs: Record<string, number>) {
  const db = new DatabaseSync(":memory:");
  return new SqliteMemoryStore(db, angledEmbedder(pairs));
}

/**
 * For tests with 3+ candidate facts: each fact gets an independent score
 * to "query" (axisVector(1, 0)) via its own axis, so facts don't
 * accidentally dedup against EACH OTHER just for having close scores to
 * the same query (table-embedder.ts, axisVector).
 */
function axisStore(entries: [text: string, score: number][]) {
  const table: Record<string, Float32Array> = { query: queryVector() };
  entries.forEach(([text, score], index) => {
    table[text] = axisVector(score, index + 1);
  });
  const db = new DatabaseSync(":memory:");
  return new SqliteMemoryStore(db, createTableEmbedder(table));
}

// --- M1/M2: remember + dedup -------------------------------------------

describe("remember (M1, M2)", () => {
  it("M1: a new fact is created, stored verbatim, with a mem- id", async () => {
    const store = freshStore({ "sou responsável pelo checkout": 0 });
    const result = await store.remember("kauane", "sou responsável pelo checkout");
    assert.equal(result.created, true);
    assert.equal(result.fact, "sou responsável pelo checkout");
    assert.ok(result.memoryId.startsWith("mem-"));
  });

  it("M1: a fact with score strictly greater than 0.92 is a duplicate — nothing new is created", async () => {
    const dupAngle = ANGLE_FOR_SCORE(0.95);
    const store = freshStore({
      "sou responsável pelo checkout": 0,
      "eu cuido do checkout": dupAngle,
    });
    const first = await store.remember("kauane", "sou responsável pelo checkout");
    const second = await store.remember("kauane", "eu cuido do checkout");

    assert.equal(second.created, false);
    assert.equal(second.memoryId, first.memoryId);
    assert.equal(second.fact, first.fact); // the EXISTING text, not the new one

    const recalled = await store.recall("kauane", "sou responsável pelo checkout");
    assert.equal(recalled.length, 1); // only the first was ever stored
  });

  it("M2: a score comfortably below the dedup threshold is not a duplicate (store-level integration)", async () => {
    const belowAngle = ANGLE_FOR_SCORE(0.85);
    const store = freshStore({
      "sou responsável pelo checkout": 0,
      "eu cuido do checkout": belowAngle,
    });
    await store.remember("kauane", "sou responsável pelo checkout");
    const second = await store.remember("kauane", "eu cuido do checkout");

    assert.equal(second.created, true);
    const recalled = await store.recall("kauane", "sou responsável pelo checkout");
    assert.equal(recalled.length, 2);
  });

  it("M3: a duplicate for one user does not block the same fact for another user", async () => {
    const store = freshStore({ "sou responsável pelo checkout": 0 });
    const a = await store.remember("user-a", "sou responsável pelo checkout");
    const b = await store.remember("user-b", "sou responsável pelo checkout");

    assert.equal(a.created, true);
    assert.equal(b.created, true);
    assert.notEqual(a.memoryId, b.memoryId);
  });
});

// --- M4-M8: recall -------------------------------------------------------

describe("recall (M4-M8)", () => {
  it("M4: returns at most RECALL_LIMIT, ordered by score descending", async () => {
    const store = axisStore([
      ["fato 1", 0.9],
      ["fato 2", 0.8],
      ["fato 3", 0.7],
      ["fato 4", 0.6],
      ["fato 5", 0.5],
    ]);
    for (const fact of ["fato 5", "fato 3", "fato 1", "fato 4", "fato 2"]) {
      await store.remember("kauane", fact);
    }

    const recalled = await store.recall("kauane", "query");
    assert.equal(recalled.length, RECALL_LIMIT);
    assert.deepEqual(
      recalled.map((m) => m.fact),
      ["fato 1", "fato 2", "fato 3"],
    );
    assert.ok(recalled[0]!.score > recalled[1]!.score);
    assert.ok(recalled[1]!.score > recalled[2]!.score);
  });

  it("M5: excludes score strictly below 0.3, includes score exactly 0.3", async () => {
    const store = freshStore({
      query: 0,
      exato: ANGLE_FOR_SCORE(RECALL_MIN_SCORE),
      abaixo: ANGLE_FOR_SCORE(RECALL_MIN_SCORE - 0.05),
    });
    await store.remember("kauane", "exato");
    await store.remember("kauane", "abaixo");

    const recalled = await store.recall("kauane", "query");
    assert.deepEqual(
      recalled.map((m) => m.fact),
      ["exato"],
    );
  });

  it("M4/M5: filters BEFORE capping — a 4th+ relevant fact is not dropped in favor of a sub-threshold one", async () => {
    // Regression for the naive "slice(0, k).filter(score > min)" order,
    // which can silently return fewer than 3 facts even when 3+ qualify.
    const store = axisStore([
      ["relevante1", 0.9],
      ["relevante2", 0.8],
      ["relevante3", 0.7],
      ["relevante4", 0.6],
      ["irrelevante", 0.1],
    ]);
    for (const fact of ["irrelevante", "relevante4", "relevante3", "relevante2", "relevante1"]) {
      await store.remember("kauane", fact);
    }

    const recalled = await store.recall("kauane", "query");
    assert.equal(recalled.length, 3);
    assert.ok(!recalled.some((m) => m.fact === "irrelevante"));
  });

  it("M6: ties in score break by recency — the most recently stored fact comes first", async () => {
    const store = axisStore([
      ["fato antigo", 0.5],
      ["fato novo", 0.5],
    ]);
    await store.remember("kauane", "fato antigo");
    await store.remember("kauane", "fato novo");

    const recalled = await store.recall("kauane", "query");
    assert.deepEqual(
      recalled.map((m) => m.fact),
      ["fato novo", "fato antigo"],
    );
  });

  it("M7: a user with no memories recalls []", async () => {
    const store = freshStore({ query: 0 });
    assert.deepEqual(await store.recall("ninguem-guardou-nada", "query"), []);
  });

  it("M8: recall never returns another user's facts", async () => {
    const store = freshStore({ query: 0, "fato de A": 0 });
    await store.remember("user-a", "fato de A");
    assert.deepEqual(await store.recall("user-b", "query"), []);
  });
});

// --- M9/M10: forget --------------------------------------------------------

describe("forget (M9, M10)", () => {
  it("M9: forgetting one's own fact returns true, and it's gone from recall", async () => {
    const store = freshStore({ query: 0, "sou responsável pelo checkout": 0 });
    const { memoryId } = await store.remember("kauane", "sou responsável pelo checkout");

    assert.equal(store.forget("kauane", memoryId), true);
    assert.deepEqual(await store.recall("kauane", "query"), []);
  });

  it("M10: forgetting an unknown id returns false, nothing deleted", async () => {
    const store = freshStore({ query: 0 });
    assert.equal(store.forget("kauane", "mem-does-not-exist"), false);
  });

  it("M10: forgetting an already-forgotten id returns false", async () => {
    const store = freshStore({ "sou responsável pelo checkout": 0 });
    const { memoryId } = await store.remember("kauane", "sou responsável pelo checkout");
    assert.equal(store.forget("kauane", memoryId), true);
    assert.equal(store.forget("kauane", memoryId), false);
  });

  it("M10: forgetting another user's fact returns false, and it's untouched", async () => {
    const store = freshStore({ query: 0, "fato de A": 0 });
    const { memoryId } = await store.remember("user-a", "fato de A");

    assert.equal(store.forget("user-b", memoryId), false);
    assert.equal((await store.recall("user-a", "query")).length, 1);
  });
});

// --- M11: atomic dedup under concurrency -----------------------------------

describe("dedup under concurrency (M11, R-009)", () => {
  it("two concurrent remember() calls with the identical fact create only one memory", async () => {
    const store = freshStore({ "sou responsável pelo checkout": 0 });
    const [a, b] = await Promise.all([
      store.remember("kauane", "sou responsável pelo checkout"),
      store.remember("kauane", "sou responsável pelo checkout"),
    ]);

    const createdCount = [a.created, b.created].filter(Boolean).length;
    assert.equal(createdCount, 1);
    assert.equal(a.memoryId, b.memoryId);

    const recalled = await store.recall("kauane", "sou responsável pelo checkout");
    assert.equal(recalled.length, 1);
  });
});

// --- M13: database CHECK on embedding size ---------------------------------

describe("restrição de tamanho do vetor no banco (M13)", () => {
  it("rejects a BLOB whose length isn't EMBEDDING_DIM * 4 bytes, even inserted directly", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteMemoryStore(db, angledEmbedder({}));
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO memories (id, user_id, fact, embedding, created_at) VALUES (?,?,?,?,?)")
          .run("mem-x", "kauane", "fato", new Uint8Array(10), new Date().toISOString()),
      /CHECK constraint failed/,
    );
  });
});

// --- M12: persistence across connections -----------------------------------

describe("persistência entre aberturas de conexão (M12, FR-004)", () => {
  it("what one connection writes, another connection over the same file reads back, vectors intact", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "opspilot-memory-test-"));
    const dbPath = path.join(dir, "test.db");
    try {
      const embedder = angledEmbedder({ query: 0, "sou responsável pelo checkout": 0 });
      const db1 = new DatabaseSync(dbPath);
      const store1 = new SqliteMemoryStore(db1, embedder);
      await store1.remember("kauane", "sou responsável pelo checkout");
      db1.close();

      const db2 = new DatabaseSync(dbPath);
      const store2 = new SqliteMemoryStore(db2, embedder);
      const recalled = await store2.recall("kauane", "query");
      assert.equal(recalled.length, 1);
      assert.equal(recalled[0]!.fact, "sou responsável pelo checkout");
      assert.ok(Math.abs(recalled[0]!.score - 1) < 1e-6);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reopening an already-structured database does not fail and does not lose data", async () => {
    const db = new DatabaseSync(":memory:");
    const embedder = angledEmbedder({ query: 0, "sou responsável pelo checkout": 0 });
    const store = new SqliteMemoryStore(db, embedder);
    await store.remember("kauane", "sou responsável pelo checkout");

    assert.doesNotThrow(() => new SqliteMemoryStore(db, embedder));
    assert.equal((await store.recall("kauane", "query")).length, 1);
  });
});
