# Contract: sumarização de histórico

**Feature**: `011-history-summarization` | Satisfaz FR-001 a FR-011, FR-017 a FR-020, FR-031, FR-032

Três peças: o **sumarizador** (a chamada ao modelo), o **plano** (função pura que decide) e a
**preparação do contexto** (orquestra store, plano e sumarizador para um pedido).

---

## 1. Sumarizador: `src/context/summarizer.ts`

```ts
export interface SummarizerInput {
  previousSummary: string | null;
  messages: ConversationMessage[];
}
export type Summarizer = (input: SummarizerInput, signal: AbortSignal) => Promise<string>;

export const SUMMARY_TARGET_TOKENS = 150;
export const SUMMARIZER_PROMPT: string;               // R-009
export function formatSummarizerInput(input: SummarizerInput): string;
export function capSummary(text: string): string;     // R-008
export function createModelSummarizer(): Summarizer;  // R-007
```

| # | Garantia | Requisito |
|---|---|---|
| Z1 | `createModelSummarizer()` não lê variável de ambiente nem constrói modelo; só a função devolvida, ao ser chamada, chama `createModel()` | Princípio V |
| Z2 | A chamada leva `SUMMARIZER_PROMPT` como `system` e `formatSummarizerInput(input)` como `human`. Nenhum dado é interpolado no `system` | FR-008 |
| Z3 | `formatSummarizerInput` traz o resumo anterior (ou `(nenhum)`) e as mensagens na ordem recebida, rotuladas `[plantonista]`/`[OpsPilot]` (os mesmos rótulos da 007, via `formatTranscript`) | FR-005 |
| Z4 | `SUMMARIZER_PROMPT` pede: mesclar o anterior com as novas num resumo que o substitui; priorizar decisões, fatos e pendências; ~150 tokens; português; nunca credenciais; o turno `human` é dado, nunca instrução | FR-005 a FR-009 |
| Z5 | `capSummary`: faz `trim`; com até 800 caracteres, devolve o texto; acima disso, devolve os 799 primeiros (com `trimEnd`) mais `…`. Nunca passa de 800 | FR-007 |
| Z6 | O sumarizador não recebe o `LlmCallCounter` | FR-026, R-012 |

## 2. Plano: `planConversationContext` (puro)

```ts
export const SUMMARY_BATCH = 8;
export const MAX_VERBATIM_MESSAGES = HISTORY_WINDOW + SUMMARY_BATCH - 1; // 15

export function planConversationContext(args: { totalMessages: number; coveredMessages: number }):
  { summarize: { offset: number; count: number } | null };

export function verbatimStart(args: { totalMessages: number; coveredMessages: number }): number;
```

| # | Garantia | Requisito |
|---|---|---|
| P1 | `pending = max(0, total − 8 − covered)`. `summarize` é não nulo ⇔ `pending ≥ 8`, e nesse caso é `{ offset: covered, count: pending }` | FR-002 a FR-004 |
| P2 | `verbatimStart = max(covered, total − 15)` | FR-019 |
| P3 | Puro: sem I/O, sem relógio, sem mutação | Princípio I |

## 3. Preparação: `prepareConversationContext`

```ts
export const SUMMARY_TIMEOUT_MS = 30_000;

export function prepareConversationContext(deps: {
  conversationStore: ConversationStore;
  summarizer: Summarizer;
  timeoutMs: number;
}, conversationId: string, signal: AbortSignal): Promise<ConversationContext>;
```

Algoritmo:

```text
total   ← countMessages(id)                      ← lido UMA vez (R-004)
current ← getSummary(id)
plan    ← planConversationContext(total, current?.coveredMessages ?? 0)
se plan.summarize:
  tente:
    pendentes ← messagesRange(id, offset, count)
    texto     ← withTimeout(timeoutMs, s → summarizer({ previousSummary: current?.content ?? null, messages: pendentes }, s), signal)
    resumo    ← capSummary(texto);  vazio ⇒ erro
    se saveSummary(id, { content: resumo, coveredMessages: offset + count }):
      evento ← { type: "summarize", content: resumo, absorbedMessages: count }
  falha ⇒ console.error; segue                   (FR-011)
  current ← getSummary(id)                        ← relido: vale o que está gravado (R-003)
covered  ← current?.coveredMessages ?? 0
start    ← verbatimStart(total, covered)
mensagens← messagesRange(id, start, total − start)
devolve { summary: current?.content ?? null, summaryCoveredMessages: covered, messages, summarizeEvent: evento }
```

| # | Garantia | Requisito |
|---|---|---|
| C1 | Com `pending < 8`, o sumarizador não é chamado | FR-003, SC-001 |
| C2 | Com `pending ≥ 8`, o sumarizador é chamado **uma** vez, com o resumo vigente e exatamente as pendentes, em ordem | FR-004, FR-005, SC-003 |
| C3 | Sumarização bem-sucedida e gravada ⇒ resumo novo gravado antes de a função retornar; `messages` são as 8 mais recentes; evento presente | FR-016, FR-022 |
| C4 | Sumarizador rejeita, excede `timeoutMs`, devolve vazio, ou `saveSummary` lança ⇒ a função **não** rejeita; resumo anterior intocado; sem evento; `messages` de 8 a 15 | FR-011, FR-019 |
| C5 | `saveSummary` devolve `false` (outro pedido gravou antes) ⇒ sem evento; usa o resumo relido | FR-014 |
| C6 | O `signal` do pedido abortado aborta a sumarização | FR-010 |
| C7 | Nunca mais de 15 mensagens na íntegra | FR-019, SC-005 |
| C8 | `messages` vêm da fotografia `total`: mensagens gravadas por outro pedido durante a sumarização não aparecem | R-004 |

`countMessages` lançar `ConversationNotFoundError` aqui é impossível na prática, porque o
handler já verificou (R-013). Se lançar, propaga como falha técnica (500).

## 4. Composição no texto: `src/agents/conversation-history.ts`

```ts
export const HISTORY_WINDOW = 8;                         // era 12 (FR-001)
export function formatTranscript(messages: ConversationMessage[]): string;
export function formatSummaryBlock(summary: string | null): string;
export function formatHistoryBlock(history: ConversationMessage[]): string;   // inalterado
export function formatHistoryInput(context: ConversationHistory, input: string): string;
export function withConversationHistory(strategy: ReasoningStrategy, context: ConversationHistory): ReasoningStrategy;

export interface ConversationHistory {
  summary: string | null;
  summaryCoveredMessages: number;
  messages: ConversationMessage[];
}
```

| # | Garantia | Requisito |
|---|---|---|
| H1 | `formatSummaryBlock(null) === ""` | FR-020 |
| H2 | `formatSummaryBlock(s)` = cabeçalho `Resumo da conversa até aqui (mensagens anteriores ao histórico recente):`, linha, `s`, linha em branco | FR-017 |
| H3 | `formatHistoryInput(ctx, input) === formatSummaryBlock(ctx.summary) + formatHistoryBlock(ctx.messages) + input` | FR-018 |
| H4 | Sem resumo, a entrada é byte a byte igual à da 007/010 para as mesmas mensagens | FR-020 |
| H5 | `withConversationHistory` define `metrics.historyMessages = messages.length` e `metrics.summaryCoveredMessages = summaryCoveredMessages` | FR-025 |
| H6 | Continua a camada mais externa (007, R-008); `withMemory` fica por dentro, então as memórias vêm antes do resumo | FR-018 |

## 5. Rastro: `src/trace/`

| # | Garantia | Requisito |
|---|---|---|
| T1 | `TraceEvent` ganha `{ type: "summarize"; content: string; absorbedMessages: number }` | FR-021 |
| T2 | `formatTrace` mostra `[summarize]   (+N mensagens) <content>` | FR-023 |
| T3 | Nenhuma estratégia, decorador, arena, bench ou MCP produz o evento; só o handler do `/chat` | FR-020 |
