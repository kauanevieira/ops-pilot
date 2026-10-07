# Contract: formato dos logs (`src/obs/logger.ts`)

**Feature**: `014-request-tracing` | Satisfaz FR-019 a FR-025

Destino: a saída padrão do servidor HTTP (`npm run dev`), uma linha por acontecimento.

## Forma da linha

```json
{"ts":"2026-10-07T14:03:11.204Z","level":"info","event":"request.start","requestId":"3f2b…","method":"POST","path":"/chat"}
```

| Chave | Sempre | Significado |
|---|---|---|
| `ts` | sim | ISO-8601 UTC, do relógio injetado |
| `level` | sim | `info` \| `warn` \| `error` |
| `event` | sim | Nome do catálogo abaixo |
| `requestId` | dentro de um pedido | Do contexto do pedido, nunca passado pelo chamador |
| demais | conforme o evento | Só `string`, `number`, `boolean` ou `null` (garantido pelo tipo) |

## Catálogo

| `event` | `level` | Campos | Origem |
|---|---|---|---|
| `server.listening` | info | `port` | `src/index.ts` |
| `request.start` | info | `method`, `path` | middleware |
| `request.end` | info | `status`, `durationMs`, `errorCode?`, `strategy?`, `routeSource?`, `stoppedReason?`, `llmCalls?`, `promptTokens?`, `modelUsed?`, `traceEvents` | `finish` |
| `trace.event` | info | `position`, `type`, `nodeName` | handler, sucesso |
| `request.persist_failed` | error | `errorName` | handler/`finish` |
| `request.internal_error` | error | `errorName` | `errorHandler` (500) |
| `router.failed` | warn | `errorName` | nó `router` |
| `memory.recall_failed` | warn | `errorName` | nó `context` |
| `summary.failed` | warn | `errorName` | `prepareConversationContext` |
| `model.retry` | warn | `model`, `failureKind` | `resilient` |
| `model.failed` | warn | `model`, `failureKind` | `resilient`, sem nova tentativa |
| `model.fallback` | warn | `from`, `to`, `reason` | `resilient` |
| `model.unavailable` | error | `models` (ids separados por vírgula), `failureKind` | `resilient` |
| `learning.learned` | info | `userId`, `memoryId`, `created` | refletor |
| `learning.failed` | warn | `userId`, `stage`, `errorName` | refletor |

Nomes fora do catálogo não compilam (`LogEvent` é uma união fechada).

## Garantias

- **LG1**: cada linha é um JSON completo, sem quebra de linha interna (`JSON.stringify`).
- **LG2**: toda linha emitida durante um pedido do `/chat`, inclusive as do refletor depois da
  resposta, traz o `requestId` desse pedido.
- **LG3**: nenhuma linha contém mensagem, resposta, resumo, memória, pensamento, argumento de
  ferramenta, observação, crítica, plano, mensagem de erro do provedor ou pilha. Exceção vira
  só `errorName` (`error.name`).
- **LG4**: falha do `sink` é engolida e nunca afeta o pedido.
- **LG5**: fora de um pedido HTTP (arena, bench, MCP), os pontos compartilhados mantêm o
  `console.error` de hoje, com o mesmo texto. O logger não é alcançado e o MCP nunca escreve
  em stdout.
- **LG6**: o `createApp` sem `logger` usa um logger silencioso. Só o `src/index.ts` liga a saída
  real.
