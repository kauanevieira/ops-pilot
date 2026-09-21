# Contract: `MemoryStore` e `Embedder`

**Feature**: `008-semantic-memory` | Satisfaz FR-001 a FR-018, FR-033, FR-034

---

## `Embedder` — `src/memory/embeddings.ts`

```ts
export interface Embedder {
  /** Vetor normalizado (norma 1), EMBEDDING_DIM posições. */
  embed(text: string): Promise<Float32Array>;
}

export function createLocalEmbedder(options?: { allowRemote?: boolean }): Embedder;
```

| # | Invariante | Requisito |
|---|---|---|
| E1 | O modelo é carregado no máximo uma vez por processo; chamadas concorrentes durante a carga compartilham a mesma carga | FR-008, R-003 |
| E2 | Nada é carregado antes do primeiro `embed` (nem o módulo da biblioteca) | FR-008, R-003 |
| E3 | Falha de carga não fica memorizada: a chamada seguinte tenta de novo | R-003 |
| E4 | `allowRemote: false` nunca acessa a rede; modelo ausente ⇒ rejeita | R-005 |
| E5 | Saída sempre com `EMBEDDING_DIM` posições e norma 1 (± 1e-5) | FR-007 |

`allowRemote` é por chamada de carga; o default é `true`. A biblioteca é configurada com
`env.cacheDir = MODEL_CACHE_DIR` antes de carregar.

---

## `MemoryStore` — `src/memory/memory-store.ts`

```ts
export interface MemoryStore {
  remember(userId: string, fact: string): Promise<RememberResult>;
  recall(userId: string, query: string): Promise<RecalledMemory[]>;
  forget(userId: string, memoryId: string): boolean;
}

export class SqliteMemoryStore implements MemoryStore {
  constructor(db: DatabaseSync, embedder: Embedder);
}
```

Mesmo padrão de `SqliteOpsStore`: recebe conexão aberta, aplica `MEMORY_SCHEMA_SQL` no
construtor, prepara todos os statements ali.

| # | Invariante | Requisito |
|---|---|---|
| M1 | `remember` com fato cuja maior proximidade com fatos do **mesmo** usuário é `> 0.92` ⇒ não grava; devolve `{ created: false, memoryId, fact }` do fato mais próximo | FR-010, FR-011 |
| M2 | Proximidade exatamente `0.92` ⇒ grava (limiar estrito) | FR-010 |
| M3 | Fato de outro usuário, mesmo idêntico, nunca conta como duplicata | FR-003 |
| M4 | `recall` devolve ≤ 3, todos com `score >= 0.3`, ordenados por `score` decrescente | FR-013, FR-014 |
| M5 | `score` exatamente `0.3` entra (limiar inclusivo) | FR-014 |
| M6 | Empate de `score` ⇒ mais recente (maior `rowid`) primeiro | FR-016 |
| M7 | `recall` de usuário sem fatos ⇒ `[]`, sem erro | edge case |
| M8 | `recall` nunca devolve fato de outro usuário | FR-003 |
| M9 | `forget` do próprio fato ⇒ `true`, e o fato nunca mais aparece em `recall` | FR-017 |
| M10 | `forget` de id inexistente, já esquecido ou de outro usuário ⇒ `false`, nada apagado | FR-018 |
| M11 | Dedup é atômico: duas chamadas concorrentes com o mesmo fato gravam um só | R-009 |
| M12 | Reabrir o banco não falha e não perde memórias | FR-004 |
| M13 | Vetor de tamanho errado é rejeitado pelo banco (`CHECK`) e pela leitura | R-007 |
| M14 | `fact` é gravado como recebido após `trim`; validação de tamanho é da borda (esquema da ferramenta) | FR-012 |

`remember` e `recall` propagam a rejeição do `Embedder` sem tratá-la — quem decide entre
fail-open e falha técnica é o chamador (R-013).

---

## DDL

`MEMORY_SCHEMA_SQL` em `src/memory/memory-store.ts` (junto do store que o aplica — a tabela
não é usada por mais ninguém):

```sql
CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  fact       TEXT NOT NULL,
  embedding  BLOB NOT NULL CHECK (length(embedding) = 1536),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
```

## Statements (todos preparados no construtor)

```sql
SELECT id, fact, embedding, rowid FROM memories WHERE user_id = ?          -- remember (dedup) e recall
INSERT INTO memories (id, user_id, fact, embedding, created_at) VALUES (?, ?, ?, ?, ?)
DELETE FROM memories WHERE id = ? AND user_id = ?                           -- forget
```

## Testes

| Arquivo | Gerador | Cobre |
|---|---|---|
| `src/memory/memory-store.test.ts` | `createTableEmbedder` (falso, R-004) sobre `":memory:"` | M1, M3, M4, M6–M14; reabertura em arquivo em `os.tmpdir()` |
| `src/memory/memory-store.test.ts` | nenhum (predicados puros) | M2 e M5 no limiar exato — `isDuplicateScore`/`isRecallable` exportados e testados com `number`s diretos, não por vetor: `float32(0.92)` como double é `0.9200000166893005` (verificado), sempre acima do literal `0.92`, então nenhum vetor "no limiar exato" sobrevive ao arredondamento do BLOB sem essa fuga |
| `src/memory/embeddings.test.ts` | real, `allowRemote: false`; **pulado** se o modelo não estiver em cache | E4, E5; e FR-034: fato recuperado por consulta sem palavra em comum, com o `SqliteMemoryStore` real |
| `src/memory/embeddings.test.ts` | função de carga falsa injetada | E1, E3 (sem o modelo) |

Par do teste FR-034 (medido, R-002): fato "Meu time de plantão é o de pagamentos", consulta
"quem cobre cobranças e faturamento?" — 0,635, nenhuma palavra em comum; e a consulta
"como reinicio o banco de dados?" (0,026) não o recupera.

Para E1/E3 sem o modelo, `embeddings.ts` expõe a fábrica interna
`createEmbedderFromLoader(load)`; `createLocalEmbedder` é ela aplicada à carga real.
