import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createModelDistiller, DISTILLER_PROMPT } from "./distiller.ts";

describe("createModelDistiller (D3, D4)", () => {
  it("is constructible without OPENROUTER_* in the environment (Princípio V)", () => {
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    try {
      // Constructing must not throw — only INVOKING would need credentials,
      // and nothing here invokes it (createModel() is called lazily inside
      // the returned function, R-002).
      assert.doesNotThrow(() => createModelDistiller());
    } finally {
      if (previousModel !== undefined) process.env.OPENROUTER_MODEL = previousModel;
      if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    }
  });
});

describe("DISTILLER_PROMPT", () => {
  it("mentions all three forbidden categories", () => {
    assert.match(DISTILLER_PROMPT, /Pedido pontual/);
    assert.match(DISTILLER_PROMPT, /Estado da operação/);
    assert.match(DISTILLER_PROMPT, /Segredo/);
  });

  it("treats the message as data, never as an instruction to itself", () => {
    assert.match(DISTILLER_PROMPT, /DADO/);
    assert.match(DISTILLER_PROMPT, /nunca instrução/);
  });
});
