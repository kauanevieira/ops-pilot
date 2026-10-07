# Data Model: Rastro Persistido e Logs Estruturados

**Feature**: `014-request-tracing`

## Esquemas novos em `src/domain/schemas.ts` (R-010)

| Esquema | Valores | Usado em |
|---|---|---|
| `traceEventTypeSchema` | `thought`, `action`, `observation`, `plan`, `critique`, `answer`, `summarize`, `route`, `fallback` | `trace_events.type`, validação do payload |
| `stoppedReasonSchema` | `completed`, `max-iterations`, `max-steps`, `max-reflections` | `requests.stopped_reason`. `StoppedReason` passa a ser `z.infer` dele |
| `strategyLabelSchema` | `react`, `plan-and-execute`, `reflect:react`, `reflect:plan-and-execute` | `requests.strategy` |
| `chatErrorCodeSchema` | `invalid_body`, `unknown_strategy`, `conversation_not_found`, `timeout`, `internal`, `model_unavailable`, `request_not_found` | `requests.error_code`. `ChatErrorCode` passa a ser `z.infer` dele |
| `requestStatusSchema` | `200`, `400`, `404`, `422`, `500`, `503`, `504` | `requests.status` |
| `requestIdSchema` | `z.string().min(1)` | chave do registro |

Esquemas já existentes, reaproveitados: `routeSchema`, `routeSourceSchema`, `nodeNameSchema`,
`modelIdSchema`.

## Entidade: RequestRecord

Uma linha por pedido ao `/chat`. Esquema zod `requestRecordSchema`, de onde o tipo é inferido.

| Campo | Tipo | Regra |
|---|---|---|
| `requestId` | string | PK. Gerado pelo servidor (R-001) |
| `receivedAt` | Date | Instante da chegada, no middleware (R-014) |
| `durationMs` | int ≥ 0 | Da chegada à gravação (sucesso) ou ao `finish` (erro) |
| `status` | `requestStatusSchema` | Status HTTP final |
| `errorCode` | `chatErrorCodeSchema` \| null | null **se e só se** `status = 200` |
| `conversationId` | string \| null | A do pedido, ou a criada no sucesso. Sem FK: um 404 guarda o id que não existe |
| `userId` | string \| null | Do corpo, quando válido |
| `route` | `routeSchema` \| null | Do evento `route`. Só no 200 |
| `strategy` | `strategyLabelSchema` \| null | Do evento `route`. Só no 200 |
| `routeSource` | `routeSourceSchema` \| null | Do evento `route`. Só no 200 |
| `stoppedReason` | `stoppedReasonSchema` \| null | Só no 200 |
| `llmCalls` | int ≥ 0 \| null | `metrics.llmCalls` |
| `promptTokens` | int ≥ 0 \| null | `metrics.promptTokens` (ausente → null) |
| `modelUsed` | string \| null | `metrics.modelUsed` |
| `historyMessages` | int ≥ 0 \| null | `metrics.historyMessages` |
| `summaryCoveredMessages` | int ≥ 0 \| null | `metrics.summaryCoveredMessages` |
| `recalledMemories` | int ≥ 0 \| null | `metrics.recalledMemories` |
| `traceEvents` | int ≥ 0 | Quantos eventos foram gravados (0 em erro) |

Não guarda o texto da mensagem nem da resposta (FR-007).

**Ausente vs. null**: no registro e na resposta do `GET`, campo desconhecido é `null`, com a
chave sempre presente. É uma linha de tabela de forma fixa, diferente de `metrics` no `/chat`,
onde a convenção (010) é omitir a chave.

### Estados

Não há transição. O registro é escrito uma única vez, no sucesso (pelo handler) ou no erro (pelo
`finish`), e nunca é atualizado (R-007). Um 504 continua 504 mesmo que a execução termine depois.

## Entidade: PersistedTraceEvent

| Campo | Tipo | Regra |
|---|---|---|
| `requestId` | string | FK → `requests.id` |
| `position` | int ≥ 0 | Índice no `trace` entregue. PK composta `(requestId, position)` |
| `type` | `traceEventTypeSchema` | Igual a `payload.type` |
| `nodeName` | `nodeNameSchema` \| null | Igual a `payload.nodeName` ou null quando ausente |
| `payload` | `TraceEvent` | O evento inteiro, como entregue (R-009) |

A leitura devolve `payload`, ordenado por `position`.

## Entidade: LogLine (não persistida)

`{ ts: ISO-8601, level: "info" | "warn" | "error", event: LogEvent, requestId?: string, ...fields }`,
com `fields: Record<string, string | number | boolean | null>`. Catálogo de `event` em
[contracts/log-format.md](./contracts/log-format.md).

## Contexto de pedido (não persistido)

`RequestContext = { requestId: string; logger: Logger }`, guardado num `AsyncLocalStorage` em
`src/obs/logger.ts` (R-003). Sem contexto, `currentLogger()` devolve `undefined`.

Estado por resposta em `res.locals.obs`:
`{ requestId, receivedAt: Date, recorded: boolean, errorCode?: ChatErrorCode, body?: { conversationId?, userId? }, summary?: RequestEndSummary }`.
O middleware cria, o handler completa, e o `finish` lê.

## Interface `RequestStore` (`src/obs/request-store.ts`)

```ts
interface RequestStore {
  /** Atômico (FR-010). Lança em violação de CHECK ou falha de escrita. */
  record(record: RequestRecord, trace: readonly TraceEvent[]): void;
  /** undefined quando não existe. Linhas validadas por zod na leitura. */
  get(requestId: string): { request: RequestRecord; trace: TraceEvent[] } | undefined;
}
```

Implementação única: `SqliteRequestStore(db)`, que aplica `REQUEST_SCHEMA_SQL` no construtor,
como os outros stores ([contracts/database-schema.md](./contracts/database-schema.md)).

## Fluxo de um pedido

```text
middleware requestTracking   id, X-Request-Id, receivedAt, log request.start, on(finish)
  → express.json()            (JSON malformado → errorHandler → 400 + requestId → finish grava)
  → handler /chat             runWithRequestContext(id):
      400/422/404             sendError → anota errorCode → finish grava (rastro vazio)
      graph.run …             falhas tratadas → currentLogger().warn(...) com requestId
      504/503/500             sendError / errorHandler → finish grava
      200                     append turno → toRequestRecord → store.record (try/catch)
                              → log trace.event × N → res.json({ ..., requestId })
  → finish                    grava se !recorded; log request.end
  → refletor (depois)         herda o contexto: learning.* com requestId
```
