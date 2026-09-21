import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { messageRoleSchema } from "../domain/schemas.ts";
import { runConversationStoreContract } from "./conversation-store.contract.ts";
import { SqliteConversationStore } from "./sqlite-conversation-store.ts";

runConversationStoreContract("SqliteConversationStore", () => new SqliteConversationStore(new DatabaseSync(":memory:")));

// --- T024: CHECK do banco (FR-003) ------------------------------------------

describe("restrição de papel no banco (FR-003)", () => {
  it("rejeita um role fora de user/assistant mesmo inserido diretamente", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteConversationStore(db);
    const id = store.create();
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)")
          .run(id, "system", "x", new Date().toISOString()),
      /CHECK constraint failed/,
    );
  });

  it("rejeita conversation_id inexistente por chave estrangeira", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteConversationStore(db);
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)")
          .run("nao-existe", "user", "x", new Date().toISOString()),
      /FOREIGN KEY constraint failed/,
    );
  });
});

// --- T024: sincronia CHECK <-> enum zod (mesmo padrão de 004, R-007) --------

describe("sincronia entre CHECK do banco e messageRoleSchema", () => {
  it("messages.role bate com messageRoleSchema", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteConversationStore(db);
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .get() as { sql: string };
    const match = /CHECK \(role IN \(([^)]+)\)\)/.exec(row.sql);
    assert.ok(match, "CHECK não encontrado para messages.role");
    const values = new Set(
      match![1]!
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, "")),
    );
    assert.deepEqual(values, new Set(messageRoleSchema.options));
  });
});

// --- T024: persistência entre aberturas (FR-007) ----------------------------

describe("persistência entre aberturas de conexão (FR-007)", () => {
  it("o que uma conexão grava, outra conexão sobre o mesmo arquivo lê de volta", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "opspilot-conv-test-"));
    const dbPath = path.join(dir, "test.db");
    try {
      const db1 = new DatabaseSync(dbPath);
      const store1 = new SqliteConversationStore(db1);
      const id = store1.create();
      store1.append(id, [
        { role: "user", content: "qual serviço está com alerta?" },
        { role: "assistant", content: "checkout-api." },
      ]);
      db1.close();

      const db2 = new DatabaseSync(dbPath);
      const store2 = new SqliteConversationStore(db2);
      const reread = store2.lastMessages(id, 12);
      assert.equal(reread.length, 2);
      assert.equal(reread[0]!.content, "qual serviço está com alerta?");
      assert.equal(reread[1]!.content, "checkout-api.");
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reabrir um banco já estruturado não falha e não altera nada (DDL idempotente)", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteConversationStore(db);
    const id = store.create();
    store.append(id, [{ role: "user", content: "oi" }]);

    assert.doesNotThrow(() => new SqliteConversationStore(db));
    assert.deepEqual(
      store.lastMessages(id, 12).map((m) => m.content),
      ["oi"],
    );
  });
});
