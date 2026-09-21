# Contract: esquema do resumo de conversa

**Feature**: `011-history-summarization` | Satisfaz FR-012, FR-015

Acréscimo a [`007-persistent-conversation/contracts/database-schema.md`](../../007-persistent-conversation/contracts/database-schema.md).
As tabelas `conversations` e `messages` não mudam.

## DDL: acrescentado ao fim de `CONVERSATION_SCHEMA_SQL`

```sql
CREATE TABLE IF NOT EXISTS conversation_summaries (
  conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id),
  content          TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 800),
  covered_messages INTEGER NOT NULL CHECK (covered_messages > 0),
  updated_at       TEXT NOT NULL
);
```

Literal, sem interpolação. Aplicado pelo construtor de `SqliteConversationStore`, que é o
mesmo ponto das outras tabelas de conversa. Por usar `IF NOT EXISTS`, um banco da 007 ganha a
tabela nova na primeira abertura depois desta feature, sem passo manual (Princípio II).

## Regras

| Regra | Motivo |
|---|---|
| `conversation_id` é PRIMARY KEY | no máximo um resumo por conversa (FR-012); é também o alvo do `ON CONFLICT` (R-003) |
| `REFERENCES conversations(id)` com `foreign_keys = ON` | segunda linha de defesa de CV11 |
| `CHECK (length(content) BETWEEN 1 AND 800)` em sincronia com `SUMMARY_MAX_CHARS` | teto de 200 tokens estimados (R-008). Um teste verifica a sincronia, no padrão da CV7 da 007 |
| `CHECK (covered_messages > 0)` | um resumo sempre cobre pelo menos uma mensagem |
| `updated_at` TEXT ISO-8601 UTC, `NOT NULL` | `node:sqlite` grava `Date` como `NULL` (004, R-003) |
| Sem índice extra | a PK já indexa a única consulta (`WHERE conversation_id = ?`) |
| Sem `ON DELETE` | nada é apagado |

`countMessages` e `messagesRange` usam o índice existente
`idx_messages_conversation(conversation_id, id)`.
