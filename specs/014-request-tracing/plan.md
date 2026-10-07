# Implementation Plan: Rastro Persistido e Logs Estruturados

**Branch**: `014-request-tracing` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-request-tracing/spec.md`

## Summary

Todo pedido ao `/chat` ganha um UUID gerado pelo servidor, devolvido em `X-Request-Id` e em
`requestId` no corpo, inclusive nos erros. O registro do pedido (métricas, status, código de
erro) e o rastro (um evento por linha, com nó e payload completo) vão para duas tabelas novas no
mesmo SQLite, `requests` e `trace_events`, numa transação. `GET /requests/:id` devolve os dois.
Um logger em `src/obs/logger.ts` emite uma linha JSON por acontecimento, só com metadados, e o
`requestId` chega às camadas internas por `AsyncLocalStorage`.

Decisões da Fase 0 ([research.md](./research.md)):

1. **O id nasce num middleware antes do `express.json()`** (R-002). Só assim o JSON malformado
   também recebe `X-Request-Id`.
2. **`AsyncLocalStorage` aberto no handler, não no middleware** (R-003). O parser de corpo
   quebra a propagação. As camadas internas (roteador, memória, sumarização, `resilient`,
   refletor) leem o logger do contexto, sem mudar nenhuma assinatura.
3. **Fora de um pedido, o `console.error` de hoje** (R-004). Arena, bench e MCP não mudam, e o
   MCP nunca escreve em stdout.
4. **"Só metadados" garantido pelo tipo** (R-005). Os campos de log aceitam só
   `string | number | boolean | null`, e exceções viram `errorName`. Custo aceito: o 500 deixa
   de logar a pilha.
5. **Sucesso gravado antes da resposta, erro no `finish`** (R-007), numa transação (R-008).
6. **Payload como JSON do evento inteiro**, com `type`/`node_name` repetidos em colunas com
   `CHECK` (R-009), e cinco enums zod novos em sincronia com o DDL (R-010).

## Technical Context

**Language/Version**: TypeScript em ESM, `strict: true`. Node 22 LTS.

**Primary Dependencies**: nenhuma nova. `node:sqlite`, `node:async_hooks`
(`AsyncLocalStorage`), `node:crypto` (`randomUUID`), `express` 5 e `zod` 4.

**Storage**: SQLite local (`OPSPILOT_DB`), duas tabelas novas: `requests` e `trace_events`
([contracts/database-schema.md](./contracts/database-schema.md)).

**Testing**: `node:test`.
- `SqliteRequestStore` sobre `:memory:`: ida e volta, ordem, atomicidade, `CHECK`s e sincronia
  DDL/zod.
- Logger com `sink` que captura linhas e relógio falso.
- `/chat` e `GET /requests/:id` via `createApp` com `generateRequestId`, `now`, `logger` e
  `requestStore` injetados, e dublês de estratégia e roteador como hoje.
- Um teste de "conteúdo vazado" envia uma mensagem marcada e confere que o marcador não aparece
  em nenhuma linha de log.

**Target Platform**: servidor Node local.

**Project Type**: Single project.

**Performance Goals**: por pedido, uma transação com 1 + N inserts (N = eventos do rastro,
tipicamente < 50) e N + 2 linhas de log. Desprezível perto da chamada ao modelo.

**Constraints**:
- `npm test` offline (Princípio V). O logger é silencioso por default no `createApp`.
- Saída de arena, bench e MCP idêntica (FR-025).
- Nenhum campo existente de resposta, métrica, evento ou erro muda (FR-026).
- Falha de gravação ou de log nunca altera a resposta (FR-012, FR-024).

**Scale/Scope**:
- Novos: `src/obs/logger.ts`, `src/obs/request-store.ts`, `src/obs/request-record.ts`,
  `src/http/request-tracking.ts` e `src/http/requests.ts`, com testes.
- Alterados: `domain/schemas.ts`, `trace/types.ts`, `http/errors.ts`, `http/chat.ts`,
  `http/server.ts`, `index.ts`, `agents/production-graph.ts`, `agents/model.ts`,
  `context/conversation-context.ts` e `memory/learning-reflector.ts`.
- Documentação: README e avisos de emenda nas specs 003, 004 e 007.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | Enums novos definidos uma vez em `domain/schemas.ts`. `StoppedReason` e `ChatErrorCode` passam a ser `z.infer`. `toRequestRecord` é pura. Relógio e id nascem num ponto só, o middleware, e são injetáveis | ✅ Passa |
| **II. Persistência Local em SQLite** | Mesmo arquivo e conexão. DDL literal, idempotente, aplicado no construtor. `CHECK` em todo conjunto fechado, com teste de sincronia. Statements preparados. Transação explícita | ✅ Passa |
| **III. Contrato Antes de Código** | [chat-endpoint.md](./contracts/chat-endpoint.md), [requests-endpoint.md](./contracts/requests-endpoint.md), [database-schema.md](./contracts/database-schema.md) e [log-format.md](./contracts/log-format.md). Emendas à 003/004/007 e README na mesma mudança | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | Nenhuma ferramenta nova ou alterada | ✅ N/A |
| **V. Portões Offline e Determinísticos** | Id, relógio, logger e store injetáveis. Store sobre `:memory:` por teste. Logger silencioso por default | ✅ Passa |
| **Restrições: validação na borda** | Linhas lidas do banco passam por zod (R-009). O `:id` da URL é só parâmetro de busca ligada | ✅ Passa |
| **Restrições: credenciais** | Nada novo lido do ambiente. Mensagens de erro do provedor deixam de ir ao log dentro de pedidos (LG3) | ✅ Passa |
| **Restrições: erros** | Falha de gravação é técnica, mas falha aberta por requisito (FR-012): logada, nunca propagada. Justificado na spec | ✅ Passa |

**Governança: complexidade adicional**:
- **Diretório novo `src/obs/`**, pedido explicitamente (`src/obs/logger.ts`). O store de pedidos
  fica junto, porque é observabilidade, não estado operacional nem conversa.
- **Segundo `AsyncLocalStorage`** (o primeiro é o escopo de resiliência da 013). A alternativa
  mais simples, passar o id por parâmetro, foi descartada por mudar as assinaturas de `Router`,
  `Summarizer`, `ModelSource` e dos nós da 012 (R-003). Fundir com o escopo da 013 foi
  descartado: aquele vale também na arena e no bench, e este só existe no HTTP.
- **Nenhuma dependência nova**: `pino` foi descartado (R-005).

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. Nenhuma interface pública da 012/013 muda. As únicas
mudanças de forma são aditivas (`requestId`, cabeçalho, rota nova, valor novo em
`ChatErrorCode`).

## Project Structure

### Documentation (this feature)

```text
specs/014-request-tracing/
├── plan.md
├── spec.md
├── research.md              # Fase 0: R-001 a R-014
├── data-model.md            # RequestRecord, PersistedTraceEvent, LogLine, contexto, fluxo
├── quickstart.md
├── contracts/
│   ├── chat-endpoint.md     # emenda ao POST /chat: RT1–RT5
│   ├── requests-endpoint.md # GET /requests/:id: RQ1–RQ5
│   ├── database-schema.md   # requests, trace_events: DB1–DB7
│   └── log-format.md        # linha, catálogo de eventos: LG1–LG6
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── domain/schemas.ts               # + traceEventTypeSchema, stoppedReasonSchema, strategyLabelSchema,
│                                   #   chatErrorCodeSchema, requestStatusSchema, requestIdSchema, requestRecordSchema
├── trace/types.ts                  # StoppedReason = z.infer; asserção TraceEvent["type"] ⇔ traceEventTypeSchema
├── obs/                            # NOVO
│   ├── logger.ts                   # createLogger, silentLogger, LogEvent, errorName,
│   │                               #   runWithRequestContext, currentLogger
│   ├── logger.test.ts              # LG1, LG3 (tipo), LG4, contexto
│   ├── request-record.ts           # toRequestRecord (pura, R-013)
│   ├── request-record.test.ts
│   ├── request-store.ts            # REQUEST_SCHEMA_SQL, RequestStore, SqliteRequestStore
│   └── request-store.test.ts       # DB1–DB7
├── http/
│   ├── errors.ts                   # ChatErrorCode = z.infer; + request_not_found; withRequestId
│   ├── request-tracking.ts         # NOVO: middleware (id, cabeçalho, request.start, finish)
│   ├── requests.ts                 # NOVO: handler GET /requests/:id
│   ├── chat.ts                     # contexto, sendError, gravação no sucesso, trace.event, requestId
│   ├── server.ts                   # deps novas, montagem, errorHandler com requestId e log
│   └── server.test.ts              # RT1–RT5, RQ1–RQ5, LG2, LG3 (conteúdo vazado)
├── agents/production-graph.ts      # router.failed, memory.recall_failed via currentLogger
├── agents/model.ts                 # model.retry/failed/fallback/unavailable via currentLogger
├── context/conversation-context.ts # summary.failed via currentLogger
├── memory/learning-reflector.ts    # logLearningOutcome → learning.* via currentLogger
└── index.ts                        # createLogger(), SqliteRequestStore(db), server.listening
```

**Structure Decision**: single project, layout existente. O único diretório novo é `src/obs/`,
nomeado pelo pedido.

## Complexity Tracking

Nenhuma violação a justificar. As escolhas de complexidade estão na Governança acima.
