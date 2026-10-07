# Tasks: Rastro Persistido e Logs Estruturados

**Input**: Design documents from `/specs/014-request-tracing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos, porque a spec os exige (FR-028, FR-029). Todo teste usa banco `:memory:`,
`generateRequestId` e `now` determinísticos, logger com `sink` que captura linhas e os dublês de
estratégia e roteador já usados em `server.test.ts`. Nenhum teste chama o provedor nem lê
`.env`. Escrever cada teste antes da implementação correspondente e confirmar que falha.

**Organization**: Foundational (enums de domínio, códigos de erro, logger e contexto de pedido,
deps do `createApp`) e depois uma fase por história.
- US1 (P1): `requestId` no corpo e em `X-Request-Id`, em toda resposta do `/chat`.
- US2 (P1): `requests` + `trace_events` e `GET /requests/:id`.
- US3 (P2): linhas JSON por acontecimento, com `requestId`, nas bordas e nas camadas internas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa
- Códigos entre parênteses (RT2, RQ1, DB3, LG5…) são as garantias de `contracts/`

---

## Phase 1: Setup

- [x] T001 Criar o branch `014-request-tracing` a partir de `main` e o diretório `src/obs/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: vocabulário fechado, códigos de erro, logger e contexto de pedido. Tudo o que as três
histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Domínio (data-model.md, research R-010)

- [x] T002 [P] Em `src/domain/schemas.ts`, numa seção `// --- 014-request-tracing`, criar:
  - `traceEventTypeSchema = z.enum(["thought", "action", "observation", "plan", "critique",
    "answer", "summarize", "route", "fallback"])`
  - `stoppedReasonSchema = z.enum(["completed", "max-iterations", "max-steps",
    "max-reflections"])`
  - `strategyLabelSchema = z.enum(["react", "plan-and-execute", "reflect:react",
    "reflect:plan-and-execute"])`
  - `chatErrorCodeSchema = z.enum(["invalid_body", "unknown_strategy",
    "conversation_not_found", "timeout", "internal", "model_unavailable",
    "request_not_found"])`
  - `requestStatusSchema = z.union([z.literal(200), z.literal(400), z.literal(404),
    z.literal(422), z.literal(500), z.literal(503), z.literal(504)])`
  - `requestIdSchema = z.string().min(1)`
  - `requestRecordSchema`, com os 18 campos de data-model.md. Os opcionais são `.nullable()`,
    os inteiros `z.number().int().nonnegative()`, `receivedAt: z.date()`, `traceEvents` não
    nulo, e um `.refine` com `(status === 200) === (errorCode === null)`.

  Exportar os tipos inferidos `TraceEventType`, `StrategyLabel`, `ChatErrorCode`,
  `RequestStatus` e `RequestRecord`.
- [x] T003 Em `src/trace/types.ts` (depende de T002):
  - `StoppedReason` passa a ser `z.infer<typeof stoppedReasonSchema>`, reexportado com o
    mesmo nome.
  - Acrescentar a asserção bidirecional `type _TraceTypesInSync = [TraceEvent["type"]] extends
    [TraceEventType] ? ([TraceEventType] extends [TraceEvent["type"]] ? true : never) : never;
    const _traceTypesInSync: _TraceTypesInSync = true;`, com um comentário dizendo que um tipo
    de evento novo exige atualizar o enum e o `CHECK` de `trace_events`.
- [x] T004 Em `src/http/errors.ts` (depende de T002):
  - `ChatErrorCode` passa a ser o tipo inferido de `chatErrorCodeSchema`. Mover o comentário
    de `model_unavailable` e acrescentar o de `request_not_found` (404 do
    `GET /requests/:id`).
  - Criar `withRequestId<T extends ChatErrorResponse>(body: T, requestId: string): T & {
    requestId: string }`, que acrescenta a chave irmã de `error` (research R-011).
  - Em `src/http/errors.test.ts`, testar que `withRequestId` preserva `error` intacto e
    acrescenta só `requestId`.

### Logger e contexto de pedido (contracts/log-format.md, research R-003 a R-005)

- [x] T005 [P] Criar `src/obs/logger.test.ts`, com `sink` que acumula strings e
  `now = () => new Date("2026-10-07T12:00:00.000Z")`, cobrindo:
  - (a) cada chamada gera exatamente uma string que `JSON.parse` aceita, sem `\n` interno
    mesmo com campo `"a\nb\"c"` (LG1);
  - (b) as chaves `ts`, `level` e `event` estão presentes, e `requestId` está ausente fora de
    contexto;
  - (c) dentro de `runWithRequestContext({ requestId: "r1", logger }, fn)`, inclusive após
    `await` e em `setTimeout`, `currentLogger()` devolve o logger e a linha traz
    `requestId: "r1"`;
  - (d) dois contextos simultâneos (`Promise.all`) não se misturam;
  - (e) fora de contexto, `currentLogger()` é `undefined`;
  - (f) um `sink` que lança não propaga (LG4);
  - (g) `errorName(new TypeError("x"))` é `"TypeError"`, e `errorName("s")` e
    `errorName(undefined)` são `"unknown"`;
  - (h) `silentLogger` não chama nada;
  - (i) um teste só de tipo, com `// @ts-expect-error`, mostrando que passar um objeto ou um
    `Error` em `fields` não compila (LG3).
- [x] T006 Criar `src/obs/logger.ts` (faz T005 passar):
  - `type LogLevel = "info" | "warn" | "error"`.
  - `type LogEvent`, a união fechada do catálogo de `contracts/log-format.md`, com os 15
    nomes.
  - `type LogFields = Record<string, string | number | boolean | null>`.
  - `interface Logger { info/warn/error(event: LogEvent, fields?: LogFields): void }`.
  - `createLogger({ sink = (line) => process.stdout.write(line + "\n"), now = () => new
    Date() } = {})`, que monta `{ ts: now().toISOString(), level, event, requestId?,
    ...fields }`. O `requestId` vem só do contexto ativo, e o `sink` é chamado em
    `try/catch` vazio.
  - `silentLogger`.
  - `errorName(error: unknown): string`.
  - `runWithRequestContext<T>(ctx: { requestId: string; logger: Logger }, fn: () => T): T` e
    `currentLogger(): Logger | undefined`, sobre um `AsyncLocalStorage` de módulo.

  O comentário do módulo explica por que o contexto é aberto no handler e não no middleware
  (R-003).

### Deps do app (research R-006)

- [x] T007 Em `src/http/server.ts`, acrescentar a `ChatAppDeps` (depende de T006):
  - `logger?: Logger` (default `silentLogger`, LG6);
  - `requestStore?: RequestStore`;
  - `generateRequestId?: () => string` (default `randomUUID` de `node:crypto`);
  - `now?: () => Date` (default `() => new Date()`).

  Cada um leva comentário no padrão das deps existentes. `requestStore` só fica declarado
  aqui (o tipo vem na T015), sem uso ainda. Passar `logger`, `generateRequestId` e `now`
  adiante quando as histórias precisarem.

**Checkpoint**: `npm run typecheck` e `npm test` verdes, sem mudança observável.

---

## Phase 3: User Story 1 - Todo pedido ganha um identificador (Priority: P1) 🎯 MVP

**Goal**: toda resposta do `/chat` traz `X-Request-Id` e `requestId` no corpo, com o mesmo
valor, gerado pelo servidor.

**Independent Test**: pedidos que terminam em 200, 400 (corpo inválido e JSON malformado), 404,
422, 500, 503 e 504 trazem cabeçalho e corpo iguais. Dois pedidos têm ids diferentes. O
cabeçalho do cliente é ignorado.

### Tests for User Story 1

- [x] T008 [US1] Em `src/http/server.test.ts`, num `describe("014: requestId")`, com
  `generateRequestId` sequencial (`req-1`, `req-2`…), cobrir:
  - (a) 200: `res.headers.get("x-request-id") === body.requestId === "req-1"`;
  - (b) 400 corpo inválido, 400 JSON malformado (`body: '{"message":'`), 404 conversa
    inexistente, 422 estratégia desconhecida, 504 (estratégia lenta com `timeoutMs` curto),
    503 (estratégia que lança `ModelUnavailableError`) e 500 (estratégia que lança `Error`):
    cabeçalho presente, `body.requestId` igual e `body.error` com o mesmo `code` de antes
    (RT1, RT5);
  - (c) dois pedidos simultâneos com `Promise.all` recebem ids distintos;
  - (d) pedido com `X-Request-Id: cliente` recebe `req-N`, não `cliente` (RT2);
  - (e) sem `generateRequestId` injetado, o id casa com `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.

### Implementation for User Story 1

- [x] T009 [US1] Criar `src/http/request-tracking.ts` com `createRequestTracking({
  generateRequestId, now }): RequestHandler`:
  - gera o id e grava `res.locals.obs = { requestId, receivedAt: now(), recorded: false }`;
  - chama `res.setHeader("X-Request-Id", requestId)` antes de `next()`;
  - nunca lê `req.headers["x-request-id"]`.

  Exportar o tipo `RequestObs` (forma de `res.locals.obs` em data-model.md) e
  `getObs(res): RequestObs | undefined`. O comentário explica por que o middleware precisa vir
  antes de `express.json()` (R-002).
- [x] T010 [US1] Em `src/http/server.ts`:
  - montar `app.use("/chat", createRequestTracking({ generateRequestId, now }))` **antes** de
    `app.use(express.json())`;
  - no `errorHandler`, ler `getObs(res)?.requestId` e, quando houver, responder
    `withRequestId(toErrorBody(...), id)` nos dois ramos (JSON malformado e 500);
  - gravar `obs.errorCode` (`"invalid_body"` / `"internal"`).
- [x] T011 [US1] Em `src/http/chat.ts`:
  - ler `const obs = getObs(res)!` no início e envolver todo o corpo do handler em
    `runWithRequestContext({ requestId: obs.requestId, logger }, () => { … })` (logger vindo
    de `CreateChatHandlerOptions`, nova opção);
  - criar o helper local `sendError(status, code, message, details?)`, que faz `obs.errorCode
    = code` e `res.status(status).json(withRequestId(toErrorBody(code, message, details),
    obs.requestId))`, e trocar por ele as 6 respostas de erro (400, 422, 404, 504, 503);
  - gravar `obs.body = { conversationId, userId }` logo após o parse;
  - acrescentar `requestId: obs.requestId` ao `ChatResponse` do 200, com o tipo atualizado:
    `StrategyResult & { conversationId: string; requestId: string }`.

  Em `server.ts`, passar `logger` ao `createChatHandler`.

**Checkpoint**: T008 verde. O `/chat` já é correlacionável pelo cabeçalho.

---

## Phase 4: User Story 2 - Consultar depois o que um pedido fez (Priority: P1)

**Goal**: registro e rastro de todo pedido no SQLite, consultáveis por `GET /requests/:id`.

**Independent Test**: um 200 consultado em seguida devolve um rastro deep-equal ao entregue. Um
erro devolve status, `errorCode` e `trace: []`. Um id inexistente devolve 404. Os dados
sobrevivem a reabrir o banco.

### Tests for User Story 2

- [x] T012 [P] [US2] Criar `src/obs/request-store.test.ts`, com
  `new SqliteRequestStore(new DatabaseSync(":memory:"))` e um `RequestRecord` de exemplo,
  cobrindo:
  - (a) `record` seguido de `get` devolve registro igual e rastro deep-equal na ordem de
    `position` (DB4);
  - (b) `get("nao-existe")` é `undefined`;
  - (c) atomicidade: um rastro cujo 3º evento tem `type` fora do enum (forçado com `as`) lança,
    e depois disso `get` do id é `undefined` (DB3);
  - (d) `CHECK`: `status: 418`, `errorCode` com status 200, status 400 sem `errorCode`,
    `strategy: "x"` e `durationMs: -1` são rejeitados pelo banco;
  - (e) sincronia DDL/zod: para cada coluna com `IN (...)` em `REQUEST_SCHEMA_SQL`, extrair a
    lista por regex e comparar com `.options` do esquema correspondente (`requestStatusSchema`
    pelos literais) (DB2);
  - (f) o construtor é idempotente: dois stores sobre o mesmo `db` não falham;
  - (g) evento sem `nodeName` volta sem a chave e com `node_name` NULL;
  - (h) arquivo real: gravar com um banco em diretório temporário, fechar, reabrir com novo
    store e ler igual (RQ5);
  - (i) nenhuma coluna de `requests` contém o texto de uma mensagem marcada (DB7).
- [x] T013 [P] [US2] Criar `src/obs/request-record.test.ts` para `toRequestRecord`, cobrindo:
  - (a) sucesso: `route`, `strategy` e `routeSource` do evento `route`, métricas copiadas,
    `promptTokens` ausente → `null`, `traceEvents = trace.length`, `errorCode: null`;
  - (b) erro: campos de execução `null`, `traceEvents: 0`;
  - (c) `durationMs` é `fim − início` em ms inteiros, nunca negativo com relógio que volta.
- [x] T014 [US2] Em `src/http/server.test.ts`, num `describe("014: GET /requests/:id")`, com
  `requestStore` injetado sobre `:memory:` e `now` controlado, cobrir:
  - (a) após um 200, o `GET` com o `requestId` devolve 200, `request.status === 200` e
    `trace` deep-equal ao `trace` da resposta do `/chat`, com `nodeName` (RQ1);
  - (b) todas as 18 chaves de `request` presentes (RQ2);
  - (c) após um 422, um 400 com JSON malformado e um 504, o `GET` devolve o status e o
    `errorCode` certos e `trace: []`;
  - (d) no 504, mesmo depois de a estratégia lenta terminar, o registro continua 504 com
    `traceEvents: 0`;
  - (e) `GET /requests/nao-existe` e `GET /requests/%20` devolvem 404 `request_not_found`
    (RQ3);
  - (f) o `GET` não cria registro e não tem `X-Request-Id` (RQ4);
  - (g) com um `requestStore` cujo `record` lança, o `/chat` responde 200 com o mesmo corpo,
    o turno é gravado (`conversationStore.countMessages`) e o refletor dispara (RT4, FR-012);
  - (h) o `GET` feito imediatamente após o 200 já encontra o registro (RT3).

### Implementation for User Story 2

- [x] T015 [US2] Criar `src/obs/request-store.ts` (faz T012 passar):
  - `REQUEST_SCHEMA_SQL`, literal, exatamente o de `contracts/database-schema.md`, com o
    comentário de sincronia;
  - `interface RequestStore { record(record, trace): void; get(id): { request; trace } |
    undefined }`;
  - `class SqliteRequestStore`: construtor aplica o DDL e prepara 4 statements;
  - `record` faz `BEGIN` / insert em `requests` / insert por evento (`type`, `nodeName ??
    null`, `JSON.stringify(event)`) / `COMMIT`, ou `ROLLBACK` e relança;
  - `get` lê com `requestRecordSchema` (converte `received_at` para `Date` e colunas
    snake_case) e os eventos por um esquema de linha `{ position, type: traceEventTypeSchema,
    nodeName: nodeNameSchema.nullable(), payload: z.string().transform(JSON.parse).pipe(
    z.looseObject({ type: traceEventTypeSchema })) }`, com `refine` exigindo `payload.type ===
    type` (R-009).
- [x] T016 [P] [US2] Criar `src/obs/request-record.ts` (faz T013 passar), com a função pura
  `toRequestRecord({ requestId, receivedAt, finishedAt, status, errorCode, conversationId,
  userId, result? }): RequestRecord`. Sem `result`, os campos de execução são `null` e
  `traceEvents: 0`. Com `result`, os valores vêm do único evento `route` (R-013) e de
  `metrics`/`stoppedReason`. `durationMs = Math.max(0, Math.round(finishedAt − receivedAt))`.
- [x] T017 [US2] Em `src/http/chat.ts`, nova opção `requestStore` e `now`. No ramo de sucesso,
  depois de `conversationStore.append` e antes de `res.status(200).json`:
  - `try { requestStore.record(toRequestRecord({ …, status: 200, errorCode: null,
    conversationId: resolvedConversationId, result }), result.trace); obs.recorded = true }
    catch (error) { logger.error("request.persist_failed", { errorName: errorName(error) })
    }`;
  - o comentário cita FR-011/FR-012.
- [x] T018 [US2] Em `src/http/request-tracking.ts`, receber `requestStore` e `logger` e
  assinar `res.on("finish")`:
  - se `!obs.recorded`, gravar `toRequestRecord({ …, status: res.statusCode, errorCode:
    obs.errorCode ?? "internal", conversationId: obs.body?.conversationId ?? null, userId:
    obs.body?.userId ?? null })` com rastro `[]`, dentro de `try/catch` com
    `request.persist_failed`;
  - marcar `recorded`.

  O comentário explica a corrida do 504 (R-007).
- [x] T019 [US2] Criar `src/http/requests.ts` com `createGetRequestHandler(requestStore):
  RequestHandler`:
  - encontrado: 200 `{ request: { ...record, receivedAt: record.receivedAt.toISOString() },
    trace }`;
  - não encontrado: 404 `toErrorBody("request_not_found", "Pedido não encontrado.", {
    requestId })`.

  Sem `X-Request-Id`, sem log de pedido.
- [x] T020 [US2] Em `src/http/server.ts`:
  - default de `requestStore` = `new SqliteRequestStore(new DatabaseSync(":memory:"))`;
  - passar `requestStore`/`logger` ao `createRequestTracking` e `requestStore`/`now` ao
    `createChatHandler`;
  - registrar `app.get("/requests/:id", createGetRequestHandler(requestStore))` antes do
    `errorHandler`.
- [x] T021 [US2] Em `src/index.ts`, construir `new SqliteRequestStore(db)` sobre a mesma
  conexão (comentário no padrão dos outros stores) e passar ao `createApp`.

**Checkpoint**: T012–T014 verdes. Com US1 e US2, a feature é integrável (as duas P1).

---

## Phase 5: User Story 3 - Logs que uma máquina consegue ler (Priority: P2)

**Goal**: uma linha JSON por acontecimento, com `requestId` dentro do pedido, só metadados. Fora
do HTTP, nada muda.

**Independent Test**: com um `sink` que captura linhas, todo pedido produz `request.start`,
`trace.event` × N e `request.end`. As falhas tratadas viram linhas com `requestId`. Nenhuma
linha contém a mensagem ou a resposta.

### Tests for User Story 3

- [x] T022 [US3] Em `src/http/server.test.ts`, num `describe("014: logs")`, com `logger =
  createLogger({ sink, now })`, cobrir:
  - (a) um 200 gera, nessa ordem, `request.start` (`method`, `path`), N `trace.event` (com
    `position` 0..N−1, `type`, `nodeName` iguais ao rastro) e `request.end` (`status: 200`,
    `durationMs`, `strategy`, `routeSource`, `stoppedReason`, `llmCalls`, `traceEvents: N`);
  - (b) um 422 gera `request.start` e `request.end` com `status: 422` e `errorCode:
    "unknown_strategy"`, e nenhum `trace.event`;
  - (c) todas as linhas de um pedido trazem o seu `requestId`, inclusive `learning.learned`
    emitida depois da resposta, aguardando a sonda do refletor (LG2);
  - (d) roteador falso que lança gera `router.failed` com `errorName` e o `requestId`;
  - (e) memória falsa cujo `recall` lança gera `memory.recall_failed`;
  - (f) sumarizador falso que lança gera `summary.failed`;
  - (g) uma estratégia que lança `Error("SEGREDO")` gera `request.internal_error` com
    `errorName: "Error"`, e `SEGREDO` não aparece em nenhuma linha;
  - (h) **conteúdo vazado**: mensagem `"MARCADOR-7f3a\nlinha2"` e resposta falsa
    `"RESPOSTA-9b1c"` (com `userId` e roteador). Nenhuma linha capturada contém `MARCADOR-7f3a`
    nem `RESPOSTA-9b1c`, e toda linha passa em `JSON.parse` (LG1, LG3, SC-006);
  - (i) o `createApp` sem `logger` não escreve em `process.stdout` (espionar
    `process.stdout.write` com `mock.method` durante um pedido) (LG6).
- [x] T023 [P] [US3] Em `src/agents/model.test.ts`, cobrir:
  - (a) dentro de `runWithRequestContext` com logger capturador, um principal que falha com
    `rate_limit` e um reserva que responde geram `model.retry` (`model`, `failureKind`) e
    `model.fallback` (`from`, `to`, `reason`) com `requestId`, sem a mensagem do erro;
  - (b) sem os dois modelos, `model.unavailable`;
  - (c) **fora** de contexto, o mesmo cenário não chama o logger e chama `console.error`
    (espionado com `mock.method`) com o texto de hoje (LG5).
- [x] T024 [P] [US3] Em `src/memory/learning-reflector.test.ts`, testar que `logLearningOutcome`:
  - dentro de contexto, emite `learning.learned` (`userId`, `memoryId`, `created`) e
    `learning.failed` (`userId`, `stage`, `errorName`);
  - fora de contexto, mantém o `console.*` de hoje;
  - para `skipped`, não emite nada.

### Implementation for User Story 3

- [x] T025 [US3] Em `src/http/request-tracking.ts`:
  - `logger.info("request.start", { method: req.method, path: req.path })`, dentro de
    `runWithRequestContext` só para essa chamada, para que leve o `requestId`;
  - no `finish`, `logger.info("request.end", { status, durationMs, traceEvents, ...summary })`,
    também dentro do contexto, com `errorCode` quando houver e os campos de execução de
    `obs.summary` no sucesso.
- [x] T026 [US3] Em `src/http/chat.ts`, no ramo de sucesso, depois de gravar e antes de
  responder:
  - `result.trace.forEach((e, i) => logger.info("trace.event", { position: i, type: e.type,
    nodeName: e.nodeName ?? null }))`;
  - preencher `obs.summary` com `strategy`, `routeSource`, `stoppedReason`, `llmCalls`,
    `promptTokens` e `modelUsed` (só os presentes).
- [x] T027 [US3] Em `src/http/server.ts`, no ramo 500 do `errorHandler`, trocar
  `console.error(...)` por `logger.error("request.internal_error", { errorName:
  errorName(error) })`, dentro do contexto do id de `res.locals.obs`. O comentário registra o
  custo aceito (sem pilha, R-005).
- [x] T028 [P] [US3] Em `src/agents/production-graph.ts`, trocar os dois `console.error` por
  `currentLogger()?.warn("memory.recall_failed" | "router.failed", { errorName:
  errorName(error) }) ?? console.error(<texto de hoje>, error)`, no padrão de R-004.
  Explicitamente: `const log = currentLogger(); if (log) log.warn(…); else console.error(…);`.
- [x] T029 [P] [US3] Em `src/context/conversation-context.ts`, o mesmo padrão para
  `summary.failed`.
- [x] T030 [P] [US3] Em `src/agents/model.ts`, o mesmo padrão nos 5 `console.error` de
  `resilient`:
  - `model.retry` e `model.failed`, com `{ model: primaryId ?? "?", failureKind: kind }`;
  - `model.fallback`, com `{ from, to, reason }`;
  - `model.unavailable`, com `{ models: ids.join(","), failureKind }`.

  Os textos atuais ficam idênticos no ramo sem contexto (faz T023 passar).
- [x] T031 [P] [US3] Em `src/memory/learning-reflector.ts`, `logLearningOutcome` usa
  `currentLogger()` quando houver contexto (`learning.learned` / `learning.failed` com
  `errorName`), e o `console.*` atual sem contexto (faz T024 passar).
- [x] T032 [US3] Em `src/index.ts`, criar `const logger = createLogger()` no início do `main`,
  passar ao `createApp` e trocar o `console.log` do `listen` por `logger.info(
  "server.listening", { port })`. O `console.error` de `PORT inválida` fica como está, porque
  acontece antes de o servidor existir.

**Checkpoint**: T022–T024 verdes. Arena, bench e MCP sem mudança.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T033 [P] README: seção "Rastreando um pedido", com:
  - o `X-Request-Id`/`requestId`;
  - `GET /requests/:id` e um exemplo de `curl` + `jq`;
  - as tabelas `requests`/`trace_events`;
  - o formato das linhas de log e o catálogo resumido, com links para `contracts/` da 014;
  - a observação de que o log não guarda conteúdo e o 500 não loga a pilha.
- [x] T034 [P] Avisos de emenda (bloco "Emendado pela 014", no padrão das emendas 007–013):
  - em `specs/003-chat-http-api/contracts/chat-endpoint.md` (`requestId`, `X-Request-Id`,
    `request_not_found`);
  - em `specs/004-sqlite-persistence/contracts/database-schema.md` e
    `specs/007-persistent-conversation/contracts/database-schema.md` (tabelas novas);
  - na constituição, nada muda.
- [x] T035 [P] Atualizar o guia do agente (`.github/copilot-instructions.md`) com
  `src/obs/`, o padrão `currentLogger()` com o `console.error` como alternativa fora de
  pedido, e a regra "só metadados no log".
- [x] T036 Rodar `npm run typecheck` e `npm test`. Confirmar que nenhum teste antigo mudou de
  expectativa além dos tipos de `StoppedReason`/`ChatErrorCode`.
- [ ] T037 Rodar `quickstart.md` (etapas 2 a 5). Precisa de credenciais do provedor, então só
  com autorização da pessoa.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: T001.
- **Foundational (2)**:
  - T002 e T005 em paralelo;
  - T003 e T004 dependem de T002;
  - T006 faz T005 passar;
  - T007 depende de T006.

  Bloqueia tudo.
- **US1 (3)**: depende da Foundational. T008 → T009 → T010 → T011.
- **US2 (4)**: depende da US1:
  - o `res.locals.obs` e o `finish` do middleware (T009) e o `sendError` (T011) são a base
    das gravações;
  - T012 e T013 em paralelo com T008–T011;
  - T015 → T017/T018/T019 → T020 → T021;
  - T016 em paralelo com T015.
- **US3 (5)**: depende da US1, para o contexto aberto no handler. T028–T031 só dependem da
  Foundational (`currentLogger`) e podem começar junto com a US1. T025/T026 tocam arquivos da
  US2 (T017, T018), então vêm depois dela.
- **Polish (6)**: depois das histórias. T037 só com autorização.

### Parallel Opportunities

- **Foundational**: T002 e T005.
- **US2**: T012, T013 (testes) e T016.
- **US3**:
  - T023 e T024 (testes);
  - T028, T029, T030 e T031 (quatro arquivos diferentes), também em paralelo com a US1/US2.
- **Polish**: T033, T034 e T035.

---

## Parallel Example: User Story 3

```bash
Task: "T028 production-graph.ts: router.failed / memory.recall_failed via currentLogger"
Task: "T029 conversation-context.ts: summary.failed via currentLogger"
Task: "T030 model.ts: model.retry/failed/fallback/unavailable via currentLogger"
Task: "T031 learning-reflector.ts: learning.* via currentLogger"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Setup + Foundational (T001–T007): enums, logger e contexto, sem mudança observável.
2. US1 (T008–T011): `requestId` e `X-Request-Id` em toda resposta.
3. **Parar e validar**: `npm test` e a etapa 2 do quickstart.

### Incremental Delivery

1. Foundational → logger e contexto testados sozinhos.
2. US1 → o pedido é identificável (MVP).
3. US2 → o pedido é consultável. Com as duas P1, a feature é integrável.
4. US3 → logs JSON correlacionáveis.
5. Polish → README, emendas e guia do agente.

---

## Notes

- Dublês (`sink` capturador, relógio fixo, `generateRequestId` sequencial, store que lança)
  vivem só nos `*.test.ts`. Nada falso mora em `src/`.
- A regra "só metadados" é garantida em três camadas: o tipo de `LogFields` (T006), o uso
  exclusivo de `errorName` para exceções (T027–T031) e o teste de conteúdo vazado (T022h).
- O rastro persistido guarda conteúdo completo de propósito (FR-008). A restrição de conteúdo
  vale só para o log.
- Commit ao fim de cada fase, com a referência às tarefas.
- **Desvios da implementação em relação ao plano**:
  - O middleware ficou em `app.post("/chat", tracking, express.json(), handler)` em vez de
    `app.use("/chat", ...)`. Assim só `POST /chat` ganha identificador, e um `GET /chat` (404 do
    Express) não vira registro falso de erro `internal`.
  - Criado o helper `logInRequest(emit, fallback)` em `src/obs/logger.ts`, que concentra o
    padrão "linha JSON dentro de um pedido, `console.error` de sempre fora dele" (R-004) em vez
    de repetir o `if` nos oito pontos de log.
  - `persistRequest` (em `request-tracking.ts`) é a única função que grava o registro, chamada
    pelo handler (sucesso, antes da resposta) e pelo `finish` (erros). `obs.recorded` significa
    "gravação tentada", mesmo que tenha falhado, para o `finish` nunca gravar duas vezes.
  - A gravação dos erros acontece no `finish`, então um `GET` imediatamente depois de um erro
    pode ainda não encontrar o registro. A garantia "gravado antes da resposta" (FR-011) vale
    só para o 200, como a spec pede. Os testes de erro aguardam 20 ms.
  - `model.retry` não tem teste dedicado: exigiria a espera real da biblioteca (~7 s). As
    linhas `model.failed`, `model.fallback` e `model.unavailable` têm.
- **T037 (quickstart com provedor real) segue aberta**: precisa de credenciais. Verificado à
  mão, sem modelo: cabeçalho e `requestId` em 422 e 400 com JSON malformado, `X-Request-Id` do
  cliente ignorado, registro consultável depois de reiniciar o servidor, e todas as linhas do
  log como JSON válido.
