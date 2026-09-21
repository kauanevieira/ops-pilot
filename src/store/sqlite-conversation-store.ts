import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { z } from "zod";
import { conversationMessageSchema, type ConversationMessage, type NewConversationMessage } from "../domain/schemas.ts";
import { ConversationNotFoundError } from "../domain/errors.ts";
import type { ConversationStore } from "./conversation-store.ts";
import { CONVERSATION_SCHEMA_SQL } from "./sqlite-schema.ts";

/** Row shape a SELECT on `messages` returns, before domain validation. */
interface MessageRow {
  role: string;
  content: string;
  created_at: string;
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
  }

  #exists(conversationId: string): boolean {
    return this.#selectConversationExists.get(conversationId) !== undefined;
  }

  create(): string {
    const id = `conv-${randomUUID()}`;
    this.#insertConversation.run(id, new Date().toISOString());
    return id;
  }

  append(conversationId: string, messages: NewConversationMessage[]): void {
    if (!this.#exists(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }
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
    if (!this.#exists(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (limit <= 0) return [];
    const rows = this.#selectLastMessages.all(conversationId, limit) as unknown as MessageRow[];
    return rows.map((row) => messageRowSchema.parse(row));
  }
}
