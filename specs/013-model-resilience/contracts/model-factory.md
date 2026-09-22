# Contract: Fábrica de modelos resiliente

**Feature**: `013-model-resilience` | Satisfaz FR-001 a FR-011a, FR-016, FR-023, FR-024, FR-026

Módulo: `src/agents/model.ts`. Definições em [data-model.md](../data-model.md#fábrica-srcagentsmodelts).

## Configuração

| Variável | Obrigatória | Efeito |
|---|---|---|
| `OPENROUTER_API_KEY` | sim (na chamada) | Credencial dos dois modelos |
| `OPENROUTER_MODEL` | sim (na chamada) | Modelo principal |
| `OPENROUTER_MODEL_FALLBACK` | não | Modelo reserva. Ausente, vazio, só espaços ou igual ao principal: sem reserva |

## Garantias

- **MF1**: construir `envModelSource()`, `resilient(...)` e qualquer fábrica que os use não lê o
  ambiente. A leitura acontece na primeira invocação (FR-003).
- **MF2**: os dois `ChatOpenAI` têm `maxRetries: 0`. Nenhuma tentativa acontece fora do
  `withRetry` (FR-007).
- **MF3**: o principal é tentado no máximo `MAX_PRIMARY_ATTEMPTS` (3) vezes, e só em
  `rate_limit`, `provider_error` e `network`. `timeout` e `non_transient` encerram as
  tentativas na primeira (FR-004, FR-005).
- **MF4**: o reserva é tentado no máximo uma vez por chamada, com o mesmo `build` e a mesma
  config (FR-008).
- **MF5**: com o `signal` abortado, nenhuma tentativa nova começa, a espera entre tentativas é
  interrompida e o reserva não é chamado. O erro que sobe é o de cancelamento, nunca
  `ModelUnavailableError` (FR-006, FR-009).
- **MF6**: falha do reserva, ou falha do principal sem reserva, sobe como `ModelUnavailableError`
  com `tried` na ordem de uso (FR-011).
- **MF7**: dentro de `runWithResilienceScope`, depois que o reserva foi usado, toda chamada
  seguinte no mesmo escopo vai direto ao reserva: zero tentativas no principal, nenhum
  `model_fallback` novo. Fora de um escopo, cada chamada decide sozinha (FR-011a).
- **MF8**: cada chamada atendida despacha `opspilot:model_used { model }`. Cada troca despacha
  `opspilot:model_fallback { from, to, reason }` antes de chamar o reserva. Nenhum dos dois traz
  mensagem de erro do provedor (FR-012).
- **MF9**: toda nova tentativa, troca e falha definitiva vai para o log (`console.error`), com o
  erro do provedor (FR-016).
- **MF10**: `classifyModelError` é pura e segue a tabela da R-004.

## Pontos de chamada

| Arquivo | Antes | Depois |
|---|---|---|
| `agents/react.ts` | `llm: createModel()` | `llm: () => resilient(m => m.bindTools(tools), source)` |
| `agents/plan-and-execute.ts` (executor) | idem | idem |
| `agents/plan-and-execute.ts` (planejador, revisor) | `createModel().withStructuredOutput(s)` | `resilient(m => m.withStructuredOutput(s), source)` |
| `agents/critic.ts`, `agents/router.ts`, `memory/distiller.ts` | idem | idem |
| `context/summarizer.ts` | `createModel().invoke(...)` | `resilient(m => m, source).invoke(...)` |

Cada fábrica pública ganha `source: ModelSource = envModelSource()` como último parâmetro
opcional. Nenhuma assinatura existente perde parâmetro.

## Contador (`agents/llm-counter.ts`)

- **LC1**: `calls` conta `handleLLMEnd`. Uma tentativa que falhou não conta (FR-024).
- **LC2**: `promptTokens` é ausente se alguma chamada concluída não reportou consumo.
- **LC3**: `fallbackEvents` guarda, em ordem, um `{ type: "fallback", from, to, reason }` por
  `opspilot:model_fallback` recebido. `modelUsed` é o último `opspilot:model_used`.

## Dublês de teste

`fakeSource({ primary, backup })` com modelos falsos (subclasses de `FakeListChatModel` que
falham com `status`/`name` controlados em `_generate`) e ids fixos (`"primary-model"`,
`"backup-model"`).
