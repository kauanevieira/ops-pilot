import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { defineMemoryTools, createMemoryTools } from "./memory-tools.ts";
import { SqliteMemoryStore } from "./memory-store.ts";
import { createTableEmbedder, queryVector } from "./table-embedder.ts";

function storeFor(table: Record<string, Float32Array>) {
  const db = new DatabaseSync(":memory:");
  return new SqliteMemoryStore(db, createTableEmbedder(table));
}

// --- Definitions: the 6 rules + userId never a schema field ----------------

describe("defineMemoryTools — only forget_preference (009, FR-016/FR-017)", () => {
  it("defineMemoryTools returns exactly the forget_preference key", () => {
    const store = storeFor({});
    const tools = defineMemoryTools(store, "kauane");
    assert.deepEqual(Object.keys(tools), ["forget_preference"]);
  });

  it("forget_preference: imperative opening, explains where memoryId comes from, the not-found case, and that saving is automatic (FR-018)", () => {
    const store = storeFor({});
    const { forget_preference } = defineMemoryTools(store, "kauane");

    assert.match(forget_preference.description, /^Apaga um fato lembrado/);
    assert.match(forget_preference.description, /Fatos lembrados/);
    assert.match(forget_preference.description, /forgotten: false/);
    assert.match(forget_preference.description, /automático/);
    assert.doesNotMatch(forget_preference.description, /remember_fact/);
    assert.doesNotMatch(forget_preference.description, /forget_fact/);
    assert.deepEqual(Object.keys(forget_preference.schema.shape), ["memoryId"]);
    assert.ok(forget_preference.schema.shape.memoryId.description, "memoryId must have a .describe()");
    assert.ok(!("userId" in forget_preference.schema.shape), "userId must never be a schema field");
  });
});

// --- Execution scoped to the closed-over userId ----------------------------

describe("forget_preference — execution scoped to userId", () => {
  it("deletes only within the userId it was built with (FR-018, from 008)", async () => {
    const store = storeFor({ "fato de A": queryVector() });
    const memoryId = (await store.remember("user-a", "fato de A")).memoryId;

    const toolsForB = defineMemoryTools(store, "user-b");
    const outcomeB = await toolsForB.forget_preference.run({ memoryId });
    assert.deepEqual(JSON.parse(outcomeB.text), { forgotten: false });
    assert.equal(outcomeB.isError, true);

    const toolsForA = defineMemoryTools(store, "user-a");
    const outcomeA = await toolsForA.forget_preference.run({ memoryId });
    assert.deepEqual(JSON.parse(outcomeA.text), { forgotten: true });
    assert.equal(outcomeA.isError, false);
  });

  it("on an unknown id returns forgotten:false without throwing", async () => {
    const store = storeFor({});
    const { forget_preference } = defineMemoryTools(store, "kauane");
    const outcome = await forget_preference.run({ memoryId: "mem-does-not-exist" });
    assert.deepEqual(JSON.parse(outcome.text), { forgotten: false });
  });
});

// --- LangChain adapter ------------------------------------------------------

interface TestableTool {
  name: string;
  description: string;
  invoke(input: Record<string, unknown>): Promise<string>;
}

describe("createMemoryTools (LangChain adapter)", () => {
  it("exposes exactly forget_preference, invokable and returning plain text", async () => {
    const store = storeFor({ "fato de A": queryVector() });
    const memoryId = (await store.remember("kauane", "fato de A")).memoryId;
    const tools = createMemoryTools(store, "kauane") as unknown as TestableTool[];

    assert.deepEqual(
      tools.map((t) => t.name),
      ["forget_preference"],
    );

    const result = await tools[0]!.invoke({ memoryId });
    assert.equal(typeof result, "string");
    assert.match(result, /"forgotten":true/);
  });
});
