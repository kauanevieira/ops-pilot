import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { z } from "zod";
import {
  conversationMessageSchema,
  conversationSummarySchema,
  newConversationSummarySchema,
  type ConversationMessage,
  type NewConversationMessage,
  type ConversationSummary,
  type NewConversationSummary,
} from "../domain/schemas.ts";
import { ConversationNotFoundError } from "../domain/errors.ts";
import type { ConversationStore } from "./conversation-store.ts";
import { CONVERSATION_SCHEMA_SQL } from "./sqlite-schema.ts";

/** Row shape a SELECT on `messages` returns, before domain validation. */
interface MessageRow {
  role: string;
  content: string;
  created_at: string;
}

/** Row shape a SELECT on `conversation_summaries` returns, before domain validation. */
interface SummaryRow {
  content: string;
  covered_messages: number;
  updated_at: string;
}

/**
 * Same translation pattern as `alertRowSchema` in sqlite-ops-store.ts
 * (004, FR-023): every read is validated against the domain schema, not
 * cast — a date lost to `node:sqlite` writing NULL for a bound `Date`
 * (004, R-003) would fail loudly here instead of reaching the agent.
 */
const messageRowSchema = conversationMessageSchema
  .omit({ createdAt: true })
  .extend({ created_at: z.coerce.date() })
  .transform(({ created_at, ...rest }) => ({ ...rest, createdAt: created_at }));

/**
 * 011-history-summarization: same translation pattern, for
 * `conversation_summaries` rows (contracts/conversation-store.md).
 */
const summaryRowSchema = conversationSummarySchema
  .omit({ updatedAt: true, coveredMessages: true })
  .extend({ covered_messages: z.number().int().positive(), updated_at: z.coerce.date() })
  .transform(({ covered_messages, updated_at, ...rest }) => ({
    ...rest,
    coveredMessages: covered_messages,
    updatedAt: updated_at,
  }));

/**
 * Implements `ConversationStore` over `node:sqlite`'s synchronous
 * `DatabaseSync` (contracts/conversation-store.md), same construction
 * pattern as `SqliteOpsStore`: receives an already-open connection (so a
 * test can pass `new DatabaseSync(':memory:')` directly), applies its own
 * idempotent DDL in the constructor, and prepares every statement once.
 */
export class SqliteConversationStore implements ConversationStore {
  #db: DatabaseSync;

  #insertConversation: StatementSync;
  #selectConversationExists: StatementSync;
  #insertMessage: StatementSync;
  #selectLastMessages: StatementSync;
  #selectCountMessages: StatementSync;
  #selectMessagesRange: StatementSync;
  #selectSummary: StatementSync;
  #upsertSummary: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(CONVERSATION_SCHEMA_SQL);

    this.#insertConversation = this.#db.prepare("INSERT INTO conversations (id, created_at) VALUES (?, ?)");
    this.#selectConversationExists = this.#db.prepare("SELECT 1 FROM conversations WHERE id = ?");
    this.#insertMessage = this.#db.prepare(
      "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    );
    // The subquery picks the N most recent rows by rowid (R-004), then the
    // outer SELECT hands them back in chronological order — one round trip,
    // `limit` bound as a parameter, never interpolated (R-004, R-012).
    this.#selectLastMessages = this.#db.prepare(
      `SELECT role, content, created_at FROM (
         SELECT id, role, content, created_at FROM messages
         WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id`,
    );

    // --- 011-history-summarization (contracts/conversation-store.md) ----
    this.#selectCountMessages = this.#db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?");
    // Position = order by rowid (research R-001): OFFSET/LIMIT over the
    // existing idx_messages_conversation(conversation_id, id) index.
    this.#selectMessagesRange = this.#db.prepare(
      "SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id LIMIT ? OFFSET ?",
    );
    this.#selectSummary = this.#db.prepare(
      "SELECT content, covered_messages, updated_at FROM conversation_summaries WHERE conversation_id = ?",
    );
    // Conditional write (research R-003, verified against SQLite 3.51.2):
    // the WHERE on the upsert makes this a no-op (changes: 0) when the
    // incoming coverage doesn't exceed what's already there — atomic in a
    // single statement, no separate SELECT-then-UPDATE needed.
    this.#upsertSummary = this.#db.prepare(
      `INSERT INTO conversation_summaries (conversation_id, content, covered_messages, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         content = excluded.content,
         covered_messages = excluded.covered_messages,
         updated_at = excluded.updated_at
       WHERE excluded.covered_messages > conversation_summaries.covered_messages`,
    );
  }

  #exists(conversationId: string): boolean {
    return this.#selectConversationExists.get(conversationId) !== undefined;
  }

  #requireExists(conversationId: string): void {
    if (!this.#exists(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }
  }

  create(): string {
    const id = `conv-${randomUUID()}`;
    this.#insertConversation.run(id, new Date().toISOString());
    return id;
  }

  append(conversationId: string, messages: NewConversationMessage[]): void {
    this.#requireExists(conversationId);
    const createdAt = new Date().toISOString();
    // Atomic (R-005): either every message in `messages` is written, or
    // none is — a CHECK violation partway through rolls the whole append
    // back, same pattern as seedDatabase.
    this.#db.exec("BEGIN");
    try {
      for (const message of messages) {
        this.#insertMessage.run(conversationId, message.role, message.content, createdAt);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  lastMessages(conversationId: string, limit: number): ConversationMessage[] {
    this.#requireExists(conversationId);
    if (limit <= 0) return [];
    const rows = this.#selectLastMessages.all(conversationId, limit) as unknown as MessageRow[];
    return rows.map((row) => messageRowSchema.parse(row));
  }

  countMessages(conversationId: string): number {
    this.#requireExists(conversationId);
    const row = this.#selectCountMessages.get(conversationId) as unknown as { n: number };
    return row.n;
  }

  messagesRange(conversationId: string, offset: number, limit: number): ConversationMessage[] {
    this.#requireExists(conversationId);
    if (offset < 0 || limit <= 0) return [];
    const rows = this.#selectMessagesRange.all(conversationId, limit, offset) as unknown as MessageRow[];
    return rows.map((row) => messageRowSchema.parse(row));
  }

  getSummary(conversationId: string): ConversationSummary | null {
    this.#requireExists(conversationId);
    const row = this.#selectSummary.get(conversationId) as unknown as SummaryRow | undefined;
    if (!row) return null;
    return summaryRowSchema.parse(row);
  }

  saveSummary(conversationId: string, summary: NewConversationSummary): boolean {
    this.#requireExists(conversationId);
    const parsed = newConversationSummarySchema.parse(summary);
    const result = this.#upsertSummary.run(
      conversationId,
      parsed.content,
      parsed.coveredMessages,
      new Date().toISOString(),
    );
    return result.changes === 1;
  }
}
