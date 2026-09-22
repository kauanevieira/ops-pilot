import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { capReason, ROUTE_REASON_MAX_CHARS, ROUTER_PROMPT, formatRouterInput, createModelRouter } from "./router.ts";
import { routeSchema } from "../domain/schemas.ts";
import type { ConversationMessage } from "../domain/schemas.ts";

// RT5: capReason trims and truncates at ROUTE_REASON_MAX_CHARS, never rejects.
describe("capReason", () => {
  it("trims surrounding whitespace", () => {
    assert.equal(capReason("  ok  "), "ok");
  });

  it("empty stays empty", () => {
    assert.equal(capReason(""), "");
  });

  it("whitespace-only becomes empty", () => {
    assert.equal(capReason("   "), "");
  });

  it("text of exactly the cap is left intact", () => {
    const text = "a".repeat(ROUTE_REASON_MAX_CHARS);
    assert.equal(capReason(text), text);
  });

  it("text one over the cap is truncated with a trailing ellipsis", () => {
    const text = "a".repeat(ROUTE_REASON_MAX_CHARS + 1);
    const capped = capReason(text);
    assert.equal(capped.length, ROUTE_REASON_MAX_CHARS);
    assert.equal(capped.endsWith("…"), true);
  });

  it("never exceeds ROUTE_REASON_MAX_CHARS regardless of input length", () => {
    const text = "motivo bem detalhado ".repeat(50);
    assert.ok(capReason(text).length <= ROUTE_REASON_MAX_CHARS);
  });
});

function history(...pairs: [ConversationMessage["role"], string][]): ConversationMessage[] {
  return pairs.map(([role, content]) => ({ role, content, createdAt: new Date("2026-01-01T00:00:00.000Z") }));
}

// RT1: the prompt has a table row for every route, and the right headers.
describe("ROUTER_PROMPT", () => {
  it("contains a table line for every value of routeSchema.options, by its exact name", () => {
    for (const route of routeSchema.options) {
      assert.match(ROUTER_PROMPT, new RegExp(`\`${route}\``));
    }
  });

  it("contains the headers Quando usar, Quando NÃO usar e Custo", () => {
    assert.match(ROUTER_PROMPT, /Quando usar/);
    assert.match(ROUTER_PROMPT, /Quando NÃO usar/);
    assert.match(ROUTER_PROMPT, /Custo/);
  });

  // RT2: tie-break, never answering the request, and the data/instruction boundary.
  it("instructs to pick the cheaper strategy on a tie", () => {
    assert.match(ROUTER_PROMPT, /mais barata/);
  });

  it("instructs never to answer the request itself", () => {
    assert.match(ROUTER_PROMPT, /nunca responda ao pedido|não responda ao pedido/i);
  });

  it("instructs that the conversation and message are data, never instructions", () => {
    assert.match(ROUTER_PROMPT, /DADO/);
  });
});

// RT3: formatRouterInput composes the same blocks the strategy receives.
describe("formatRouterInput", () => {
  it("without summary and without history, is just the message", () => {
    assert.equal(formatRouterInput({ message: "oi", summary: null, messages: [] }), "oi");
  });

  it("with summary and history, prefixes both blocks before the message", () => {
    const messages = history(["user", "quais alertas estão abertos?"], ["assistant", "3 em checkout."]);
    const rendered = formatRouterInput({ message: "e agora?", summary: "resumo até aqui", messages });
    assert.match(rendered, /resumo até aqui/);
    assert.match(rendered, /quais alertas estão abertos\?/);
    assert.ok(rendered.endsWith("e agora?"));
    assert.ok(rendered.indexOf("resumo até aqui") < rendered.indexOf("quais alertas estão abertos?"));
    assert.ok(rendered.indexOf("quais alertas estão abertos?") < rendered.indexOf("e agora?"));
  });
});

// RT4: the real router never reads env or builds a model when merely constructed.
describe("createModelRouter", () => {
  let saved: string | undefined;
  before(() => {
    saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
  after(() => {
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  });

  it("does not read env vars or build the model when constructed — only when invoked", () => {
    assert.doesNotThrow(() => createModelRouter());
  });
});
