# Data Model: Sumarização de Histórico

**Feature**: 011-history-summarization

## Constantes

| Nome | Valor | Onde | Origem |
|---|---|---|---|
| `HISTORY_WINDOW` | **8** (era 12) | `src/agents/conversation-history.ts` | FR-001, emenda à 007 |
| `SUMMARY_BATCH` | 8 | `src/context/conversation-context.ts` | FR-003 |
| `MAX_VERBATIM_MESSAGES` | `HISTORY_WINDOW + SUMMARY_BATCH − 1` = 15 | idem | FR-019 |
| `SUMMARY_TARGET_TOKENS` | 150 | `src/context/summarizer.ts` (texto do prompt) | FR-007 |
| `SUMMARY_MAX_CHARS` | 800 (= 200 tokens estimados) | `src/domain/schemas.ts` | FR-007, R-008 |
| `SUMMARY_TIMEOUT_MS` | 30 000 | `src/context/conversation-context.ts` | FR-010, R-006 |

## Entidade de domínio: `ConversationSummary`

Definida uma vez em `src/domain/schemas.ts` (Princípio I).

```ts
export const SUMMARY_MAX_CHARS = 800;

export const summaryContentSchema = z.string().trim().min(1).max(SUMMARY_MAX_CHARS);

export const conversationSummarySchema = z.object({
  content: summaryContentSchema,
  /** Mensagens 0..coveredMessages−1 da conversa estão no resumo (R-001). */
  coveredMessages: z.number().int().positive(),
  updatedAt: z.date(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** O que `saveSummary` aceita; `updatedAt` é da borda (o store). */
export const newConversationSummarySchema = conversationSummarySchema.omit({ updatedAt: true });
export type NewConversationSummary = z.infer<typeof newConversationSummarySchema>;
```

**Regras**
- No máximo um por conversa. Cada gravação substitui a anterior (FR-012).
- `coveredMessages` só cresce: uma gravação que não o aumenta é descartada (FR-014, R-003).
- Nunca apagado nesta feature.

## Tabela `conversation_summaries`

Acrescentada a `CONVERSATION_SCHEMA_SQL`. Ver [contracts/database-schema.md](./contracts/database-schema.md).

| Coluna | Tipo | Restrição |
|---|---|---|
| `conversation_id` | TEXT | PRIMARY KEY, REFERENCES conversations(id) |
| `content` | TEXT | NOT NULL, CHECK (length(content) BETWEEN 1 AND 800) |
| `covered_messages` | INTEGER | NOT NULL, CHECK (covered_messages > 0) |
| `updated_at` | TEXT | NOT NULL (ISO-8601 UTC) |

## Estado derivado: plano de contexto (puro)

`planConversationContext({ totalMessages, coveredMessages })`, função pura sem I/O:

```text
pending    = max(0, totalMessages − HISTORY_WINDOW − coveredMessages)
summarize  = pending ≥ SUMMARY_BATCH ? { offset: coveredMessages, count: pending } : null
```

Depois de resolvida a sumarização (com sucesso ou não), com `covered` = cobertura do resumo
vigente:

```text
verbatimStart = max(covered, totalMessages − MAX_VERBATIM_MESSAGES)
verbatim      = messagesRange(conversationId, verbatimStart, totalMessages − verbatimStart)
```

Com sucesso, `covered = totalMessages − 8`, e portanto `verbatim` tem exatamente as 8 mais
recentes. Com falha, `verbatim` tem de 8 a 15 mensagens.

### Transições (uma conversa ao longo dos turnos; cada turno grava 2 mensagens)

| Mensagens gravadas ao chegar o pedido | Resumo antes | Pendentes | Sumariza? | Resumo depois | Na íntegra |
|---|---|---|---|---|---|
| 0–8 | — | 0 | não | — | todas |
| 10, 12, 14 | — | 2, 4, 6 | não | — | 10, 12, 14 |
| 16 | — | 8 | **sim** (0..7) | cobre 8 | 8 |
| 18, 20, 22 | cobre 8 | 2, 4, 6 | não | cobre 8 | 10, 12, 14 |
| 24 | cobre 8 | 8 | **sim** (8..15) | cobre 16 | 8 |
| 32 | cobre 16 | 8 | **sim** (16..23) | cobre 24 | 8 |

Chamadas ao sumarizador numa conversa de N mensagens: ⌊(N − 8) / 8⌋ no máximo (SC-001).

## Resultado da preparação: `ConversationContext`

Não é entidade de domínio (não é validado nem persistido); vive em
`src/context/conversation-context.ts`.

```ts
interface ConversationContext {
  summary: string | null;            // resumo vigente entregue ao agente
  summaryCoveredMessages: number;    // 0 sem resumo
  messages: ConversationMessage[];   // na íntegra, 0..15
  summarizeEvent?: SummarizeEvent;   // só quando um resumo novo foi gravado neste pedido
}
```

Sem `conversationId`: `{ summary: null, summaryCoveredMessages: 0, messages: [] }`.

## Rastro: `TraceEvent` ganha um membro

```ts
| { type: "summarize"; content: string; absorbedMessages: number }
```

`content` é o resumo novo, como gravado (depois do teto). `absorbedMessages` é quantas
mensagens esta sumarização incorporou (`count` do plano).

## Métricas: acréscimos a `RunMetrics` e `ContextBreakdown`

```ts
interface RunMetrics {
  // …existentes
  /** 011: mensagens cobertas pelo resumo entregue; 0 sem resumo. Só withConversationHistory seta. */
  summaryCoveredMessages?: number;
}

interface ContextBreakdown {
  message: number;
  history: number;   // só as mensagens na íntegra (inalterado)
  summary: number;   // NOVO: estimateTokens(formatSummaryBlock(summary)); 0 sem resumo
  memories: number;
  total: number;     // message + history + summary + memories
}
```

`historyMessages` continua sendo o número de mensagens entregues na íntegra.

## Entrada do sumarizador

```ts
interface SummarizerInput {
  previousSummary: string | null;
  messages: ConversationMessage[];   // as `count` pendentes, em ordem cronológica
}
type Summarizer = (input: SummarizerInput, signal: AbortSignal) => Promise<string>;
```
