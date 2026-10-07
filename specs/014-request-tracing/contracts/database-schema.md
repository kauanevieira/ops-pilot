# Contract: esquema do banco (emenda)

**Feature**: `014-request-tracing` | Satisfaz FR-006 a FR-014

Emenda [`004-sqlite-persistence/contracts/database-schema.md`](../../004-sqlite-persistence/contracts/database-schema.md) e
[`007-persistent-conversation/contracts/database-schema.md`](../../007-persistent-conversation/contracts/database-schema.md).
Mesmo arquivo (`OPSPILOT_DB`), mesma conexão. DDL próprio, `REQUEST_SCHEMA_SQL`, aplicado pelo
construtor do `SqliteRequestStore`. Literal, idempotente, sem passo manual.

```sql
CREATE TABLE IF NOT EXISTS requests (
  id                       TEXT PRIMARY KEY,
  received_at              TEXT NOT NULL,
  duration_ms              INTEGER NOT NULL CHECK (duration_ms >= 0),
  status                   INTEGER NOT NULL CHECK (status IN (200,400,404,422,500,503,504)),
  error_code               TEXT CHECK (error_code IN ('invalid_body','unknown_strategy','conversation_not_found','timeout','internal','model_unavailable','request_not_found')),
  conversation_id          TEXT,
  user_id                  TEXT,
  route                    TEXT CHECK (route IN ('react','plan-and-execute','reflect')),
  strategy                 TEXT CHECK (strategy IN ('react','plan-and-execute','reflect:react','reflect:plan-and-execute')),
  route_source             TEXT CHECK (route_source IN ('router','override','fallback')),
  stopped_reason           TEXT CHECK (stopped_reason IN ('completed','max-iterations','max-steps','max-reflections')),
  llm_calls                INTEGER CHECK (llm_calls >= 0),
  prompt_tokens            INTEGER CHECK (prompt_tokens >= 0),
  model_used               TEXT,
  history_messages         INTEGER CHECK (history_messages >= 0),
  summary_covered_messages INTEGER CHECK (summary_covered_messages >= 0),
  recalled_memories        INTEGER CHECK (recalled_memories >= 0),
  trace_events             INTEGER NOT NULL CHECK (trace_events >= 0),
  CHECK ((status = 200) = (error_code IS NULL))
);

CREATE TABLE IF NOT EXISTS trace_events (
  request_id TEXT NOT NULL REFERENCES requests(id),
  position   INTEGER NOT NULL CHECK (position >= 0),
  type       TEXT NOT NULL CHECK (type IN ('thought','action','observation','plan','critique','answer','summarize','route','fallback')),
  node_name  TEXT CHECK (node_name IN ('context','router','react','plan-and-execute','reflect','response')),
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (request_id, position)
);
```

## Garantias

- **DB1**: um `CHECK` com `IN (...)` é NULL-tolerante no SQLite, então as colunas opcionais
  aceitam `NULL` sem cláusula extra. As obrigatórias têm `NOT NULL`.
- **DB2**: cada lista `IN (...)` está em sincronia com o esquema zod correspondente
  ([data-model.md](../data-model.md)). Um teste extrai as listas do DDL e compara com
  `schema.options`, no padrão da 004 (R-007).
- **DB3**: `record()` grava `requests` e todos os `trace_events` numa transação. Uma violação em
  qualquer linha desfaz tudo (FR-010).
- **DB4**: a PK `(request_id, position)` cobre a leitura ordenada
  (`WHERE request_id = ? ORDER BY position`). Nenhum índice extra.
- **DB5**: sem FK em `conversation_id`. Um 404 registra o id que não existe, e uma conversa nunca
  é apagada.
- **DB6**: todas as consultas usam statements preparados no construtor (Princípio II).
- **DB7**: nenhuma coluna guarda o texto da mensagem nem da resposta. Conteúdo só existe em
  `trace_events.payload` (FR-007, FR-008).
