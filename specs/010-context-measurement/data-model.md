# Data Model: Medição de Contexto

**Feature**: 010-context-measurement | **Date**: 2026-09-21

Nenhuma mudança de banco. Nada desta feature é persistido; tudo existe só durante um pedido e
na resposta dele.

## RunMetrics (alterado, `src/trace/types.ts`)

Dois campos opcionais e aditivos (FR-014). Os existentes não mudam.

| Campo | Tipo | Quem preenche | Regra |
|---|---|---|---|
| `llmCalls` | `number` | estratégias, reflexão | inalterado |
| `latencyMs` | `number` | estratégias, reflexão | inalterado |
| `historyMessages?` | `number` | `withConversationHistory` | inalterado (007) |
| `recalledMemories?` | `number` | `withMemory` | inalterado (008) |
| **`promptTokens?`** | `number` (inteiro ≥ 0) | ReAct, plan-and-execute, `withReflection` | soma dos `input_tokens` reportados em todas as chamadas contadas em `llmCalls`. Ausente se alguma chamada contada não reportou (FR-005, FR-006). `0` quando `llmCalls === 0`. |
| **`contextBreakdown?`** | `ContextBreakdown` | só o handler do `/chat` | ver abaixo (FR-010) |

Ausente é ausente: a chave não aparece no objeto nem no JSON. Nunca `null`, nunca
`undefined` explícito como valor de chave (os testes usam `"promptTokens" in metrics`).

## ContextBreakdown (novo, `src/trace/types.ts`)

Estimativas, todas por `estimateTokens` (caracteres ÷ 4, arredondado para cima).

| Campo | Tipo | Texto estimado |
|---|---|---|
| `message` | `number` ≥ 0 | a `message` crua do corpo (já com `trim`, como validada) |
| `history` | `number` ≥ 0 | `formatHistoryBlock(history)`: cabeçalho, transcrição rotulada, linha vazia, "Mensagem atual do plantonista:". `0` sem histórico. |
| `memories` | `number` ≥ 0 | `formatMemoriesBlock(memories)`: cabeçalho, fatos com `[memoryId]`, linha vazia. `0` sem `userId` ou sem memórias. |
| `total` | `number` ≥ 0 | `message + history + memories` (FR-012) |

**Invariante de composição** (R-007): `historyBlock.length + memoriesBlock.length +
message.length === <entrada recebida pela estratégia>.length`. Como cada parcela é
arredondada para cima separadamente, `total` pode passar de `estimateTokens(entrada)` em até
2 tokens. É aceito: o total é definido como soma, não como estimativa do texto inteiro.

## Consumo por chamada (transitório, dentro do `LlmCallCounter`)

| Estado | Atualizado em | Significado |
|---|---|---|
| `calls` | `handleChatModelStart` | chamadas iniciadas (inalterado) |
| `reportedCalls` | `handleLLMEnd`, quando `inputTokensFromResult(output)` é número | chamadas que terminaram com consumo reportado |
| `promptTokenSum` | idem | soma desses consumos |
| `promptTokens` (getter) | — | `reportedCalls === calls ? promptTokenSum : undefined` |

Transições relevantes:
- chamada que termina com `usage_metadata.input_tokens` numérico: `reportedCalls++` e soma.
- chamada que termina sem consumo, ou falha (`handleLLMError`, sem `handleLLMEnd`): só
  `calls` avança, e o getter passa a `undefined` para o resto do run.

## Funções puras (`src/context/tokens.ts`)

| Função | Assinatura | Regra |
|---|---|---|
| `estimateTokens` | `(text: string) => number` | `Math.ceil(text.length / 4)` |
| `inputTokensFromResult` | `(output: LLMResult) => number \| undefined` | `input_tokens` do `usage_metadata` da primeira geração, se for `AIMessage` com número; senão `undefined` |
| `sumPromptTokens` | `(...values: (number \| undefined)[]) => number \| undefined` | `undefined` se algum for `undefined`; soma caso contrário; `0` para lista vazia |
