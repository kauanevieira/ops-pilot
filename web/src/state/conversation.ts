import type { ChatAccepted, ChatResponseWire } from "@domain/wire.ts";
import type { DisplayError } from "../chat/errors.ts";

/**
 * data-model.md. A pure reducer: ids and timestamps come in through the
 * actions, produced once at the root component (Constitution, Principle I).
 */
export type ApprovalState =
  | { status: "pending" }
  | { status: "deciding"; decision: "approve" | "deny" }
  | { status: "approved" }
  | { status: "denied" }
  | { status: "rejected"; reason: string };

export type ConversationItem =
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "answer"; id: string; result: ChatResponseWire; at: string }
  | { kind: "approval"; id: string; pending: ChatAccepted; state: ApprovalState; at: string }
  | { kind: "error"; id: string; error: DisplayError; retryText?: string; at: string };

export interface ConversationState {
  conversationId: string | null;
  items: ConversationItem[];
  inFlight: boolean;
}

export const initialConversation: ConversationState = { conversationId: null, items: [], inFlight: false };

export type ConversationAction =
  | { type: "send"; id: string; text: string; at: string }
  | { type: "answered"; id: string; result: ChatResponseWire; at: string }
  | { type: "failed"; id: string; error: DisplayError; retryText?: string; at: string }
  | { type: "reset" };

/** FR-003: nothing goes out while a request runs or a card waits for a decision. */
export function canSend(state: ConversationState): boolean {
  if (state.inFlight) return false;
  return !state.items.some(
    (item) => item.kind === "approval" && (item.state.status === "pending" || item.state.status === "deciding"),
  );
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "send":
      if (!canSend(state)) return state;
      return {
        ...state,
        inFlight: true,
        items: [...state.items, { kind: "user", id: action.id, text: action.text, at: action.at }],
      };
    case "answered":
      return {
        conversationId: action.result.conversationId,
        inFlight: false,
        items: [...state.items, { kind: "answer", id: action.id, result: action.result, at: action.at }],
      };
    case "failed":
      return {
        ...state,
        inFlight: false,
        items: [
          ...state.items,
          {
            kind: "error",
            id: action.id,
            error: action.error,
            ...(action.retryText !== undefined ? { retryText: action.retryText } : {}),
            at: action.at,
          },
        ],
      };
    case "reset":
      return initialConversation;
  }
}
