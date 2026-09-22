# Data Model: Resiliência de Modelo

**Feature**: 013-model-resilience | **Date**: 2026-09-22

Nenhuma tabela nova, nenhuma mudança no banco. Tudo abaixo vive em memória, dentro de uma
chamada ou de um pedido.

## Domínio (`src/domain/schemas.ts`)

| Esquema | Definição | Regras |
|---|---|---|
| `failureKindSchema` | `z.enum(["timeout", "rate_limit", "provider_error", "network", "non_transient"])` | Tipo de falha do principal (FR-012). Nova tentativa só para `rate_limit`, `provider_error` e `network` (FR-005) |
| `modelIdSchema` | `z.string().trim().min(1)` | Valida `OPENROUTER_MODEL` e `OPENROUTER_MODEL_FALLBACK` na leitura |

Tipos: `FailureKind`, e o conjunto `RETRYABLE_FAILURES`, derivado do enum.

## Fábrica (`src/agents/model.ts`)

| Símbolo | Tipo | Papel |
|---|---|---|
| `MAX_PRIMARY_ATTEMPTS` | `3` | FR-004 |
| `ModelSource` | `{ primary(): SourcedModel; backup(): SourcedModel \| null }` | Injetável (R-005) |
| `SourcedModel` | `{ id: string; model: BaseChatModel }` | |
| `envModelSource()` | `ModelSource` | Lê o ambiente só em `primary()`/`backup()`. `backup()` é `null` sem reserva, com valor vazio ou igual ao principal (FR-002) |
| `createChatModel(id)` | `ChatOpenAI` | O `createModel` de hoje, parametrizado, com `maxRetries: 0` (R-003) |
| `resilient(build, source?)` | `Runnable<I, O>` | `withRetry` no principal e `withFallbacks([reserva])` (R-001) |
| `classifyModelError(error, signal?)` | pura, `FailureKind \| "aborted"` | Tabela da R-004 |
| `runWithResilienceScope(fn)` | `Promise<T>` | Escopo por pedido: a troca vale para o resto do pedido (R-006) |
| `ModelUnavailableError` | `Error` com `tried: string[]` e `reason: FailureKind` | Nenhum modelo atendeu (R-011) |
| `MODEL_USED_EVENT`, `MODEL_FALLBACK_EVENT` | `"opspilot:model_used"`, `"opspilot:model_fallback"` | Nomes dos eventos customizados (R-007) |

`createModel()` deixa de existir. Os 7 pontos de chamada passam a usar `resilient`.

### Fluxo de uma chamada

```text
resilient(build)(input, config)
  primaryStep:
    escopo.primaryDown?        -> lança "pulado"          (vai ao reserva, sem tentativas)
    build(primary).invoke      -> ok: model_used{primary}; devolve
                               -> erro: classify
                                   aborted            -> relança (sem reserva)
                                   retentável         -> nova tentativa (até 3)
                                   timeout/non_trans. -> encerra tentativas
  withFallbacks:
    signal abortado?           -> relança AbortError
    sem reserva                -> ModelUnavailableError{tried:[primary]}
    backupStep:
      se o principal não foi pulado: escopo.primaryDown = true; model_fallback{from, to, reason}
      build(backup).invoke     -> ok: model_used{backup}; devolve
                               -> erro não-abort: ModelUnavailableError{tried:[primary, backup]}
```

`reason` é a classificação do último erro do principal. Uma chamada que pulou o principal pelo
escopo não despacha `model_fallback`: a troca já foi registrada pela chamada que a provocou (MF7).

## Rastro e métricas (`src/trace/types.ts`)

```ts
| { type: "fallback"; from: string; to: string; reason: FailureKind }   // + nodeName? (012)
```

| Campo | Onde | Regra |
|---|---|---|
| `RunMetrics.modelUsed?: string` | react, plan-and-execute, withReflection | Modelo da última chamada atendida da estratégia (FR-015, R-009) |
| `RunMetrics.llmCalls` | inalterado no tipo | Passa a contar só chamadas concluídas (R-010) |

## `LlmCallCounter` (`src/agents/llm-counter.ts`)

| Membro | Mudança |
|---|---|
| `calls` | Conta em `handleLLMEnd`, não mais em `handleChatModelStart` |
| `promptTokens` | Ausente se alguma chamada **concluída** não reportou consumo |
| `fallbackEvents: TraceEvent[]` | Novo: eventos `fallback` recebidos por `handleCustomEvent`, em ordem |
| `modelUsed: string \| undefined` | Novo: último `model_used` recebido |

## `FallbackRecorder` (`src/agents/production-graph.ts`)

Handler por pedido, passado em `graph.invoke(…, { callbacks: [recorder] })`. Guarda os
`model_fallback` das chamadas que não passam callbacks próprios (roteador e sumarizador). Os nós
`context` e `router` leem `recorder.drain()` ao terminar e carimbam com o próprio `nodeName`.
Vive no canal `recorder` do estado do grafo, escrito na entrada.

## Erro HTTP (`src/http/errors.ts`)

`ChatErrorCode` += `"model_unavailable"`. Corpo: `{ error: { code: "model_unavailable",
message } }`, sem `details`.
