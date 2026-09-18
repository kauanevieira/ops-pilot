import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { availableStrategyNames, createStrategy } from "./registry.ts";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { baselineState } from "../store/seed.ts";

// Building a strategy only wires up the object; no model call happens until
// `.run()` is invoked, so this stays offline (unlike running the strategy).

describe("registry", () => {
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
