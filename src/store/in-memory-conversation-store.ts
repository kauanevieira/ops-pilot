import { randomUUID } from "node:crypto";
import {
  messageRoleSchema,
  newConversationSummarySchema,
  type ConversationMessage,
  type NewConversationMessage,
  type ConversationSummary,
  type NewConversationSummary,
} from "../domain/schemas.ts";
import { ConversationNotFoundError } from "../domain/errors.ts";
import type { ConversationStore } from "./conversation-store.ts";

/**
 * In-memory test double for `ConversationStore` (007-persistent-conversation,
 * R-015). Default of `createApp` — the same role `InMemoryOpsRepository`
 * already plays for `OpsRepository` — and the store `server.test.ts`
 * exercises with the fake strategy registry.
 *
 * Every method here is validated by `runConversationStoreContract` against
 * `SqliteConversationStore` too, so this fake can't silently diverge from
 * the durable implementation's observable behavior.
 */
export class InMemoryConversationStore implements ConversationStore {
  #conversations = new Map<string, ConversationMessage[]>();
  /** 011-history-summarization: at most one summary per conversation id. */
  #summaries = new Map<string, ConversationSummary>();

  create(): string {
    const id = `conv-${randomUUID()}`;
    this.#conversations.set(id, []);
    return id;
  }

  #require(conversationId: string): ConversationMessage[] {
    const existing = this.#conversations.get(conversationId);
    if (!existing) {
      throw new ConversationNotFoundError(conversationId);
    }
    return existing;
  }

  append(conversationId: string, messages: NewConversationMessage[]): void {
    const existing = this.#require(conversationId);
    // Validate every role before mutating anything (CV4: atomic — either all
    // messages are recorded, or none are). This is the fake's equivalent of
    // the database CHECK the SQLite store gets for free.
    const createdAt = new Date();
    const toAppend = messages.map((message) => ({
      role: messageRoleSchema.parse(message.role),
      content: message.content,
      createdAt,
    }));
    existing.push(...toAppend);
  }

  lastMessages(conversationId: string, limit: number): ConversationMessage[] {
    const existing = this.#require(conversationId);
    if (limit <= 0) return [];
    return existing.slice(Math.max(0, existing.length - limit));
  }

  countMessages(conversationId: string): number {
    return this.#require(conversationId).length;
  }

  messagesRange(conversationId: string, offset: number, limit: number): ConversationMessage[] {
    const existing = this.#require(conversationId);
    if (offset < 0 || limit <= 0) return [];
    return existing.slice(offset, offset + limit);
  }

  getSummary(conversationId: string): ConversationSummary | null {
    this.#require(conversationId);
    return this.#summaries.get(conversationId) ?? null;
  }

  saveSummary(conversationId: string, summary: NewConversationSummary): boolean {
    this.#require(conversationId);
    // Validate before comparing/writing (CV17) — the fake's equivalent of
    // the database CHECK the SQLite store gets for free.
    const parsed = newConversationSummarySchema.parse(summary);
    const current = this.#summaries.get(conversationId);
    if (current && parsed.coveredMessages <= current.coveredMessages) {
      return false;
    }
    this.#summaries.set(conversationId, { ...parsed, updatedAt: new Date() });
    return true;
  }
}
