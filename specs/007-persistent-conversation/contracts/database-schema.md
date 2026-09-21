# Contract: esquema de conversa

**Feature**: `007-persistent-conversation` | Satisfaz FR-002, FR-003, FR-006, FR-007

Acréscimo ao esquema de [`004-sqlite-persistence/contracts/database-schema.md`](../../004-sqlite-persistence/contracts/database-schema.md).
Nada de `SCHEMA_SQL` nem de `seedDatabase` muda.

## DDL — `CONVERSATION_SCHEMA_SQL` em `src/store/sqlite-schema.ts`

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
```

Literal, sem interpolação (Princípio II). Aplicado no construtor de
`SqliteConversationStore`; idempotente.

## Regras

| Regra | Motivo |
|---|---|
| `messages.id INTEGER PRIMARY KEY` (rowid), sem `AUTOINCREMENT` | ordem total entre mensagens do mesmo instante; nada é apagado nesta feature (R-004) |
| `CHECK (role IN ('user','assistant'))` em sincronia com `messageRoleSchema` | FR-003; teste de sincronia como o da 004 (R-007 da 004) |
| `REFERENCES conversations(id)` com `foreign_keys = ON` (já ligado em `openDatabase`) | segunda linha de defesa de CV3 |
| Datas como `TEXT` ISO-8601 UTC, `NOT NULL` | `node:sqlite` grava `Date` como `NULL` (004, R-003) |
| Sem `ON DELETE` | não há exclusão nesta feature |

## Statements (todos preparados no construtor)

```sql
-- create
INSERT INTO conversations (id, created_at) VALUES (?, ?)
-- existência (usada por append e lastMessages)
SELECT 1 FROM conversations WHERE id = ?
-- append (dentro de BEGIN/COMMIT, R-005)
INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)
-- lastMessages (R-004)
SELECT role, content, created_at FROM (
  SELECT id, role, content, created_at FROM messages
  WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
) ORDER BY id
```

## Seed

`seedDatabase` **não** toca em `conversations` nem em `messages`: conversas são uso, não
cenário — mesmo princípio que já exclui `incidents` do seed (004, FR-027).
