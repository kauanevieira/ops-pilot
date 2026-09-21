# Data Model: Memória Semântica

**Feature**: `008-semantic-memory` | **Fase**: 1 | **Data**: 2026-09-21

Decisões R-xxx em [research.md](./research.md).

---

## Tipos de domínio — `src/domain/schemas.ts`

Uma definição zod, tipos inferidos (Princípio I).

```ts
export const userIdSchema = z.string().trim().min(1, "userId não pode ser vazio.");

/** FR-012: fato curto, não vazio. 500 é suposição da spec. */
export const memoryFactSchema = z.string().trim().min(1).max(500);

export const rememberResultSchema = z.object({
  memoryId: z.string().min(1),
  fact: z.string().min(1),          // o texto guardado: o novo, ou o existente se duplicado
  created: z.boolean(),             // false ⇒ já existia um fato com proximidade > 0,92
});
export type RememberResult = z.infer<typeof rememberResultSchema>;

export const recalledMemorySchema = z.object({
  memoryId: z.string().min(1),
  fact: z.string().min(1),
  score: z.number().min(-1).max(1), // produto escalar com a consulta
});
export type RecalledMemory = z.infer<typeof recalledMemorySchema>;
```

Nenhum erro de domínio novo (R-015): "não encontrado" em `forget` é `false`; "já existia"
em `remember` é `created: false`.

## Constantes — `src/memory/memory-store.ts`

| Nome | Valor | Requisito |
|---|---|---|
| `DEDUP_THRESHOLD` | `0.92` (comparação `>`) | FR-010 |
| `RECALL_MIN_SCORE` | `0.3` (comparação `>=`) | FR-014 |
| `RECALL_LIMIT` | `3` | FR-013 |

## Constantes — `src/memory/embeddings.ts`

| Nome | Valor |
|---|---|
| `EMBEDDING_MODEL` | `"Xenova/paraphrase-multilingual-MiniLM-L12-v2"` (R-002) |
| `EMBEDDING_DTYPE` | `"q8"` |
| `EMBEDDING_DIM` | `384` |
| `MODEL_CACHE_DIR` | `<raiz>/data/models/` (R-006) |

---

## Esquema físico — `MEMORY_SCHEMA_SQL`

Detalhe em [contracts/memory-store.md](./contracts/memory-store.md#ddl).

```text
memories
────────
id          TEXT PK                                   "mem-<uuid>"
user_id     TEXT NOT NULL
fact        TEXT NOT NULL
embedding   BLOB NOT NULL CHECK (length(embedding) = 1536)   384 × float32 (R-007)
created_at  TEXT NOT NULL                              ISO-8601 UTC
(rowid implícito — desempate de recall, R-008)

idx_memories_user ON memories(user_id)
```

Sem chave estrangeira: usuário não tem tabela (spec, Key Entities).

### Mapeamento linha → domínio

| Coluna | Uso |
|---|---|
| `id` | `memoryId` |
| `fact` | `fact` |
| `embedding` | `Float32Array` por cópia (R-007); tamanho validado na leitura; nunca sai do store |
| `created_at` | gravado, não exposto nesta feature |
| `rowid` | só desempate (R-008) |

---

## Métricas — `src/trace/types.ts`

```ts
export interface RunMetrics {
  llmCalls: number;
  latencyMs: number;
  historyMessages?: number;   // 007
  recalledMemories?: number;  // 008 — 0..3, só com userId (R-016)
}
```

## `RunOptions` — `src/agents/types.ts`

```ts
export interface RunOptions {
  maxIterations?: number;
  signal?: AbortSignal;
  /** 008: ferramentas acrescentadas às de operação nesta execução (R-011). */
  extraTools?: ClientTool[];
}
```

---

## Borda HTTP — `src/http/chat.ts`

`chatRequestSchema` ganha `userId: userIdSchema.optional()`. Resposta 200 inalterada no
formato; `metrics.recalledMemories` aparece só quando `userId` foi informado. Nenhum código
de erro novo.

---

## Fluxo de um pedido com `userId`

```text
corpo (400) → estratégia (422) → conversa (404) → ┌─── dentro do prazo (180 s) ─────────────────┐
                                                   │ recall(userId, message)                     │
                                                   │   falhou ⇒ log + memories = []   (R-013)    │
                                                   │ withConversationHistory(                    │
                                                   │   withMemory(strategy,                      │
                                                   │     { memories, tools: memoryTools(userId) }),│
                                                   │   history).run(message, opts)               │
                                                   └─────────────────────────────────────────────┘
                                                   → grava turno (007) → 200
```

Sem `userId`: a caixa só tem `withConversationHistory(strategy, history).run(...)`, como
hoje.
