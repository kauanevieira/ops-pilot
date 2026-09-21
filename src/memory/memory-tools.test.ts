import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { defineMemoryTools, createMemoryTools } from "./memory-tools.ts";
import { SqliteMemoryStore } from "./memory-store.ts";
import { createTableEmbedder, queryVector, axisVector } from "./table-embedder.ts";

function storeFor(table: Record<string, Float32Array>) {
  const db = new DatabaseSync(":memory:");
  return new SqliteMemoryStore(db, createTableEmbedder(table));
}

// --- Definitions: the 6 rules + userId never a schema field ----------------

describe("defineMemoryTools — descriptions and schemas", () => {
  it("remember_fact: imperative opening, says when to use/not use, and describes the return incl. created:false", () => {
    const store = storeFor({ "sou responsável pelo checkout": queryVector() });
    const { remember_fact } = defineMemoryTools(store, "kauane");

    assert.match(remember_fact.description, /^Guarda um fato duradouro/);
    assert.match(remember_fact.description, /Use quando/i);
    assert.match(remember_fact.description, /NÃO use/);
    assert.match(remember_fact.description, /created: false/);
    assert.deepEqual(Object.keys(remember_fact.schema.shape), ["fact"]);
    assert.ok(remember_fact.schema.shape.fact.description, "fact must have a .describe()");
    assert.ok(!("userId" in remember_fact.schema.shape), "userId must never be a schema field");
  });

  it("forget_fact: imperative opening, explains where memoryId comes from, and the not-found case", () => {
    const store = storeFor({});
    const { forget_fact } = defineMemoryTools(store, "kauane");

    assert.match(forget_fact.description, /^Apaga um fato lembrado/);
    assert.match(forget_fact.description, /Fatos lembrados/);
    assert.match(forget_fact.description, /forgotten: false/);
    assert.deepEqual(Object.keys(forget_fact.schema.shape), ["memoryId"]);
    assert.ok(forget_fact.schema.shape.memoryId.description, "memoryId must have a .describe()");
    assert.ok(!("userId" in forget_fact.schema.shape), "userId must never be a schema field");
  });

  it("fact accepts at most 500 characters (FR-012)", () => {
    const store = storeFor({});
    const { remember_fact } = defineMemoryTools(store, "kauane");
    const tooLong = "a".repeat(501);
    assert.equal(remember_fact.schema.safeParse({ fact: tooLong }).success, false);
    assert.equal(remember_fact.schema.safeParse({ fact: "a".repeat(500) }).success, true);
  });
});

// --- Execution scoped to the closed-over userId ----------------------------

describe("remember_fact / forget_fact — execution scoped to userId", () => {
  it("remember_fact writes for the userId the tool was built with", async () => {
    const store = storeFor({ "sou responsável pelo checkout": queryVector() });
    const { remember_fact } = defineMemoryTools(store, "kauane");

    const outcome = await remember_fact.run({ fact: "sou responsável pelo checkout" });
    const body = JSON.parse(outcome.text);
    assert.equal(body.created, true);
    assert.ok(body.memoryId.startsWith("mem-"));

    const recalled = await store.recall("kauane", "sou responsável pelo checkout");
    assert.equal(recalled.length, 1);
    const recalledByOther = await store.recall("outro-usuario", "sou responsável pelo checkout");
    assert.equal(recalledByOther.length, 0);
  });

  it("remember_fact reports created:false and the existing fact on duplicate", async () => {
    const store = storeFor({
      "sou responsável pelo checkout": queryVector(),
      "eu cuido do checkout": axisVector(0.95, 1),
    });
    const { remember_fact } = defineMemoryTools(store, "kauane");

    await remember_fact.run({ fact: "sou responsável pelo checkout" });
    const second = await remember_fact.run({ fact: "eu cuido do checkout" });
    const body = JSON.parse(second.text);
    assert.equal(body.created, false);
    assert.equal(body.fact, "sou responsável pelo checkout");
  });

  it("forget_fact deletes only within the userId it was built with (FR-018)", async () => {
    const store = storeFor({ "fato de A": queryVector() });
    const memoryId = (await store.remember("user-a", "fato de A")).memoryId;

    const toolsForB = defineMemoryTools(store, "user-b");
    const outcomeB = await toolsForB.forget_fact.run({ memoryId });
    assert.deepEqual(JSON.parse(outcomeB.text), { forgotten: false });
    assert.equal(outcomeB.isError, true);

    const toolsForA = defineMemoryTools(store, "user-a");
    const outcomeA = await toolsForA.forget_fact.run({ memoryId });
    assert.deepEqual(JSON.parse(outcomeA.text), { forgotten: true });
    assert.equal(outcomeA.isError, false);
  });

  it("forget_fact on an unknown id returns forgotten:false without throwing", async () => {
    const store = storeFor({});
    const { forget_fact } = defineMemoryTools(store, "kauane");
    const outcome = await forget_fact.run({ memoryId: "mem-does-not-exist" });
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
  it("exposes remember_fact and forget_fact with matching names, invokable and returning plain text", async () => {
    const store = storeFor({ "sou responsável pelo checkout": queryVector() });
    const tools = createMemoryTools(store, "kauane") as unknown as TestableTool[];

    assert.deepEqual(
      tools.map((t) => t.name),
      ["remember_fact", "forget_fact"],
    );

    const remembered = tools.find((t) => t.name === "remember_fact")!;
    const result = await remembered.invoke({ fact: "sou responsável pelo checkout" });
    assert.equal(typeof result, "string");
    assert.match(result, /"created":true/);
  });
});
