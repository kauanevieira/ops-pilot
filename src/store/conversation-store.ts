import type {
  ConversationMessage,
  NewConversationMessage,
  ConversationSummary,
  NewConversationSummary,
} from "../domain/schemas.ts";

/**
 * Contract for durable conversation history (007-persistent-conversation,
 * contracts/conversation-store.md). Deliberately separate from
 * `OpsRepository` (R-001): conversations are not operational state, and
 * neither the agent's tools nor the arena/bench/MCP entry points should
 * depend on this existing.
 *
 * Synchronous, like `OpsRepository` — `SqliteConversationStore` sits on top
 * of the same synchronous `DatabaseSync` (004, R-001), and keeping the same
 * shape here is what makes the fake trivial and both usable interchangeably
 * from the HTTP handler.
 */
export interface ConversationStore {
  /** Creates a new, empty conversation and returns its opaque id (FR-001). */
  create(): string;

  /**
   * Appends `messages` to the end of the conversation, in the given order,
   * atomically: either all of them are recorded, or none are (FR-014).
   * Throws ConversationNotFoundError if the conversation doesn't exist —
   * never creates it implicitly (FR-005).
   */
  append(conversationId: string, messages: NewConversationMessage[]): void;

  /**
   * The up-to-`limit` most recent messages of the conversation, in
   * chronological order (oldest first). An existing, empty conversation
   * returns `[]`. Throws ConversationNotFoundError if the conversation
   * doesn't exist (R-002) — that's what lets a caller distinguish an empty
   * conversation from a missing one.
   */
  lastMessages(conversationId: string, limit: number): ConversationMessage[];

  // --- 011-history-summarization (contracts/conversation-store.md) --------

  /**
   * Total number of messages recorded in the conversation. Throws
   * ConversationNotFoundError if the conversation doesn't exist.
   */
  countMessages(conversationId: string): number;

  /**
   * Up to `limit` messages starting at chronological position `offset` (0 =
   * the conversation's first message), in chronological order. A position
   * past the end, or `offset < 0` / `limit <= 0`, returns []. Throws
   * ConversationNotFoundError if the conversation doesn't exist.
   */
  messagesRange(conversationId: string, offset: number, limit: number): ConversationMessage[];

  /**
   * The conversation's current summary, or null if none has been saved yet.
   * Throws ConversationNotFoundError if the conversation doesn't exist.
   */
  getSummary(conversationId: string): ConversationSummary | null;

  /**
   * Saves `summary` as the conversation's summary IF `summary.coveredMessages`
   * is greater than the current summary's (or there is none yet). Returns
   * true if it saved, false if it discarded the write because coverage
   * didn't advance — never throws for that reason. Throws
   * ConversationNotFoundError if the conversation doesn't exist.
   */
  saveSummary(conversationId: string, summary: NewConversationSummary): boolean;
}
