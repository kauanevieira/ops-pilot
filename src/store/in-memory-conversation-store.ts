import { randomUUID } from "node:crypto";
import { messageRoleSchema, type ConversationMessage, type NewConversationMessage } from "../domain/schemas.ts";
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

  create(): string {
    const id = `conv-${randomUUID()}`;
    this.#conversations.set(id, []);
    return id;
  }

  append(conversationId: string, messages: NewConversationMessage[]): void {
    const existing = this.#conversations.get(conversationId);
    if (!existing) {
      throw new ConversationNotFoundError(conversationId);
    }
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
    const existing = this.#conversations.get(conversationId);
    if (!existing) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (limit <= 0) return [];
    return existing.slice(Math.max(0, existing.length - limit));
  }
}
