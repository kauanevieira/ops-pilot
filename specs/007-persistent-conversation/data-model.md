# Data Model: Conversa Persistente

**Feature**: `007-persistent-conversation` | **Fase**: 1 | **Data**: 2026-09-21

Tipos de domínio, esquema físico e o mapeamento entre eles. Decisões referenciadas por
R-xxx estão em [research.md](./research.md).

---

## Tipos de domínio — `src/domain/schemas.ts`

Definidos uma vez como esquemas zod e inferidos (Princípio I). Nenhum tipo paralelo.

```ts
export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const conversationMessageSchema = z.object({
  role: messageRoleSchema,
  content: z.string().min(1),
  createdAt: z.date(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

/** O que `append` recebe: relógio é do store (R-013), não de quem chama. */
export const newConversationMessageSchema = conversationMessageSchema.omit({ createdAt: true });
export type NewConversationMessage = z.infer<typeof newConversationMessageSchema>;
```

| Campo | Regra | Requisito |
|---|---|---|
| `role` | `"user"` (quem pediu) ou `"assistant"` (resposta final do agente) — conjunto fechado | FR-002, FR-003 |
| `content` | texto não vazio, sem limite de tamanho | FR-002, edge case |
| `createdAt` | instante do registro, atribuído pelo store | FR-002, R-013 |

`ConversationMessage` **não** expõe o `id` interno da linha nem o `conversationId`: quem lê
já sabe de qual conversa pediu, e a ordem é a da lista devolvida (R-004).

A conversa em si não tem tipo de domínio além do identificador (`string` opaca): nenhum
consumidor lê `created_at` nesta feature.

### Erro de domínio — `src/domain/errors.ts`

```ts
export class ConversationNotFoundError extends DomainError {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
    this.conversationId = conversationId;
  }
}
```

Lançado por `append` e `lastMessages` (R-002). Traduzido pelo handler HTTP em 404
`conversation_not_found`.

---

## Métricas — `src/trace/types.ts`

```ts
export interface RunMetrics {
  llmCalls: number;
  latencyMs: number;
  /** 007: mensagens de histórico entregues à estratégia (0..HISTORY_WINDOW). Só a API preenche. */
  historyMessages?: number;
}
```

Opcional por R-009. Na resposta de `/chat` está sempre presente.

---

## Esquema físico — `CONVERSATION_SCHEMA_SQL`

Detalhe completo em [contracts/database-schema.md](./contracts/database-schema.md).

```text
conversations                      messages
─────────────                      ────────
id          TEXT PK   ◄──────┐     id              INTEGER PK   (ordem total, R-004)
created_at  TEXT NN          └──── conversation_id TEXT NN FK
                                   role            TEXT NN CHECK IN ('user','assistant')
                                   content         TEXT NN
                                   created_at      TEXT NN      (ISO-8601 UTC)

idx_messages_conversation ON messages(conversation_id, id)
```

### Mapeamento linha → domínio

| Coluna | Campo | Conversão |
|---|---|---|
| `messages.role` | `role` | validado por `messageRoleSchema` (defesa em profundidade além do `CHECK`) |
| `messages.content` | `content` | direto |
| `messages.created_at` | `createdAt` | `z.coerce.date()` — nunca `Date` ligado a parâmetro (004, R-003) |
| `messages.id`, `conversation_id` | — | usados só para ordenar e filtrar; não vão ao domínio |

Toda leitura passa por `messageRowSchema.parse` — mesmo padrão de `alertRowSchema` em
`SqliteOpsStore` (004, FR-023).

---

## Entidades de borda HTTP — `src/http/chat.ts`

### `ChatRequest` (alterado)

```ts
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "message é obrigatória e não pode ser vazia."),
  strategy: z.string().trim().min(1, "strategy não pode ser vazia.").optional(),
  reflect: z.boolean().optional().default(false),
  conversationId: z.string().trim().min(1, "conversationId não pode ser vazio.").optional(), // NOVO
});
```

### `ChatResponse` (alterado)

`StrategyResult` + `conversationId: string`. `metrics.historyMessages` sempre presente.

### `ChatErrorCode` (alterado)

`"invalid_body" | "unknown_strategy" | "conversation_not_found" | "timeout" | "internal"`.

---

## Histórico no prompt — `src/agents/conversation-history.ts`

| Nome | Tipo | Papel |
|---|---|---|
| `HISTORY_WINDOW` | `12` | teto único de mensagens (FR-018, R-010) |
| `formatHistoryInput(history, input)` | pura | texto entregue à estratégia; `history = []` ⇒ devolve `input` intacto (R-007) |
| `withConversationHistory(strategy, history)` | decorador | chama `strategy.run(formatHistoryInput(...))` e acrescenta `metrics.historyMessages = history.length` (R-008, R-009) |

Rótulos no texto: `user` → `[plantonista]`, `assistant` → `[OpsPilot]`.

---

## Ciclo de vida de um turno

```text
pedido ─► valida corpo ─► resolve estratégia ─► conversationId?
                                                 │
                         ┌───── sim ─────────────┴───────── não ─────┐
                         ▼                                           ▼
          lastMessages(id, 12)                               history = []
          (ConversationNotFoundError ⇒ 404)
                         │                                           │
                         └──────────► withConversationHistory ◄──────┘
                                              │
                                  race(run, timeout)
                                   │                  │
                               resultado          timeout/erro
                                   │                  │
                     id ?? create()│             504/500, nada gravado
                append(id, [user, assistant])  (atômico)
                                   │
                    200 { ...result, conversationId }
```
