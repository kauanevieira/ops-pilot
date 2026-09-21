import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConversationNotFoundError } from "../domain/errors.ts";
import type { ConversationStore } from "./conversation-store.ts";

/**
 * The invariants every `ConversationStore` implementation MUST satisfy
 * (contracts/conversation-store.md, CV1-CV6, CV9, CV10). Run against both
 * `InMemoryConversationStore` and `SqliteConversationStore(':memory:')` so
 * neither can silently drift from the other (007-persistent-conversation,
 * R-015). Implementation-specific cases (the database CHECK, reopening a
 * file) live in the SQLite store's own test file, not here.
 *
 * Deliberately NOT named `*.test.ts` — this is a helper imported by two
 * test files, not a suite `node --test` should discover and run on its own.
 */
export function runConversationStoreContract(name: string, makeStore: () => ConversationStore): void {
  describe(`ConversationStore contract: ${name}`, () => {
    it("CV1: create() returns a fresh id each time", () => {
      const store = makeStore();
      const a = store.create();
      const b = store.create();
      assert.notEqual(a, b);
    });

    it("CV2: a freshly created conversation has no messages", () => {
      const store = makeStore();
      const id = store.create();
      assert.deepEqual(store.lastMessages(id, 12), []);
    });

    it("CV3: append/lastMessages on an unknown id throw ConversationNotFoundError, without creating it", () => {
      const store = makeStore();
      assert.throws(() => store.append("does-not-exist", [{ role: "user", content: "oi" }]), ConversationNotFoundError);
      assert.throws(() => store.lastMessages("does-not-exist", 12), ConversationNotFoundError);
    });

    it("CV4: append records all given messages, in order, in one call", () => {
      const store = makeStore();
      const id = store.create();
      store.append(id, [
        { role: "user", content: "qual serviço está com alerta?" },
        { role: "assistant", content: "checkout-api." },
      ]);
      const messages = store.lastMessages(id, 12);
      assert.equal(messages.length, 2);
      assert.equal(messages[0]!.role, "user");
      assert.equal(messages[0]!.content, "qual serviço está com alerta?");
      assert.equal(messages[1]!.role, "assistant");
      assert.equal(messages[1]!.content, "checkout-api.");
    });

    it("CV4: a failed append leaves the conversation untouched (atomic)", () => {
      const store = makeStore();
      const id = store.create();
      store.append(id, [{ role: "user", content: "primeira mensagem" }]);
      assert.throws(() => {
        store.append(id, [
          { role: "assistant", content: "seria gravada" },
          // @ts-expect-error - exercising the store's own defense against an invalid role
          { role: "system", content: "papel inválido" },
        ]);
      });
      const messages = store.lastMessages(id, 12);
      assert.equal(messages.length, 1);
      assert.equal(messages[0]!.content, "primeira mensagem");
    });

    it("CV5/CV6: lastMessages returns the N most recent, in chronological order, stable across ties", () => {
      const store = makeStore();
      const id = store.create();
      for (let i = 0; i < 15; i += 1) {
        store.append(id, [{ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }]);
      }
      const last = store.lastMessages(id, 12);
      assert.deepEqual(
        last.map((m) => m.content),
        Array.from({ length: 12 }, (_, i) => `m${i + 3}`),
      );
    });

    it("CV5: lastMessages with a limit above the total returns everything", () => {
      const store = makeStore();
      const id = store.create();
      store.append(id, [{ role: "user", content: "única mensagem" }]);
      const last = store.lastMessages(id, 12);
      assert.equal(last.length, 1);
    });

    it("CV9: conversations never see each other's messages", () => {
      const store = makeStore();
      const a = store.create();
      const b = store.create();
      store.append(a, [{ role: "user", content: "conversa A" }]);
      store.append(b, [{ role: "user", content: "conversa B" }]);
      assert.deepEqual(
        store.lastMessages(a, 12).map((m) => m.content),
        ["conversa A"],
      );
      assert.deepEqual(
        store.lastMessages(b, 12).map((m) => m.content),
        ["conversa B"],
      );
    });

    it("CV10: a non-positive limit returns []", () => {
      const store = makeStore();
      const id = store.create();
      store.append(id, [{ role: "user", content: "oi" }]);
      assert.deepEqual(store.lastMessages(id, 0), []);
    });

    // --- 011-history-summarization (contracts/conversation-store.md) ----

    it("CV11: the 4 new methods throw ConversationNotFoundError on an unknown id; saveSummary writes nothing", () => {
      const store = makeStore();
      assert.throws(() => store.countMessages("does-not-exist"), ConversationNotFoundError);
      assert.throws(() => store.messagesRange("does-not-exist", 0, 5), ConversationNotFoundError);
      assert.throws(() => store.getSummary("does-not-exist"), ConversationNotFoundError);
      assert.throws(
        () => store.saveSummary("does-not-exist", { content: "resumo", coveredMessages: 1 }),
        ConversationNotFoundError,
      );
    });

    it("CV12: countMessages tracks successful appends only", () => {
      const store = makeStore();
      const id = store.create();
      assert.equal(store.countMessages(id), 0);
      store.append(id, [
        { role: "user", content: "m0" },
        { role: "assistant", content: "m1" },
      ]);
      store.append(id, [{ role: "user", content: "m2" }]);
      assert.equal(store.countMessages(id), 3);
      assert.throws(() => {
        store.append(id, [
          { role: "assistant", content: "seria gravada" },
          // @ts-expect-error - exercising the store's own defense against an invalid role
          { role: "system", content: "papel inválido" },
        ]);
      });
      assert.equal(store.countMessages(id), 3);
    });

    it("CV13: messagesRange returns the messages at [offset, offset+limit) in chronological order", () => {
      const store = makeStore();
      const id = store.create();
      for (let i = 0; i < 15; i += 1) {
        store.append(id, [{ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }]);
      }
      assert.deepEqual(
        store.messagesRange(id, 3, 4).map((m) => m.content),
        ["m3", "m4", "m5", "m6"],
      );
      assert.deepEqual(
        store.messagesRange(id, 13, 10).map((m) => m.content),
        ["m13", "m14"],
      );
      assert.deepEqual(store.messagesRange(id, 15, 5), []);
      assert.deepEqual(store.messagesRange(id, -1, 5), []);
      assert.deepEqual(store.messagesRange(id, 3, 0), []);
      assert.deepEqual(store.messagesRange(id, 3, -1), []);
    });

    it("CV14: getSummary on a conversation without one returns null", () => {
      const store = makeStore();
      const id = store.create();
      assert.equal(store.getSummary(id), null);
    });

    it("CV15: saveSummary with greater coverage saves, returns true, and getSummary reflects it", () => {
      const store = makeStore();
      const id = store.create();
      assert.equal(store.saveSummary(id, { content: "primeiro resumo", coveredMessages: 8 }), true);
      const first = store.getSummary(id);
      assert.equal(first?.content, "primeiro resumo");
      assert.equal(first?.coveredMessages, 8);
      assert.ok(first?.updatedAt instanceof Date);

      assert.equal(store.saveSummary(id, { content: "segundo resumo", coveredMessages: 16 }), true);
      const second = store.getSummary(id);
      assert.equal(second?.content, "segundo resumo");
      assert.equal(second?.coveredMessages, 16);
    });

    it("CV16: saveSummary with coverage <= current discards the write and returns false", () => {
      const store = makeStore();
      const id = store.create();
      store.saveSummary(id, { content: "resumo de 16", coveredMessages: 16 });
      assert.equal(store.saveSummary(id, { content: "tentativa igual", coveredMessages: 16 }), false);
      assert.equal(store.saveSummary(id, { content: "tentativa menor", coveredMessages: 8 }), false);
      const current = store.getSummary(id);
      assert.equal(current?.content, "resumo de 16");
      assert.equal(current?.coveredMessages, 16);
    });

    it("CV17: saveSummary validates content and coveredMessages before writing", () => {
      const store = makeStore();
      const id = store.create();
      assert.throws(() => store.saveSummary(id, { content: "   ", coveredMessages: 8 }));
      assert.throws(() => store.saveSummary(id, { content: "x".repeat(801), coveredMessages: 8 }));
      assert.throws(() => store.saveSummary(id, { content: "resumo", coveredMessages: 0 }));
      assert.throws(() => store.saveSummary(id, { content: "resumo", coveredMessages: 2.5 }));
      assert.equal(store.getSummary(id), null);
    });

    it("CV18: summaries of distinct conversations never mix", () => {
      const store = makeStore();
      const a = store.create();
      const b = store.create();
      store.saveSummary(a, { content: "resumo A", coveredMessages: 8 });
      store.saveSummary(b, { content: "resumo B", coveredMessages: 8 });
      assert.equal(store.getSummary(a)?.content, "resumo A");
      assert.equal(store.getSummary(b)?.content, "resumo B");
    });
  });
}
