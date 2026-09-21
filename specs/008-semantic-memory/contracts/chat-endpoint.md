# Contract: `POST /chat` — acréscimos de memória

**Feature**: `008-semantic-memory` | Satisfaz FR-019 a FR-026

Emenda a [`003`](../../003-chat-http-api/contracts/chat-endpoint.md) e
[`007`](../../007-persistent-conversation/contracts/chat-endpoint.md). Tudo o que lá está
continua valendo. O contrato da 003 ganha, no aviso de emendas do topo, um apontamento para
este.

## Requisição

```jsonc
{
  "message": "quais serviços são meus?",
  "conversationId": "conv-…",   // 007, opcional
  "userId": "kauane"            // NOVO — opcional; string não vazia, opaca
}
```

`userId` vazio, só com espaços ou não-string ⇒ **400 `invalid_body`** (FR-020). Nenhum código
de erro novo.

## Resposta 200

Mesmo formato. Com `userId`:

```jsonc
"metrics": { "llmCalls": 3, "latencyMs": 8421, "historyMessages": 0, "recalledMemories": 1 }
```

Sem `userId`, `recalledMemories` **não aparece** (FR-024, SC-006).

## Comportamento com `userId`

1. Dentro do prazo de 180 s, antes da estratégia: `recall(userId, message)` — a mensagem crua,
   não o texto com histórico (R-013).
2. Falha em `recall` ⇒ `console.error`, segue sem fatos, `recalledMemories: 0` (FR-025).
3. Composição (R-012):
   ```ts
   withConversationHistory(
     withMemory(resolveStrategy(selection, store), { memories, tools: createMemoryTools(memoryStore, userId) }),
     history,
   )
   ```
4. Fatos recuperados vão antes do histórico e da mensagem, com o id entre colchetes. Nenhum fato
   ⇒ nenhum texto acrescentado (FR-023), mas as ferramentas continuam disponíveis.
5. `remember_fact`/`forget_fact` disponíveis ao agente; falha técnica delas ⇒ 500.

## Sem `userId`

Nenhuma chamada ao `MemoryStore`, nenhum `withMemory`, nenhuma ferramenta de memória. Idêntico à
007.

## O que é gravado na conversa (007)

Inalterado: a `message` crua e a resposta final. Os fatos recuperados **não** entram no
histórico da conversa — são recuperados de novo a cada pedido.

## Injeção — `ChatAppDeps`

```ts
memoryStore?: MemoryStore;   // default: new SqliteMemoryStore(new DatabaseSync(":memory:"), createLocalEmbedder())
```

O default não carrega o modelo: o gerador é preguiçoso, e nenhum pedido sem `userId` o toca.
`src/index.ts` injeta `new SqliteMemoryStore(db, createLocalEmbedder())` sobre a mesma conexão
dos outros stores. Testes injetam `SqliteMemoryStore(":memory:", createTableEmbedder(...))`.
