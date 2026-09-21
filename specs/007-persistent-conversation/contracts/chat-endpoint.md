# Contract: `POST /chat` — acréscimos de conversa

**Feature**: `007-persistent-conversation` | Satisfaz FR-009 a FR-023

Emenda a [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md).
Tudo o que lá está continua valendo; abaixo, só o que muda. O contrato da 003 ganha um
aviso no topo apontando para esta emenda (Princípio III).

## Requisição

```jsonc
{
  "message": "e o runbook dele?",
  "strategy": "react",
  "reflect": false,
  "conversationId": "conv-3f2a…"   // NOVO — opcional; string não vazia, opaca
}
```

- Ausente ⇒ conversa nova, criada **só se a execução tiver sucesso** (R-006).
- Espaços nas pontas são descartados.
- Nenhum formato é exigido além de "string não vazia" (R-011).

## Resposta 200

```jsonc
{
  "answer": "O runbook do checkout-api é ...",
  "trace": [ ... ],
  "metrics": { "llmCalls": 3, "latencyMs": 8421, "historyMessages": 2 },  // historyMessages NOVO
  "stoppedReason": "completed",
  "conversationId": "conv-3f2a…"                                          // NOVO
}
```

- `conversationId`: o informado, ou o da conversa recém-criada. Sempre presente.
- `metrics.historyMessages`: mensagens de histórico entregues à estratégia, `0..12`.
  Sempre presente; `0` numa conversa nova.

## Nova resposta de erro

### 404 — `conversation_not_found` (FR-013)

Corpo válido, estratégia válida, mas `conversationId` não corresponde a nenhuma conversa.
Nenhuma execução é iniciada.

```jsonc
{
  "error": {
    "code": "conversation_not_found",
    "message": "Conversa não encontrada: conv-xyz",
    "details": { "conversationId": "conv-xyz" }
  }
}
```

### 400 — `invalid_body` (ampliado)

Também disparado por `conversationId` vazio, só com espaços, ou não-string.

## Ordem das checagens

corpo (400) → estratégia (422) → conversa (404) → execução (504 / 500) → gravação do turno → 200.
A primeira falha responde; nada depois dela roda.

## Efeitos de persistência

| Desfecho | O que é gravado |
|---|---|
| 200 (inclusive `max-iterations` / `max-steps` / `max-reflections`) | um turno: `[{role:"user", content: message}, {role:"assistant", content: answer}]`, atomicamente (FR-014) |
| 400, 422, 404 | nada |
| 504 (timeout), mesmo que a execução termine depois | nada; nenhuma conversa nova (FR-015) |
| 500 durante a execução | nada |
| 500 ao gravar o turno | nada da gravação (transação desfeita) |
| Cliente desistiu, execução concluiu dentro do prazo | o turno é gravado |

O `content` do `user` é a `message` do corpo como recebida (após `trim`), **nunca** o
texto com histórico montado para a estratégia (FR-020).

## Composição (R-008)

```ts
const history = conversationId ? conversationStore.lastMessages(conversationId, HISTORY_WINDOW) : [];
const strategy = withConversationHistory(resolveStrategy(selection, store), history);
```

O decorador de histórico é a camada mais externa — por fora de `withReflection` e de
`withIncidentConfirmation`. `resolveStrategy` e o registro não mudam.

## Injeção — `ChatAppDeps`

```ts
export interface ChatAppDeps {
  store?: OpsRepository;
  conversationStore?: ConversationStore;   // NOVO — default: new InMemoryConversationStore()
  resolveStrategy?: ResolveStrategy;
  timeoutMs?: number;
}
```

`src/index.ts` injeta `new SqliteConversationStore(db)` sobre a mesma conexão do
`SqliteOpsStore`.
