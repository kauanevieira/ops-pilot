import { describe, expect, it } from "vitest";
import type { ChatResponseWire } from "@domain/wire.ts";
import {
  canSend,
  conversationReducer,
  initialConversation,
  type ConversationState,
} from "./conversation.ts";

const RESULT: ChatResponseWire = {
  answer: "ok",
  trace: [],
  metrics: { llmCalls: 1, latencyMs: 5 },
  stoppedReason: "completed",
  conversationId: "c1",
  requestId: "r1",
};

const AT = "2026-10-07T12:00:00.000Z";

function after(state: ConversationState, ...actions: Parameters<typeof conversationReducer>[1][]) {
  return actions.reduce(conversationReducer, state);
}

describe("conversationReducer (US1)", () => {
  it("send adds the user item and turns inFlight on", () => {
    const state = after(initialConversation, { type: "send", id: "u1", text: "oi", at: AT });
    expect(state.items).toEqual([{ kind: "user", id: "u1", text: "oi", at: AT }]);
    expect(state.inFlight).toBe(true);
  });

  it("send is ignored when canSend is false", () => {
    const busy = after(initialConversation, { type: "send", id: "u1", text: "oi", at: AT });
    const again = conversationReducer(busy, { type: "send", id: "u2", text: "de novo", at: AT });
    expect(again).toBe(busy);
  });

  it("answered adds the answer, keeps the conversationId and turns inFlight off", () => {
    const state = after(
      initialConversation,
      { type: "send", id: "u1", text: "oi", at: AT },
      { type: "answered", id: "a1", result: RESULT, at: AT },
    );
    expect(state.conversationId).toBe("c1");
    expect(state.inFlight).toBe(false);
    expect(state.items[1]).toEqual({ kind: "answer", id: "a1", result: RESULT, at: AT });
    expect(canSend(state)).toBe(true);
  });

  it("failed adds an error item with the text to retry", () => {
    const error = { kind: "unreachable" as const, message: "sem API", url: "http://h" };
    const state = after(
      initialConversation,
      { type: "send", id: "u1", text: "oi", at: AT },
      { type: "failed", id: "e1", error, retryText: "oi", at: AT },
    );
    expect(state.inFlight).toBe(false);
    expect(state.items[1]).toEqual({ kind: "error", id: "e1", error, retryText: "oi", at: AT });
    expect(state.conversationId).toBeNull();
  });

  it("reset returns to the initial state", () => {
    const state = after(
      initialConversation,
      { type: "send", id: "u1", text: "oi", at: AT },
      { type: "answered", id: "a1", result: RESULT, at: AT },
      { type: "reset" },
    );
    expect(state).toEqual(initialConversation);
  });

  it("does not mutate the state it receives", () => {
    const before = after(initialConversation, { type: "send", id: "u1", text: "oi", at: AT });
    const snapshot = structuredClone(before);
    conversationReducer(before, { type: "answered", id: "a1", result: RESULT, at: AT });
    conversationReducer(before, { type: "reset" });
    expect(before).toEqual(snapshot);
  });
});
