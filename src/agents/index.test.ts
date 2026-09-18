import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  availableStrategyNames,
  baseStrategyNames,
  createStrategy,
  resolveStrategy,
  UnknownStrategyError,
} from "./index.ts";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { baselineState } from "../store/seed.ts";

// Building a strategy only wires up the object; no model call happens until
// `.run()` is invoked, so this stays offline (unlike running the strategy).

describe("registry (arena surface)", () => {
  it("exposes the two base strategies and their reflected versions (FR-024)", () => {
    assert.deepEqual(
      new Set(availableStrategyNames()),
      new Set(["react", "plan-and-execute", "reflect:react", "reflect:plan-and-execute"]),
    );
  });

  it("lists all four valid names in the error for an unknown strategy (FR-025)", () => {
    const store = new InMemoryOpsRepository(baselineState());
    assert.throws(
      () => createStrategy("reflect:nao-existe", store),
      /reflect:react.*reflect:plan-and-execute|plan-and-execute.*reflect:react/,
    );
  });

  it("the reflected strategy reports the derived name (FR-003)", () => {
    const store = new InMemoryOpsRepository(baselineState());
    const strategy = createStrategy("reflect:react", store);
    assert.equal(strategy.name, "reflect:react");
  });
});

describe("registry (HTTP surface — 003-chat-http-api)", () => {
  it("baseStrategyNames() exposes only the two raw names, never the reflect:* derived ones", () => {
    assert.deepEqual(baseStrategyNames(), ["react", "plan-and-execute"]);
  });

  it("resolveStrategy({}, store) defaults to react (FR-007)", () => {
    const store = new InMemoryOpsRepository(baselineState());
    const strategy = resolveStrategy({}, store);
    assert.equal(strategy.name, "react");
  });

  it("resolveStrategy({ name, reflect: true }, store) applies withReflection over the base (FR-010)", () => {
    const store = new InMemoryOpsRepository(baselineState());
    const strategy = resolveStrategy({ name: "react", reflect: true }, store);
    assert.equal(strategy.name, "reflect:react");
  });

  it("resolveStrategy rejects composite names like reflect:react — reflection is the `reflect` field, not a name prefix", () => {
    const store = new InMemoryOpsRepository(baselineState());
    assert.throws(() => resolveStrategy({ name: "reflect:react" }, store), UnknownStrategyError);
  });

  it("resolveStrategy with an unknown name lists baseStrategyNames(), not the 4-name arena list (FR-011, FR-015)", () => {
    const store = new InMemoryOpsRepository(baselineState());
    try {
      resolveStrategy({ name: "planner" }, store);
      assert.fail("expected resolveStrategy to throw");
    } catch (error) {
      assert.ok(error instanceof UnknownStrategyError);
      assert.deepEqual(error.validStrategies, baseStrategyNames());
    }
  });

  it("every base strategy resolves with and without reflect, deriving the expected reported name (SC-002, SC-008)", () => {
    const store = new InMemoryOpsRepository(baselineState());
    for (const name of baseStrategyNames()) {
      assert.equal(resolveStrategy({ name }, store).name, name);
      assert.equal(resolveStrategy({ name, reflect: true }, store).name, `reflect:${name}`);
    }
  });
});
