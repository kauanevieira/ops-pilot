import { describe, expect, it } from "vitest";
import type { ChatAccepted, ChatResponseWire } from "@domain/wire.ts";
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

// --- US3: approval card (data-model.md, contracts/approval-flow.md) -----------

const ACCEPTED: ChatAccepted = {
  status: "pending_approval",
  requestId: "r2",
  conversationId: "c1",
  approval: { id: "ap-1", tool: "resolve_incident", args: { incidentId: "INC-42" }, description: "Resolver INC-42" },
};

const ACCEPTED_2: ChatAccepted = { ...ACCEPTED, approval: { ...ACCEPTED.approval, id: "ap-2" } };

function pendingState(): ConversationState {
  return after(
    initialConversation,
    { type: "send", id: "u1", text: "resolve", at: AT },
    { type: "pending", id: "p1", accepted: ACCEPTED, at: AT },
  );
}

function approval(state: ConversationState, id = "p1") {
  const item = state.items.find((i) => i.id === id);
  if (item?.kind !== "approval") throw new Error("not an approval item");
  return item;
}

describe("conversationReducer (US3)", () => {
  it("pending adds a pending card, keeps the conversationId and blocks sending", () => {
    const state = pendingState();
    expect(approval(state).state).toEqual({ status: "pending" });
    expect(approval(state).pending).toEqual(ACCEPTED);
    expect(state.conversationId).toBe("c1");
    expect(state.inFlight).toBe(false);
    expect(canSend(state)).toBe(false);
  });

  it("decide moves pending to deciding, once", () => {
    const deciding = conversationReducer(pendingState(), { type: "decide", itemId: "p1", decision: "approve" });
    expect(approval(deciding).state).toEqual({ status: "deciding", decision: "approve" });
    expect(deciding.inFlight).toBe(true);
    // a second decision (even the opposite one) is ignored — SC-004
    const again = conversationReducer(deciding, { type: "decide", itemId: "p1", decision: "deny" });
    expect(again).toBe(deciding);
  });

  it("decide on an unknown item or a non-approval item is ignored", () => {
    const state = pendingState();
    expect(conversationReducer(state, { type: "decide", itemId: "nao-existe", decision: "approve" })).toBe(state);
    expect(conversationReducer(state, { type: "decide", itemId: "u1", decision: "approve" })).toBe(state);
  });

  it("approved: the card is approved and the final answer follows as a normal answer", () => {
    const state = after(
      pendingState(),
      { type: "decide", itemId: "p1", decision: "approve" },
      {
        type: "decided",
        itemId: "p1",
        outcome: { kind: "approved", next: { kind: "answer", id: "a1", result: RESULT, at: AT } },
      },
    );
    expect(approval(state).state).toEqual({ status: "approved" });
    expect(state.items.at(-1)).toEqual({ kind: "answer", id: "a1", result: RESULT, at: AT });
    expect(state.inFlight).toBe(false);
    expect(canSend(state)).toBe(true);
  });

  it("approved with another 202: the old card is approved and a new pending card appears", () => {
    const state = after(
      pendingState(),
      { type: "decide", itemId: "p1", decision: "approve" },
      {
        type: "decided",
        itemId: "p1",
        outcome: { kind: "approved", next: { kind: "approval", id: "p2", accepted: ACCEPTED_2, at: AT } },
      },
    );
    expect(approval(state, "p1").state).toEqual({ status: "approved" });
    expect(approval(state, "p2").state).toEqual({ status: "pending" });
    expect(canSend(state)).toBe(false);
  });

  it("denied: the card shows denied and the conversation accepts messages again", () => {
    const state = after(
      pendingState(),
      { type: "decide", itemId: "p1", decision: "deny" },
      { type: "decided", itemId: "p1", outcome: { kind: "denied" } },
    );
    expect(approval(state).state).toEqual({ status: "denied" });
    expect(state.items.at(-1)?.kind).toBe("approval");
    expect(canSend(state)).toBe(true);
  });

  it("rejected: the card closes with the reason (FR-015)", () => {
    const state = after(
      pendingState(),
      { type: "decide", itemId: "p1", decision: "approve" },
      { type: "decided", itemId: "p1", outcome: { kind: "rejected", reason: "Já decidida" } },
    );
    expect(approval(state).state).toEqual({ status: "rejected", reason: "Já decidida" });
    expect(canSend(state)).toBe(true);
  });

  it("no final state ever changes again (SC-004)", () => {
    const denied = after(
      pendingState(),
      { type: "decide", itemId: "p1", decision: "deny" },
      { type: "decided", itemId: "p1", outcome: { kind: "denied" } },
    );
    expect(conversationReducer(denied, { type: "decide", itemId: "p1", decision: "approve" })).toBe(denied);
    expect(
      conversationReducer(denied, {
        type: "decided",
        itemId: "p1",
        outcome: { kind: "approved", next: { kind: "answer", id: "a9", result: RESULT, at: AT } },
      }),
    ).toBe(denied);
  });

  it("decided only applies to a card that is deciding", () => {
    const state = pendingState();
    expect(conversationReducer(state, { type: "decided", itemId: "p1", outcome: { kind: "denied" } })).toBe(state);
  });

  it("decisionFailed goes back to pending and appends an error right after", () => {
    const error = { kind: "unreachable" as const, message: "sem API", url: "http://h" };
    const state = after(
      pendingState(),
      { type: "decide", itemId: "p1", decision: "approve" },
      { type: "decisionFailed", itemId: "p1", errorId: "e1", error, at: AT },
    );
    expect(approval(state).state).toEqual({ status: "pending" });
    expect(state.items.at(-1)).toEqual({ kind: "error", id: "e1", error, at: AT });
    expect(state.inFlight).toBe(false);
    expect(canSend(state)).toBe(false);
  });
});
