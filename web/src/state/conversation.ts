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

/** What came back from a decision (contracts/approval-flow.md). */
export type DecisionOutcome =
  | {
      kind: "approved";
      /** The run resumed: either it finished (answer) or it paused again (another card). */
      next:
        | { kind: "answer"; id: string; result: ChatResponseWire; at: string }
        | { kind: "approval"; id: string; accepted: ChatAccepted; at: string };
    }
  | { kind: "denied" }
  | { kind: "rejected"; reason: string };

export type ConversationAction =
  | { type: "send"; id: string; text: string; at: string }
  | { type: "answered"; id: string; result: ChatResponseWire; at: string }
  | { type: "pending"; id: string; accepted: ChatAccepted; at: string }
  | { type: "failed"; id: string; error: DisplayError; retryText?: string; at: string }
  | { type: "decide"; itemId: string; decision: "approve" | "deny" }
  | { type: "decided"; itemId: string; outcome: DecisionOutcome }
  | { type: "decisionFailed"; itemId: string; errorId: string; error: DisplayError; at: string }
  | { type: "reset" };

type ApprovalItem = Extract<ConversationItem, { kind: "approval" }>;

/** The card `itemId`, only when it is in `status` — anything else leaves the state untouched (SC-004). */
function approvalIn(state: ConversationState, itemId: string, status: ApprovalState["status"]): ApprovalItem | null {
  const item = state.items.find((i) => i.id === itemId);
  return item?.kind === "approval" && item.state.status === status ? item : null;
}

function withApprovalState(items: ConversationItem[], itemId: string, next: ApprovalState): ConversationItem[] {
  return items.map((item) => (item.kind === "approval" && item.id === itemId ? { ...item, state: next } : item));
}

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
    case "pending":
      return {
        conversationId: action.accepted.conversationId,
        inFlight: false,
        items: [
          ...state.items,
          { kind: "approval", id: action.id, pending: action.accepted, state: { status: "pending" }, at: action.at },
        ],
      };
    case "decide": {
      if (!approvalIn(state, action.itemId, "pending")) return state;
      return {
        ...state,
        inFlight: true,
        items: withApprovalState(state.items, action.itemId, { status: "deciding", decision: action.decision }),
      };
    }
    case "decided": {
      if (!approvalIn(state, action.itemId, "deciding")) return state;
      const { outcome } = action;
      if (outcome.kind === "denied") {
        return { ...state, inFlight: false, items: withApprovalState(state.items, action.itemId, { status: "denied" }) };
      }
      if (outcome.kind === "rejected") {
        return {
          ...state,
          inFlight: false,
          items: withApprovalState(state.items, action.itemId, { status: "rejected", reason: outcome.reason }),
        };
      }
      const items = withApprovalState(state.items, action.itemId, { status: "approved" });
      const { next } = outcome;
      if (next.kind === "answer") {
        return {
          conversationId: next.result.conversationId,
          inFlight: false,
          items: [...items, { kind: "answer", id: next.id, result: next.result, at: next.at }],
        };
      }
      return {
        conversationId: next.accepted.conversationId,
        inFlight: false,
        items: [
          ...items,
          { kind: "approval", id: next.id, pending: next.accepted, state: { status: "pending" }, at: next.at },
        ],
      };
    }
    case "decisionFailed": {
      if (!approvalIn(state, action.itemId, "deciding")) return state;
      return {
        ...state,
        inFlight: false,
        items: [
          ...withApprovalState(state.items, action.itemId, { status: "pending" }),
          { kind: "error", id: action.errorId, error: action.error, at: action.at },
        ],
      };
    }
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
