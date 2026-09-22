# Tasks: Resiliência de Modelo

**Input**: Design documents from `/specs/013-model-resilience/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos. A spec os exige (FR-026, FR-027). Todo teste usa modelos falsos
(`fakeSource`): nenhum chama o provedor nem lê `.env`. Escrever cada teste antes da
implementação correspondente e confirmar que falha. Só T005 e T006 esperam a espera real do
`withRetry` (~7 s no total, research R-013).

**Organization**: Foundational (domínio, tipos do rastro, fábrica resiliente, contador) e depois
uma fase por história.
- US1 (P1): os 7 pontos de chamada passam a usar a fábrica, e o pedido sobrevive à falha.
- US2 (P1): evento `fallback`, `modelUsed` e a troca válida para o resto do pedido no `/chat`.
- US3 (P2): 503 `model_unavailable`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa
- Códigos entre parênteses (MF3, LC1, MR4…) são as garantias de `contracts/model-factory.md` e
  `contracts/chat-endpoint.md`

---

## Phase 1: Setup

- [ ] T001 [P] Em `.env.example`, logo abaixo de `OPENROUTER_MODEL=`, acrescentar
      `# Modelo reserva, usado quando o principal falha (opcional).` e
      `OPENROUTER_MODEL_FALLBACK=`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: a fábrica resiliente e o contador que a observa. Tudo o que as três histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Domínio e rastro (data-model.md)

- [ ] T002 [P] Em `src/domain/schemas.ts`, numa seção `// --- 013-model-resilience`:
      `failureKindSchema = z.enum(["timeout", "rate_limit", "provider_error", "network",
      "non_transient"])` com comentário (FR-012); `export const RETRYABLE_FAILURES:
      ReadonlySet<FailureKind> = new Set(["rate_limit", "provider_error", "network"])`
      (comentário: `timeout` fica de fora de propósito, FR-005, research R-004);
      `modelIdSchema = z.string().trim().min(1)`; tipo inferido `FailureKind`
- [ ] T003 Em `src/trace/types.ts`: membro `{ type: "fallback"; from: string; to: string;
      reason: FailureKind }` na união, com comentário (troca de modelo, no máximo um por pedido
      do `/chat`, sem mensagem do provedor, e sem relação com o `route` de `source: "fallback"`
      da 012); `RunMetrics.modelUsed?: string` com comentário (modelo da última chamada atendida
      da estratégia; produtores: react, plan-and-execute, withReflection). Em
      `src/trace/format.ts`, `case "fallback": return \`[fallback]    ${event.from} ->
      ${event.to} (${event.reason})\`` (FR-017); em `src/trace/format.test.ts`, um teste com a
      string exata

### Fábrica resiliente (contracts/model-factory.md, research R-001 a R-006, R-011)

- [ ] T004 [P] Criar `src/agents/model.test.ts` com os dublês `failingModel(error)` (subclasse de
      `FakeListChatModel` que conta `attempts` e lança em `_generate`), `okModel(text)` e
      `fakeSource({ primary, backup })` (ids `"primary-model"`/`"backup-model"`, `backup: null`
      para sem reserva), e os erros `transientError()` (`status: 429`), `serverError()`
      (`status: 503`), `notFoundError()` (`status: 404`), `timeoutError()` (`name:
      "TimeoutError"`). Casos rápidos (sem espera):
      MF10 (`classifyModelError` em tabela: cada linha da R-004, e `"aborted"` com `name:
      "AbortError"` ou `signal.aborted`);
      MF1 (`envModelSource()` e `resilient(m => m)` constroem sem `OPENROUTER_*`; apagar e
      restaurar no `finally`);
      `envModelSource().backup()` é `null` com `OPENROUTER_MODEL_FALLBACK` ausente, `""`, `"   "`
      e igual a `OPENROUTER_MODEL` (FR-002), e devolve o id aparado quando válido;
      MF2 (`createChatModel("x").caller.maxRetries === 0`);
      MF3 parcial (erro 404 no principal → `attempts === 1`, resposta do reserva; `timeoutError`
      → `attempts === 1`, resposta do reserva);
      MF4 (reserva chamado uma vez);
      MF5 (signal já abortado → rejeita com `AbortError`, principal com 0 tentativas e reserva
      não chamado);
      MF6 (sem reserva e 404 → `ModelUnavailableError` com `tried: ["primary-model"]`; os dois
      falhando com 404 → `tried: ["primary-model", "backup-model"]`);
      MF7 (dentro de `runWithResilienceScope`, duas chamadas seguidas com o principal falhando
      em 404: a segunda tem 0 tentativas no principal e não despacha `model_fallback`; fora do
      escopo, a segunda volta a tentar o principal);
      MF8 (um `BaseCallbackHandler` de teste com `handleCustomEvent`, passado em `callbacks`,
      recebe `opspilot:model_used { model: "primary-model" }` numa chamada boa, e
      `opspilot:model_fallback { from, to, reason: "non_transient" }` seguido de `model_used {
      model: "backup-model" }` numa troca; nenhum payload tem a mensagem do erro)
- [ ] T005 Em `src/agents/model.test.ts`, os dois testes com espera real (comentário citando
      R-013): MF3 (principal sempre com `transientError` → `attempts === 3` e resposta do
      reserva); e passageiro seguido de sucesso (falha uma vez, depois responde) → resposta do
      principal, sem `model_fallback`
- [ ] T006 Em `src/agents/model.test.ts`: MF5 com cancelamento durante a espera (principal com
      `transientError`, abortar em 50 ms) → rejeita com `AbortError` em menos de 1 s, `attempts
      === 1`, reserva não chamado
- [ ] T007 Reescrever `src/agents/model.ts` conforme `contracts/model-factory.md` e o fluxo do
      data-model: `MAX_PRIMARY_ATTEMPTS = 3`; `SourcedModel`, `ModelSource`; `createChatModel(id)`
      (o `ChatOpenAI` de hoje, com `modelName: id`, `maxRetries: 0` e comentário da R-003,
      mantendo os comentários de `timeout` e `streaming`); `envModelSource()` (lê
      `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`/`OPENROUTER_MODEL_FALLBACK` só dentro de
      `primary()`/`backup()`, com `modelIdSchema`); `classifyModelError`; `ModelUnavailableError`
      (`tried`, `reason`); `runWithResilienceScope` sobre um `AsyncLocalStorage<{ primaryDown:
      boolean }>`; `MODEL_USED_EVENT`, `MODEL_FALLBACK_EVENT`; e `resilient(build, source =
      envModelSource())`, que devolve `RunnableLambda(primaryStep).withRetry({ stopAfterAttempt:
      MAX_PRIMARY_ATTEMPTS, onFailedAttempt })` com `withFallbacks([RunnableLambda(backupStep)])`
      quando há reserva, e sempre embrulhado num `RunnableLambda` final que converte falha de
      modelo que não seja cancelamento em `ModelUnavailableError` (MF6). `onFailedAttempt`
      relança quando a classe não está em `RETRYABLE_FAILURES`, e loga cada nova tentativa
      (MF9). `primaryStep` pula na hora com o escopo em `primaryDown` (MF7). `backupStep` só marca
      o escopo e despacha `model_fallback` quando o principal não foi pulado. Remover
      `createModel()`. T004 a T006 verdes
- [ ] T008 Em `src/agents/llm-counter.ts` (LC1–LC3): contar `calls` em `handleLLMEnd`;
      `handleCustomEvent(name, data)` guarda `{ type: "fallback", ...data }` em `fallbackEvents`
      para `MODEL_FALLBACK_EVENT` e atualiza `modelUsed` para `MODEL_USED_EVENT`; atualizar o
      comentário da classe (emenda à 010, research R-010). Em `src/agents/llm-counter.test.ts`:
      K1 passa a conferir que `handleChatModelStart` sozinho não conta e `handleLLMEnd` conta; K3
      ("started call never ends") passa a esperar `calls === 0` e `promptTokens === 0`; novos
      casos para `fallbackEvents` em ordem e `modelUsed` como o último recebido

**Checkpoint**: `resilient` funciona isolado. Nenhum ponto de chamada usa ainda, e `npm run
typecheck` acusa os 7 usos de `createModel` removido, que são resolvidos em US1.

---

## Phase 3: User Story 1 - O pedido sobrevive a uma falha passageira ou à queda do principal (Priority: P1) 🎯 MVP

**Goal**: toda chamada ao modelo passa pela fábrica resiliente.

**Independent Test**: com `fakeSource` de principal falhando (404) e reserva respondendo, o
ReAct, o Plan-and-Execute, o crítico, o roteador, o sumarizador e o destilador terminam com a
resposta do reserva.

### Tests for User Story 1

- [ ] T009 [P] [US1] Em `src/agents/react.test.ts` (novo): `createReactStrategy(store, { source
      })` com principal `failingModel(notFoundError())` e reserva `okModel("resposta do
      reserva")` → `answer === "resposta do reserva"`, `stoppedReason === "completed"`,
      `metrics.llmCalls === 1`
- [ ] T010 [P] [US1] Em `src/agents/plan-and-execute.test.ts` (novo): com
      `disableReplanner: true`, principal 404 e reserva que responde o planejador (saída
      estruturada `{ steps: ["passo"] }`) e o passo → a estratégia termina `completed`. O reserva
      falso de saída estruturada é um `FakeListChatModel` cujo `withStructuredOutput` devolve um
      `RunnableLambda` fixo (comentário explicando o dublê)
- [ ] T011 [P] [US1] Nos testes existentes de `src/agents/critic.test.ts`,
      `src/agents/router.test.ts`, `src/context/summarizer.test.ts` e
      `src/memory/distiller.test.ts`, um caso por arquivo: a fábrica real (`createLlmCritic`,
      `createModelRouter`, `createModelSummarizer`, `createModelDistiller`) com `fakeSource`
      (principal 404, reserva que responde) devolve a resposta do reserva. Manter os testes MF1
      já existentes (construção sem env) como estão

### Implementation for User Story 1

- [ ] T012 [US1] `src/agents/react.ts`: `createReactStrategy(store, options: { source?:
      ModelSource } = {})`; `llm: () => resilient((m) => m.bindTools(tools), source)`, com
      comentário da R-001 (por que função: `createReactAgent` não religa ferramentas numa
      função). T009 verde
- [ ] T013 [US1] `src/agents/plan-and-execute.ts`: `PlanAndExecuteOptions.source?: ModelSource`;
      planejador e revisor com `resilient((m) => m.withStructuredOutput<…>(schema), source)`;
      executor com `llm: () => resilient((m) => m.bindTools(tools), source)`. T010 verde
- [ ] T014 [P] [US1] `src/agents/critic.ts`: `createLlmCritic(source = envModelSource())`.
      `src/agents/router.ts`: `createModelRouter(source = envModelSource())`.
      `src/context/summarizer.ts`: `createModelSummarizer(source = envModelSource())`, com
      `resilient((m) => m, source)`. `src/memory/distiller.ts`:
      `createModelDistiller(source = envModelSource())`. Atualizar em cada um o comentário que
      cita `createModel()`. T011 verde
- [ ] T015 [US1] `npm run typecheck` e `npm test` verdes. Conferir com `grep -rn "createModel()"
      src` que não sobrou nenhum uso

**Checkpoint**: US1 entregue. Com o principal fora e o reserva de pé, os pedidos respondem.

---

## Phase 4: User Story 2 - Saber qual modelo respondeu e quando houve troca (Priority: P1)

**Goal**: `metrics.modelUsed`, evento `fallback` com `nodeName` e troca válida para o resto do
pedido no `/chat`.

**Independent Test**: com `fakeSource`, o `/chat` traz exatamente um `fallback` no nó da troca,
`modelUsed` com o reserva, e o principal tem 0 tentativas depois da troca no mesmo pedido.

### Tests for User Story 2

- [ ] T016 [P] [US2] Em `src/agents/react.test.ts`: sem troca → `metrics.modelUsed ===
      "primary-model"` e nenhum `fallback` no rastro; com troca → `modelUsed === "backup-model"`
      e `trace[0]` é `{ type: "fallback", from: "primary-model", to: "backup-model", reason:
      "non_transient" }` (sem `nodeName`, que só o grafo carimba)
- [ ] T017 [P] [US2] Em `src/agents/reflection.test.ts`: `withReflection` sobre uma estratégia
      falsa cujo resultado traz `metrics.modelUsed: "backup-model"` preserva `modelUsed` da
      última tentativa, e um crítico falso cujo contador recebeu um `model_fallback` põe o evento
      `fallback` logo antes do `critique` correspondente
- [ ] T018 [P] [US2] Em `src/agents/production-graph.test.ts`: roteador real
      (`createModelRouter(fakeSource(principal 404, reserva que decide "react"))`) → o rastro
      traz um `fallback` com `nodeName: "router"`, antes do `route` (MR1); sumarizador real com
      a mesma fonte, numa conversa de 16 mensagens → `fallback` com `nodeName: "context"`,
      antes do `summarize`; com o roteador e a estratégia usando a mesma fonte falsa (principal
      contando `attempts`), a estratégia faz 0 tentativas no principal depois da troca no
      roteador, e o rastro tem um único `fallback` (MF7, FR-011a); dois `run` seguidos: o
      segundo volta a tentar o principal (MR8)

### Implementation for User Story 2

- [ ] T019 [US2] `src/agents/react.ts` e `src/agents/plan-and-execute.ts`: `trace =
      [...counter.fallbackEvents, ...rastro]` e `metrics.modelUsed` com `counter.modelUsed`
      (omitido quando `undefined`, no mesmo padrão de `promptTokensField`), nos dois ramos de
      retorno de cada um (research R-008, R-009). T016 verde
- [ ] T020 [US2] `src/agents/reflection.ts`: `modelUsed` copiado da última tentativa nos
      quatro retornos; os `fallbackEvents` do `critiqueCounter` acumulados desde a última
      crítica entram antes de cada `critiqueEvent`. T017 verde
- [ ] T021 [US2] `src/agents/production-graph.ts`: classe `FallbackRecorder extends
      BaseCallbackHandler` (guarda `model_fallback` e expõe `drain()`); canal `recorder` no
      estado; `run` cria um recorder por pedido e faz `runWithResilienceScope(() =>
      graph.invoke({ ...input, recorder }, { signal, callbacks: [recorder] }))`; os nós
      `context` e `router` põem `stampNode(recorder.drain(), nodeName)` antes do próprio evento.
      Comentários citando a R-006 e a R-007. T018 verde
- [ ] T022 [US2] Em `src/http/server.test.ts`, `describe("POST /chat — 013 US2")`: com
      `router: createModelRouter(fakeSource(principal 404, reserva))`, a resposta 200 traz
      exatamente um `fallback` com `nodeName: "router"` (MR1); sem troca, nenhum (MR2); com uma
      estratégia falsa que devolve `metrics.modelUsed`, ele chega intacto ao corpo (MR3)

**Checkpoint**: US1 e US2 (as duas P1) completas. A feature é integrável.

---

## Phase 5: User Story 3 - Quando nenhum modelo responde, um erro claro (Priority: P2)

**Goal**: 503 `model_unavailable` quando a estratégia não é atendida por nenhum modelo.

**Independent Test**: com uma estratégia que lança `ModelUnavailableError`, o `/chat` responde
503 sem gravar o turno. Com roteador e sumarizador falhando, a resposta não vira 503.

### Tests for User Story 3

- [ ] T023 [P] [US3] Em `src/agents/production-graph.test.ts`: uma estratégia que lança
      `ModelUnavailableError` faz `run` rejeitar com a **mesma instância** (`assert.equal` no
      erro capturado), sem embrulho do LangGraph (research R-011)
- [ ] T024 [P] [US3] Em `src/http/server.test.ts`, `describe("POST /chat — 013 US3")`:
      estratégia falsa que lança `ModelUnavailableError` → 503, `error.code ===
      "model_unavailable"`, sem `details`, mensagem sem o texto do erro original, turno não
      gravado (conversa sem mensagens novas) e refletor não acionado (`learningProbe` sem
      disparo) (MR4); estratégia que lança `Error` comum → 500 `internal` (MR5); roteador que
      rejeita com `ModelUnavailableError` → 200 com `route.source === "fallback"` (MR6); estratégia
      que nunca resolve com `timeoutMs: 30` → 504 (MR5)

### Implementation for User Story 3

- [ ] T025 [US3] `src/http/errors.ts`: `ChatErrorCode` += `"model_unavailable"`. `src/http/chat.ts`:
      no `.catch` do handler, antes do `next(error)`, `if (error instanceof
      ModelUnavailableError)` → `res.status(503).json(toErrorBody("model_unavailable", "Nenhum
      modelo disponível para atender o pedido. Tente novamente em instantes."))`, com comentário
      citando FR-018/FR-019 e o log do erro original. Se a T023 mostrou embrulho, examinar
      `error.cause`. T023 e T024 verdes

**Checkpoint**: as três histórias completas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T026 [P] `README.md`: `OPENROUTER_MODEL_FALLBACK` na configuração; um parágrafo na seção do
      `/chat` sobre novas tentativas, troca para o reserva, troca válida para o resto do pedido,
      o evento `fallback` (distinto do `route` com `source: "fallback"`) e `metrics.modelUsed`;
      o 503 `model_unavailable` na tabela de erros; nota de que `llmCalls` conta só chamadas
      concluídas; link para `specs/013-model-resilience/`
- [ ] T027 [P] Avisos de emenda, no molde dos da 012: em
      `specs/003-chat-http-api/contracts/chat-endpoint.md` (503 `model_unavailable`, evento
      `fallback`, `metrics.modelUsed`); em `specs/010-context-measurement/contracts/chat-endpoint.md`
      (`llmCalls` conta só chamadas concluídas, R-010); em
      `specs/012-unified-graph/contracts/chat-endpoint.md` (o `fallback` pode aparecer nos nós
      `context` e `router`, antes do `summarize` e do `route`)
- [ ] T028 [P] `.github/copilot-instructions.md`: uma linha na Stack sobre a fábrica resiliente
      (`resilient`, reserva opcional, 503)
- [ ] T029 Portões: `npm run typecheck` e `npm test` verdes, sem rede (quickstart, etapa 1)
- [ ] T030 Roteiro manual com o provedor real (`quickstart.md`, etapas 2 a 4). Exige
      `OPENROUTER_API_KEY` e gasta chamadas reais: confirmar com a pessoa antes de rodar

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: T001, independente.
- **Foundational (2)**: T002 e T004 em paralelo → T003 (usa `FailureKind`) → T005, T006 →
  T007 → T008. Bloqueia tudo.
- **US1 (3)**: depende da Foundational. Remover `createModel` (T007) deixa o `typecheck`
  vermelho até a T014.
- **US2 (4)**: depende da US1 (os pontos de chamada precisam usar `resilient` para despachar os
  eventos).
- **US3 (5)**: depende só da Foundational (T007, `ModelUnavailableError`). Pode rodar em
  paralelo com US1 e US2.
- **Polish (6)**: depois das histórias. T030 só com autorização.

### Parallel Opportunities

- Foundational: T002 e T004.
- US1: T009, T010, T011 (arquivos de teste diferentes); T014 em paralelo com T012/T013.
- US2: T016, T017, T018.
- US3: T023 e T024, em paralelo com US1/US2.
- Polish: T026, T027, T028.

---

## Parallel Example: User Story 1

```bash
Task: "T009 react.test.ts: troca para o reserva no ReAct"
Task: "T010 plan-and-execute.test.ts: troca para o reserva no Plan-and-Execute"
Task: "T011 critic/router/summarizer/distiller: troca para o reserva nas fábricas"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Setup + Foundational (T001–T008): a fábrica resiliente, isolada.
2. US1 (T009–T015): todos os pontos de chamada resilientes.
3. **Parar e validar**: `npm test`, e a etapa 2 do quickstart se houver autorização.

### Incremental Delivery

1. Foundational → `resilient` testado sozinho.
2. US1 → o pedido sobrevive (MVP).
3. US2 → observabilidade. Com as duas P1, a feature é integrável.
4. US3 → 503 acionável.
5. Polish → documentação e avisos de emenda.

---

## Notes

- Dublês (`failingModel`, `okModel`, `fakeSource`) vivem só nos arquivos `*.test.ts` e são
  repetidos em cada um que precisa, no mesmo padrão da 011 e da 012. Nada falso mora em `src/`
  fora dos testes.
- `llmCalls` e `promptTokens` nunca incluem tentativas que falharam (LC1).
- Commit ao fim de cada fase, com a referência às tarefas.
