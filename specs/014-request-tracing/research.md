# Research: Rastro Persistido e Logs Estruturados

**Feature**: `014-request-tracing` | **Date**: 2026-10-07

Cada decisão segue o formato Decisão / Motivo / Alternativas. Nenhum `NEEDS CLARIFICATION`
ficou aberto no Technical Context.

## R-001 — Formato e origem do `requestId`

- **Decisão**: `crypto.randomUUID()` (UUID v4), gerado por uma função injetável
  `generateRequestId: () => string` com esse default. O valor do cabeçalho `X-Request-Id` do
  cliente nunca é lido (FR-004).
- **Motivo**: nativo do Node, 122 bits aleatórios, sem colisão prática entre reinícios e não
  previsível (FR-005). Injetável para testes determinísticos (FR-028).
- **Alternativas**: ULID/UUID v7 (ordenáveis por tempo) exigiriam dependência ou código próprio,
  e ordenar pedidos não está no escopo, já que a consulta é só por id. Contador por processo
  repete entre reinícios e é previsível.

## R-002 — Onde o id nasce: middleware antes do `express.json()`

- **Decisão**: um middleware `requestTracking` montado em `/chat` **antes** de
  `express.json()`. Ele gera o id, grava em `res.locals.obs`, define `X-Request-Id` com
  `res.setHeader` imediatamente, registra `request.start` e assina `res.on("finish")`.
- **Motivo**: JSON malformado é rejeitado dentro do `express.json()` e cai no `errorHandler` sem
  passar pelo handler do `/chat`. Só um passo anterior ao parser garante o cabeçalho em 100% das
  respostas (FR-002, SC-001). Definido antes de qualquer escrita, o cabeçalho sai em toda
  resposta, inclusive a 500 do `errorHandler`.
- **Alternativas**: gerar no handler perde o caso de JSON malformado. Um middleware global
  daria id também ao `GET /requests/:id`, fora do pedido (a spec limita o id ao `/chat`).

## R-003 — Propagação do id às camadas internas: `AsyncLocalStorage`

- **Decisão**: `src/obs/logger.ts` expõe `runWithRequestContext({ requestId, logger }, fn)` e
  `currentLogger()`, sobre um `AsyncLocalStorage`. O handler do `/chat` abre o contexto ao
  começar. O roteador, a memória, a sumarização, `resilient` e o refletor de aprendizado
  chamam `currentLogger()`.
- **Motivo**: as falhas tratadas acontecem quatro ou cinco níveis abaixo do handler (nós do
  grafo, `prepareConversationContext`, `resilient`). Passar o id por parâmetro mudaria as
  assinaturas de `Router`, `Summarizer`, `ModelSource` e dos nós, o mesmo motivo que levou a 013
  a usar `AsyncLocalStorage` para o escopo de resiliência (013, R-006). O refletor de
  aprendizado roda depois da resposta, mas como continuação de promessa criada dentro do
  contexto, então herda o id.
- **Detalhe verificado no desenho**: o contexto é aberto **no handler**, não no middleware. O
  `express.json()` lê o corpo por eventos do stream do socket, criado fora de qualquer contexto,
  e o `AsyncLocalStorage` não sobrevive a essa travessia. O middleware só guarda o id em
  `res.locals`, e o handler, já com o corpo lido, abre o contexto com esse id.
- **Alternativas**: um `logger` filho passado por parâmetro (descartado pelas assinaturas). Um
  id global do módulo quebraria com pedidos simultâneos.

## R-004 — Fora de um pedido HTTP, o comportamento de hoje

- **Decisão**: nos pontos de log compartilhados com arena, bench e MCP (`resilient`,
  `prepareConversationContext`, nós do grafo), a chamada é
  `currentLogger()?.warn(...) ?? console.error(<texto de hoje>, error)`. Sem contexto de pedido,
  sai exatamente o texto de hoje.
- **Motivo**: FR-025 e SC-008 exigem saída idêntica em arena, bench e MCP. O MCP, em particular,
  não pode escrever em stdout (006): o logger escreve em stdout, e o guarda do MCP só redireciona
  `console.*`. Sem contexto, o logger nunca é alcançado.
- **Alternativas**: logger sempre ativo, com destino escolhido por processo. Mudaria a saída da
  arena e criaria risco de corromper o MCP. Descartado.

## R-005 — Logger: linha JSON, só metadados por tipo

- **Decisão**: `createLogger({ sink, now })` devolve `{ info, warn, error }(event, fields?)`.
  Defaults: `sink = line => process.stdout.write(line + "\n")`, `now = () => new Date()`. Cada
  chamada monta `{ ts, level, event, requestId?, ...fields }` e faz um `JSON.stringify`. O
  `requestId` vem do contexto (R-003) e não é passado pelo chamador.
  - `fields` é tipado `Record<string, string | number | boolean | null>`. Objetos, arrays e
    `Error` não compilam, então nenhum payload, rastro ou exceção entra no log por acidente
    (FR-023).
  - `event` é uma união fechada de nomes (contrato [log-format.md](./contracts/log-format.md)).
  - Exceções viram só `errorName` (`error.name`, ou `"unknown"`), via
    `errorName(error: unknown)`. Nunca a mensagem, nunca a pilha.
  - O `sink` é chamado dentro de `try/catch`, e uma falha de escrita é engolida (FR-024).
- **Motivo**: `JSON.stringify` escapa quebras de linha e aspas, o que garante uma linha por
  acontecimento (US3, cenário 4). O tipo de `fields` torna a regra "só metadados" verificável
  pelo compilador, não só pela revisão.
- **Custo aceito**: o 500 deixa de registrar a pilha da exceção no log. É o preço de FR-023. O
  `errorName` e o `requestId` localizam o pedido, e o defeito se reproduz com o rastro e a
  conversa, que ficam no banco.
- **Alternativas**: `pino` resolveria o formato, mas é dependência de runtime nova para algo que
  são 60 linhas (Governança: a alternativa mais simples vence). `console.log(JSON.stringify(...))`
  não permite destino injetável sem monkey-patch.

## R-006 — Default do `createApp`: logger silencioso, store em `:memory:`

- **Decisão**: `ChatAppDeps` ganha `logger?`, `requestStore?`, `generateRequestId?` e `now?`. Os
  defaults do `createApp` são `silentLogger` (descarta linhas), `new SqliteRequestStore(new
  DatabaseSync(":memory:"))`, `randomUUID` e `() => new Date()`. O `src/index.ts` injeta
  `createLogger()` e o store sobre o banco real.
- **Motivo**: segue o padrão já usado (`conversationStore`, `memoryStore`): o `createApp` sem
  argumentos é seguro para teste, e a raiz de composição escolhe a produção. Sem isso, a suíte
  inteira despejaria linhas JSON no stdout do `node:test`.
- **Alternativas**: um store in-memory próprio. Descartado: o `SqliteRequestStore` sobre
  `:memory:` já é rápido e isolado por teste, e um segundo store pediria um teste de contrato
  compartilhado sem ganho (Princípio V já atendido).

## R-007 — Quando gravar: sucesso antes da resposta, erro no `finish`

- **Decisão**:
  - **Sucesso**: o handler grava registro e rastro **depois** de gravar o turno da conversa e
    **antes** de `res.status(200).json(...)`, dentro de `try/catch`. Uma falha vira o log
    `request.persist_failed` e a resposta segue igual (FR-011, FR-012).
  - **Erro** (400, 404, 422, 500, 503, 504): o `res.on("finish")` do middleware grava o registro
    com rastro vazio, se o handler ainda não gravou (`res.locals.obs.recorded`). O `errorCode`
    vem de `res.locals.obs.errorCode`, preenchido por quem montou o corpo de erro.
- **Motivo**: o caminho de erro tem muitas saídas, inclusive o `errorHandler`, e só o `finish`
  pega todas num ponto. O caminho de sucesso precisa da garantia "gravado antes de entregar",
  que o `finish` não dá formalmente.
- **Corrida do 504**: a execução que continua depois do prazo resolve `runPromise` mais tarde,
  mas o `.then` já sai por `res.headersSent` e nunca chega à gravação. O registro do 504 é o do
  `finish` e não muda depois (edge case da spec).
- **Alternativas**: gravar tudo no `finish` (sem garantia para FR-011). Gravar em cada `return`
  de erro do handler (repetitivo, e ainda perderia o JSON malformado).

## R-008 — Atomicidade: uma transação explícita

- **Decisão**: `SqliteRequestStore.record(record, trace)` faz `BEGIN`, um `INSERT` em
  `requests` e N `INSERT`s em `trace_events` com statements preparados uma vez no construtor,
  depois `COMMIT`, ou `ROLLBACK` e relança (o mesmo padrão de `seedDatabase`).
- **Motivo**: FR-010. Um `CHECK` violado no evento 7 desfaz o registro inteiro.
- **Alternativas**: um `INSERT` multi-linha montado dinamicamente esbarraria no limite de
  parâmetros e beiraria a proibição de SQL montado (Princípio II).

## R-009 — Payload do evento: JSON do evento inteiro

- **Decisão**: `trace_events.payload` guarda `JSON.stringify(event)`, o evento completo,
  inclusive `type` e `nodeName`. `type` e `node_name` são repetidos em colunas próprias, com
  `CHECK`, para consulta e validação pelo banco. Na leitura, `payload` volta por `JSON.parse`, o
  que garante identidade com o entregue (FR-016).
- **Motivo**: o evento é uma união de 9 formas. Uma coluna por campo seria uma tabela esparsa
  que muda a cada feature que cria tipo de evento (011, 012 e 013 criaram um cada). Repetir
  `type`/`node_name` é o mínimo para FR-013.
- **Validação na leitura (Restrições: zod na borda)**: a linha passa por um esquema zod com
  `type: traceEventTypeSchema`, `nodeName: nodeNameSchema.nullable()` e
  `payload: z.string().transform(JSON.parse)` mais
  `z.looseObject({ type: traceEventTypeSchema })`. O tipo do payload precisa bater com a
  coluna. O `TraceEvent` não vira esquema zod inteiro nesta feature: ele é tipo TS desde a 001,
  e o banco é a única fonte de leitura, escrita só pelo próprio OpsPilot.
- **Alternativas**: esquema zod completo de `TraceEvent` (reescreveria `trace/types.ts` e todos
  os produtores, fora de escopo). Guardar o rastro inteiro numa coluna de `requests` (perde a
  validação por evento e o `node` pedido).

## R-010 — Conjuntos fechados viram enums zod, com `CHECK` em sincronia

- **Decisão**: novos esquemas em `src/domain/schemas.ts`:
  - `traceEventTypeSchema`: `thought`, `action`, `observation`, `plan`, `critique`, `answer`,
    `summarize`, `route`, `fallback`.
  - `stoppedReasonSchema`: os quatro de `StoppedReason`.
  - `strategyLabelSchema`: `react`, `plan-and-execute`, `reflect:react`,
    `reflect:plan-and-execute`.
  - `chatErrorCodeSchema`: os 6 códigos de hoje mais `request_not_found`.
  - `requestStatusSchema`: `200`, `400`, `404`, `422`, `500`, `503`, `504`.

  `StoppedReason` e `ChatErrorCode` passam a ser `z.infer` desses esquemas (Princípio I: uma
  definição só). Uma asserção de tipo bidirecional amarra `TraceEvent["type"]` a
  `traceEventTypeSchema`. Um teste compara cada `CHECK` com o esquema, no padrão de R-007 da 004.
- **Motivo**: FR-013 e Princípio II (todo campo de conjunto fechado tem `CHECK`).
- **Alternativas**: `CHECK` sem esquema zod (deixaria dois lugares a manter sem verificação).

## R-011 — Corpo de erro com `requestId`: chave irmã de `error`

- **Decisão**: `{ "error": { code, message, details? }, "requestId": "…" }`. O `toErrorBody`
  continua igual, e um `withRequestId(body, id)` acrescenta a chave. Um helper local do handler,
  `sendError(res, status, code, message, details?)`, faz as três coisas juntas: acrescenta o
  id, anota `errorCode` em `res.locals.obs` e responde.
- **Motivo**: aditivo (FR-003, FR-026). Cliente que lê `error.code` não muda. Dentro de `error`
  pareceria parte do erro e conflitaria com `details`.
- **Alternativas**: id só no cabeçalho para erros (a spec pede no corpo).

## R-012 — `GET /requests/:id`

- **Decisão**: rota registrada no `createApp`, sem o middleware de rastreio. Busca por chave
  primária com statement preparado: 200 com `{ request, trace }`, ou 404
  `request_not_found`, com o mesmo `toErrorBody`. Nenhuma validação de formato do id: qualquer
  string vira busca, e o que não existe dá 404 (edge case da spec). Express já limita o
  tamanho da URL.
- **Motivo**: FR-015 a FR-018.
- **Alternativas**: validar UUID e responder 400 (a spec pede 404 sem distinguir).

## R-013 — Rota e estratégia do registro saem do evento `route`

- **Decisão**: o handler monta o registro a partir do `StrategyResult`: `route`, `strategy` e
  `routeSource` vêm do único evento `route` do rastro (012, G4), e o resto vem de `metrics` e
  `stoppedReason`. Uma função pura, `toRequestRecord(...)`, em `src/obs/request-record.ts`.
- **Motivo**: o evento `route` já é a fonte única da decisão. Nenhuma mudança no grafo.
- **Alternativas**: expor a decisão no retorno do grafo (muda a interface da 012 sem
  necessidade).

## R-014 — Durações: relógio injetado, diferença em ms

- **Decisão**: `now()` é chamado no middleware (chegada) e de novo na hora de gravar ou no
  `finish`. `durationMs = max(0, fim − início)` em milissegundos inteiros. O `receivedAt` é
  ISO-8601 UTC em TEXT (004, R-003).
- **Motivo**: determinístico em teste com relógio falso. `latencyMs` das métricas mede só a
  estratégia, e `durationMs` mede o pedido HTTP inteiro, por isso os dois coexistem.
- **Alternativas**: `performance.now()` (não injetável sem outra abstração).
