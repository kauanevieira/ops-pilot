import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toErrorBody, zodIssuesToDetails } from "./errors.ts";

describe("toErrorBody", () => {
  it("omits `details` entirely when not given", () => {
    const body = toErrorBody("timeout", "A execução excedeu o tempo limite.");
    assert.deepEqual(body, { error: { code: "timeout", message: "A execução excedeu o tempo limite." } });
    assert.equal("details" in body.error, false);
  });

  it("preserves `details` when given", () => {
    const body = toErrorBody("unknown_strategy", "Estratégia desconhecida.", {
      validStrategies: ["react", "plan-and-execute"],
    });
    assert.deepEqual(body.error.details, { validStrategies: ["react", "plan-and-execute"] });
  });

  it("never carries `details` for timeout or internal — nothing internal leaks (FR-017)", () => {
    assert.equal("details" in toErrorBody("timeout", "x").error, false);
    assert.equal("details" in toErrorBody("internal", "x").error, false);
  });
});

describe("zodIssuesToDetails", () => {
  it("maps a nested path to a dot-joined string", () => {
    const schema = z.object({ a: z.object({ b: z.string().min(1) }) });
    const result = schema.safeParse({ a: { b: "" } });
    assert.equal(result.success, false);
    if (result.success) return;
    const details = zodIssuesToDetails(result.error.issues);
    assert.equal(details.length, 1);
    assert.equal(details[0]?.path, "a.b");
    assert.equal(details[0]?.code, "too_small");
    assert.equal(typeof details[0]?.message, "string");
  });

  it("maps a top-level field to its own name", () => {
    const schema = z.object({ message: z.string().min(1) });
    const result = schema.safeParse({ message: "" });
    assert.equal(result.success, false);
    if (result.success) return;
    const details = zodIssuesToDetails(result.error.issues);
    assert.equal(details[0]?.path, "message");
  });
});
