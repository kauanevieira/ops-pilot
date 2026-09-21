import type { ConversationStore } from "../store/conversation-store.ts";
import type { ConversationMessage } from "../domain/schemas.ts";
import type { TraceEvent } from "../trace/types.ts";
import { HISTORY_WINDOW } from "../agents/conversation-history.ts";
import { capSummary, type Summarizer } from "./summarizer.ts";
import { withTimeout } from "../lib/with-timeout.ts";

/** How many pending messages trigger a re-summarization (FR-003). */
export const SUMMARY_BATCH = 8;

/**
 * The most verbatim messages a single request ever delivers: the recent
 * window plus, at most, one batch's worth of not-yet-summarized pendings
 * (FR-019, data-model.md).
 */
export const MAX_VERBATIM_MESSAGES = HISTORY_WINDOW + SUMMARY_BATCH - 1;

/** Independent of the request's own 180 s deadline (FR-010, research R-006). */
export const SUMMARY_TIMEOUT_MS = 30_000;

/**
 * Pure decision (Principle I, contracts/history-summarization.md, P1/P2):
 * given how many messages the conversation has and how many the current
 * summary covers, decides whether this request should summarize, and where
 * the verbatim window should start.
 *
 * `summarize` is non-null exactly when 8 or more messages are pending
 * (FR-003); in that case it names the exact range to absorb — ALL pending
 * messages in one call (FR-004), never partial batches within one request.
 */
export function planConversationContext(args: { totalMessages: number; coveredMessages: number }): {
  summarize: { offset: number; count: number } | null;
} {
  const pending = Math.max(0, args.totalMessages - HISTORY_WINDOW - args.coveredMessages);
  if (pending < SUMMARY_BATCH) return { summarize: null };
  return { summarize: { offset: args.coveredMessages, count: pending } };
}

/**
 * Where the verbatim window starts, given the CURRENT summary coverage
 * (i.e. after summarization was attempted, successful or not) — never
 * before `coveredMessages`, and never more than `MAX_VERBATIM_MESSAGES`
 * back from the end (FR-019, P2).
 */
export function verbatimStart(args: { totalMessages: number; coveredMessages: number }): number {
  return Math.max(args.coveredMessages, args.totalMessages - MAX_VERBATIM_MESSAGES);
}

/**
 * What `prepareConversationContext` hands to `withConversationHistory` and
 * `buildContextBreakdown` (data-model.md, `ConversationContext`).
 */
export interface ConversationContext {
  summary: string | null;
  summaryCoveredMessages: number;
  messages: ConversationMessage[];
  /** Present only when a new summary was produced AND saved this request (FR-022). */
  summarizeEvent?: Extract<TraceEvent, { type: "summarize" }>;
}

/** The context for a request with no `conversationId` (R-005/FR-020 in chat.ts). */
export const EMPTY_CONVERSATION_CONTEXT: ConversationContext = {
  summary: null,
  summaryCoveredMessages: 0,
  messages: [],
};

/**
 * Orchestrates one request's conversation context (contracts/history-summarization.md,
 * C1-C8): decides whether to summarize (`planConversationContext`), and if
 * so, attempts it with its own timeout raced against the request's own
 * `signal` (R-006), tolerating any failure (FR-011) — an unsuccessful
 * summarization never throws; it just leaves the summary as it was.
 *
 * Reads `countMessages` ONCE, at the start (research R-004): everything
 * below works off that fixed total, so a message appended by another
 * request on the same conversation during the `await` below never leaks
 * into this request's context (C8).
 */
export async function prepareConversationContext(
  deps: { conversationStore: ConversationStore; summarizer: Summarizer; timeoutMs: number },
  conversationId: string,
  signal: AbortSignal,
): Promise<ConversationContext> {
  const { conversationStore, summarizer, timeoutMs } = deps;

  const total = conversationStore.countMessages(conversationId);
  let current = conversationStore.getSummary(conversationId);
  const plan = planConversationContext({ totalMessages: total, coveredMessages: current?.coveredMessages ?? 0 });

  let summarizeEvent: ConversationContext["summarizeEvent"];

  if (plan.summarize) {
    const { offset, count } = plan.summarize;
    try {
      const pending = conversationStore.messagesRange(conversationId, offset, count);
      const text = await withTimeout(
        timeoutMs,
        (innerSignal) => summarizer({ previousSummary: current?.content ?? null, messages: pending }, innerSignal),
        { parentSignal: signal, timeoutMessage: "Tempo limite da sumarização de histórico excedido." },
      );
      const content = capSummary(text);
      if (content.length === 0) {
        throw new Error("O sumarizador devolveu um resumo vazio.");
      }
      const coveredMessages = offset + count;
      const saved = conversationStore.saveSummary(conversationId, { content, coveredMessages });
      if (saved) {
        summarizeEvent = { type: "summarize", content, absorbedMessages: count };
      }
    } catch (error) {
      // FR-011: any failure (rejection, timeout, empty result) leaves the
      // request to proceed without a new summary. Logged, never thrown.
      console.error("Falha ao resumir histórico da conversa:", error);
    }
    // Re-read regardless of outcome (R-003): reflects whatever is actually
    // saved, whether this request's own write won, another concurrent
    // request's write won (saved === false), or nothing changed at all.
    current = conversationStore.getSummary(conversationId);
  }

  const covered = current?.coveredMessages ?? 0;
  const start = verbatimStart({ totalMessages: total, coveredMessages: covered });
  const messages = conversationStore.messagesRange(conversationId, start, total - start);

  return { summary: current?.content ?? null, summaryCoveredMessages: covered, messages, summarizeEvent };
}
