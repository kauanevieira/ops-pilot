# Contract: medição de tokens

**Feature**: `010-context-measurement` | Satisfaz FR-001 a FR-009, FR-023 a FR-025

Módulos: `src/context/tokens.ts` (puro), `src/context/breakdown.ts` (puro),
`src/agents/llm-counter.ts` (callback), `src/agents/reflection.ts` (soma entre camadas).

## `estimateTokens(text: string): number`

`Math.ceil(text.length / 4)`. Pura, determinística, não importa nada do LangChain.

| Entrada | Saída | Regra |
|---|---|---|
| `""` | `0` | E1: vazio é 0 (FR-003) |
| `"a"`, `"abc"` | `1` | E2: arredonda para cima |
| `"abcd"` | `1` | E3: divisão exata |
| `"abcde"` | `2` | E2 |
| `"ação"` | `1` | E4: 4 unidades UTF-16 (NFC), não 6 bytes |
| mesmo texto, duas vezes | igual | E5: determinística |

## `inputTokensFromResult(output: LLMResult): number | undefined`

Lê `output.generations[0]?.[0]`. Se for geração de chat cuja `message` é `AIMessage` com
`usage_metadata.input_tokens` numérico, devolve esse número; senão `undefined`.

| Resultado da chamada | Saída | Regra |
|---|---|---|
| `AIMessage` com `usage_metadata: { input_tokens: 120, … }` | `120` | U1 |
| `input_tokens: 0` | `0` | U2: zero é reportado |
| `AIMessage` sem `usage_metadata` | `undefined` | U3 |
| `generations` vazio, ou geração sem `message` (LLM de texto) | `undefined` | U4 |

Fonte única: `usage_metadata` (research R-001). `llmOutput.tokenUsage` não é lido.

## `sumPromptTokens(...values): number | undefined`

| Entrada | Saída |
|---|---|
| `()` | `0` |
| `(10, 20)` | `30` |
| `(10, undefined)` | `undefined` |
| `(0, 0)` | `0` |

## `LlmCallCounter` (alterado)

Continua sendo uma instância por `run()`. Ganha `handleLLMEnd` e o getter `promptTokens`.

- **K1**: `calls` inalterado (conta em `handleChatModelStart`). Nenhum teste existente de
  `llmCalls` muda.
- **K2**: com N chamadas que reportam `t1…tN`, `promptTokens === Σ ti`.
- **K3**: se alguma chamada iniciada não termina com consumo (sem `usage_metadata`, ou falhou
  sem `handleLLMEnd`), `promptTokens === undefined`.
- **K4**: sem chamadas, `promptTokens === 0`.
- **K5**: duas instâncias não compartilham estado.

Testes disparam os callbacks direto no contador (`handleChatModelStart()`,
`handleLLMEnd(resultado)`) com `LLMResult` montados à mão com `new AIMessage({ content,
usage_metadata })`. Nada chama modelo.

## Produtores de `metrics.promptTokens`

| Produtor | Valor |
|---|---|
| ReAct (`react.ts`), os dois retornos | `counter.promptTokens` |
| plan-and-execute | `counter.promptTokens` (planejador, passos, replanejador no mesmo contador) |
| `withReflection`, todos os retornos com revisão | `sumPromptTokens(tentativa₁, …, tentativaₙ, critiqueCounter.promptTokens)` |
| `withReflection`, `maxReflections <= 0` | o da tentativa, intacto |
| `withConversationHistory`, `withMemory`, `withIncidentConfirmation` | repassam `metrics` com spread, sem tocar |

Em todos: a chave só é escrita quando o valor é número (`...(pt !== undefined && {
promptTokens: pt })`), para que "ausente" seja ausência de chave (data-model).

- **R1**: reflexão com crítico que dispara os callbacks recebidos com consumo soma o crítico
  (o dublê atual de `reflection.test.ts` já dispara `handleChatModelStart`; passa a disparar
  também `handleLLMEnd`).
- **R2**: tentativa sem `promptTokens` deixa o total refletido sem `promptTokens`.
- **R3**: crítico que falha depois de iniciar a chamada deixa o total sem `promptTokens` (a
  chamada foi contada e não reportou).

## Invariante da fábrica de modelo

`createModel()` MUST NOT ligar `streaming: true`: nesse modo o `ChatOpenAI` escreve em
`usage_metadata` uma estimativa local por tiktoken, indistinguível do consumo real (research
R-002). Um comentário na fábrica registra isso.

## `buildContextBreakdown({ message, history, memories }): ContextBreakdown`

Em `src/context/breakdown.ts`. Usa `formatHistoryBlock` (de `agents/conversation-history.ts`)
e `formatMemoriesBlock` (de `memory/with-memory.ts`), extraídos das funções `format*Input`
sem mudar o texto que produzem.

- **B1**: sem histórico e sem memórias: `{ message: estimateTokens(message), history: 0,
  memories: 0, total: message }`.
- **B2**: `history === estimateTokens(formatHistoryBlock(history))`.
- **B3**: `memories === estimateTokens(formatMemoriesBlock(memories))`.
- **B4**: `formatHistoryInput(h, formatMemoriesInput(m, msg)) ===
  formatHistoryBlock(h) + formatMemoriesBlock(m) + msg` para qualquer `h`, `m`, `msg`.
  Garante que os blocos medidos são exatamente os entregues.
- **B5**: `format*Input` com lista vazia continua devolvendo o `input` intacto (007 FR-023,
  008 FR-023). Os testes existentes dessas funções passam sem mudança.
