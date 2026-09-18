---

description: "Task list for 003-chat-http-api"
---

# Tasks: API HTTP de Chat

**Input**: Design documents from `/specs/003-chat-http-api/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Incluídos e **obrigatórios** — FR-023 a FR-025 exigem teste de integração com estratégia falsa e determinística, e a governança do projeto exige que lógica nova nasça com teste.

**Organization**: Tarefas agrupadas por user story, na ordem de prioridade da spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: US1, US2, US3 — só nas fases de user story
- Todo caminho de arquivo é relativo à raiz do repositório

## Path Conventions

Projeto único: código em `src/`, testes `*.test.ts` **ao lado do código** (convenção já
estabelecida nas features 001 e 002 — não existe diretório `tests/` neste repositório).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Conferir que o terreno está como o plano assume. Nenhum código de produção.

- [X] T001 Confirmar ambiente: `node --version` ≥ 22 e `npm install` limpo; confirmar que `express@5.2.1` e `@types/express@5.0.6` já constam em `package.json` e que **nenhuma dependência nova** será adicionada por esta feature
- [X] T002 Rodar `npm run typecheck` e `npm test` na base atual e registrar que ambos estão verdes — é a linha de base contra a qual a migração do registry (T003–T005) será comparada

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestrutura compartilhada por todas as user stories — o registry no lugar novo, o canal de cancelamento e o formato de erro.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase fechar.

### Migração do registry (R-002, FR-009 a FR-012)

- [X] T003 Mover `src/agents/registry.ts` para `src/agents/index.ts` e acrescentar a superfície nova, preservando `availableStrategyNames()`, `createStrategy(name, store)` e `defaultStrategyNames()` sem mudança de comportamento: exportar `baseStrategyNames(): string[]` (só `react` e `plan-and-execute`), `StrategySelection`, `ResolveStrategy` e `resolveStrategy({ name, reflect }, store)`, que usa `name ?? "react"` (FR-007), `reflect ?? false` (FR-008), aplica `withReflection` quando `reflect` é verdadeiro (FR-010) e **rejeita nomes compostos** como `"reflect:react"`; manter os nomes `reflect:*` de `availableStrategyNames()` **derivados** do mapa base, nunca escritos como literais
- [X] T004 Definir e exportar `UnknownStrategyError` em `src/agents/index.ts`, carregando `validStrategies: string[]`, e fazer `resolveStrategy` lançá-la listando `baseStrategyNames()` enquanto `createStrategy` a lança listando `availableStrategyNames()`; preservar **exatamente** o texto atual da mensagem (`Unknown strategy: "<nome>". Valid strategies: <lista>`) para não quebrar o teste existente que casa por regex
- [X] T005 Apagar `src/agents/registry.ts` e atualizar o import em `src/arena.ts` para `./agents/index.ts` — **com extensão explícita**, porque sob `moduleResolution: NodeNext` o caminho `./agents` não resolve; confirmar que `src/bench.ts` não precisa de alteração (importa as fábricas diretamente)
- [X] T006 Renomear `src/agents/registry.test.ts` para `src/agents/index.test.ts`, atualizar o import e **preservar os três casos existentes intactos** (quatro nomes disponíveis, mensagem de erro listando todos, nome derivado da refletida)
- [X] T007 Acrescentar casos em `src/agents/index.test.ts` para a superfície nova: `baseStrategyNames()` devolve exatamente `["react", "plan-and-execute"]`; `resolveStrategy({}, store)` resolve `react`; `resolveStrategy({ name: "react", reflect: true }, store)` devolve estratégia com `name === "reflect:react"`; `resolveStrategy({ name: "reflect:react" }, store)` lança `UnknownStrategyError`; `resolveStrategy({ name: "planner" }, store)` lança com `validStrategies` igual a `baseStrategyNames()`. Todos offline — construir estratégia não chama modelo

### Canal de cancelamento (R-006, FR-020)

- [X] T008 [P] Acrescentar `signal?: AbortSignal` a `RunOptions` em `src/agents/types.ts` — campo **opcional**, para que arena, bench e os testes das features 001/002 continuem compilando e se comportando igual (FR-012)
- [X] T009 [P] Propagar `options?.signal` na config de `agent.stream(...)` em `src/agents/react.ts`, ao lado de `recursionLimit` e `callbacks`; garantir que o `catch` existente continue tratando **apenas** `GraphRecursionError` como parada normal e relançando o erro de abort
- [X] T010 [P] Propagar `options?.signal` em `src/agents/plan-and-execute.ts` em **três** pontos: a config de `graph.stream(...)` e as **duas** `.invoke()` diretas do planner e do replanner — elas não passam pelo grafo e são o ponto mais fácil de esquecer; garantir que o `catch` que hoje só absorve `GraphRecursionError` relance o erro de abort
- [X] T011 Em `src/agents/reflection.ts`, checar `runOptions?.signal?.aborted` **entre** tentativas (antes de iniciar uma regeneração) e interromper o ciclo em vez de começar uma execução já cancelada; `runOptions` já é repassado íntegro à base, então nada mais muda ali

### Formato de erro (R-004, FR-016, FR-017)

- [X] T012 [P] Criar `src/http/errors.ts` com `type ChatErrorCode = "invalid_body" | "unknown_strategy" | "timeout" | "internal"`, `interface ValidationIssue { path: string; message: string; code: string }`, `interface ChatErrorResponse { error: { code; message; details? } }`, a **função pura** `toErrorBody(code, message, details?): ChatErrorResponse` e um helper puro `zodIssuesToDetails(issues): ValidationIssue[]` que mapeia cada issue do zod para `{ path: issue.path.join("."), message: issue.message, code: issue.code }`
- [X] T013 [P] Criar `src/http/errors.test.ts` cobrindo `toErrorBody` e `zodIssuesToDetails`: corpo sem `details` quando não informado, `details` preservado quando informado, caminho aninhado virando string pontuada, e **`details` ausente para `timeout` e `internal`** (FR-017 — nunca vazar detalhe interno)

**Checkpoint**: `npm run typecheck` e `npm test` verdes; `npm run arena -- "teste" --strategies nao-existe` ainda lista os quatro nomes (Validação 2 do [quickstart](./quickstart.md)).

---

## Phase 3: User Story 1 — Pedir ajuda ao OpsPilot por HTTP (Priority: P1) 🎯 MVP

**Goal**: Um `POST /chat` com apenas `{ "message": "..." }` devolve 200 com `answer`, `trace`, `metrics` e `stoppedReason`, executado pela estratégia padrão `react` sobre o estado compartilhado do processo.

**Independent Test**: Subir a aplicação com uma estratégia falsa injetada, enviar um pedido só com a mensagem, e verificar que o corpo de 200 é exatamente o `StrategyResult` que o dublê produziu, na mesma ordem de eventos.

### Tests for User Story 1

- [X] T014 [P] [US1] Criar `src/http/server.test.ts` com a infraestrutura do teste de integração (R-010): uma estratégia falsa e determinística definida **no próprio arquivo de teste** (objeto `{ name, run }` que devolve um `StrategyResult` fixo, sem I/O), `createApp({ resolveStrategy: fake, timeoutMs })`, `app.listen(0)`, leitura da porta efêmera via `server.address()`, `fetch` nativo do Node contra `http://127.0.0.1:<porta>` e `after()` fechando o listener — **sem `supertest`, sem dependência nova**
- [X] T015 [P] [US1] Em `src/http/server.test.ts`, casos do caminho feliz: corpo `{ "message": "oi" }` responde 200; o corpo é **idêntico** ao `StrategyResult` do dublê, com `trace` na mesma ordem e sem eventos filtrados (FR-004, R-012); `stoppedReason` presente (FR-006); `resolveStrategy` recebeu `name` indefinido, provando que o padrão `react` sai do registry e não do handler (FR-007); dois pedidos seguidos recebem métricas próprias, sem acúmulo (FR-005)

### Implementation for User Story 1

- [X] T016 [US1] Criar `src/http/chat.ts` com `chatRequestSchema` (R-003, [data-model.md](./data-model.md)): `message: z.string().trim().min(1)`, `strategy: z.string().trim().min(1).optional()`, `reflect: z.boolean().optional().default(false)`; usar `z.object` (**não** `z.strictObject`) para que campos desconhecidos sejam descartados em silêncio; **não** colocar a lista de estratégias válidas dentro do schema — a existência do nome é verificada depois, senão 422 viraria 400
- [X] T017 [US1] Em `src/http/chat.ts`, implementar o handler do caminho feliz: validar o corpo com o schema, resolver a estratégia pela `resolveStrategy` injetada, executar `run(message, { maxIterations: DEFAULT_MAX_ITERATIONS })` e responder `res.status(200).json(result)` sem transformar nada (FR-003, FR-004)
- [X] T018 [US1] Criar `src/http/server.ts` com `createApp(deps: ChatAppDeps = {}): express.Application` (R-001, FR-026): monta `express.json()`, registra `POST /chat`, **não abre porta**; padrões de produção — `store` = `new InMemoryOpsRepository(baselineState())` criado **uma vez** por aplicação e compartilhado por todas as requisições (FR-012a, FR-012c, R-008), `resolveStrategy` = o de `src/agents/index.ts`, `timeoutMs` = `180_000`
- [X] T019 [US1] Substituir `src/index.ts` (hoje vazio) pelo bootstrap: validar `process.env.PORT` com `z.coerce.number().int().min(1).max(65535).default(3000)` (R-011 — variável de ambiente é entrada externa e a governança exige zod), chamar `createApp()` e `listen`, e logar a porta
- [X] T020 [US1] Em `package.json`, acrescentar `--env-file-if-exists=.env` ao script `dev`, alinhando-o a `arena` e `bench` — o servidor precisa de `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` para executar estratégias reais, e o carregamento fica no runtime, sem que nenhum código passe a ler `.env`

**Checkpoint**: MVP entregue. `npm test` verde e [Validação 3](./quickstart.md) do quickstart (curl real) devolve 200 com rastro equivalente ao que a arena imprime.

---

## Phase 4: User Story 2 — Escolher a estratégia e ligar a reflexão (Priority: P2)

**Goal**: O mesmo endpoint aceita `strategy` e `reflect` no corpo e executa a combinação pedida, sem entrada registrada por combinação.

**Independent Test**: Enviar o mesmo pedido com cada estratégia disponível, com e sem `reflect`, e verificar que a seleção repassada ao registry corresponde ao corpo e que o resultado devolvido é o daquela combinação.

### Tests for User Story 2

- [X] T021 [P] [US2] Em `src/http/server.test.ts`, casos de seleção: `{ "strategy": "plan-and-execute" }` chega ao `resolveStrategy` como `name: "plan-and-execute"`; `{ "reflect": true }` chega como `reflect: true`; omitir ambos chega como `name` indefinido e `reflect: false` (FR-007, FR-008); o resultado devolvido é o da estratégia que o registry resolveu, não o de outra
- [X] T022 [P] [US2] Em `src/agents/index.test.ts`, caso de cobertura combinatória (SC-002, SC-008): para **cada** nome de `baseStrategyNames()`, `resolveStrategy` com e sem `reflect` devolve uma estratégia cujo `name` é o esperado (`<nome>` e `reflect:<nome>`) — escrito como laço sobre a lista, para que uma estratégia futura entre na cobertura sem editar o teste

### Implementation for User Story 2

- [X] T023 [US2] Em `src/http/chat.ts`, repassar `{ name: body.strategy, reflect: body.reflect }` para `resolveStrategy` em vez de resolver o padrão no handler — a decisão de padrão e a aplicação de `withReflection` ficam no registry (FR-009, FR-010), e o handler não conhece nome de estratégia nenhum

**Checkpoint**: US1 e US2 funcionando. [Validação 3](./quickstart.md) com `"reflect": true` mostra evento `critique` no rastro e `llmCalls` maior.

---

## Phase 5: User Story 3 — Saber exatamente por que um pedido falhou (Priority: P3)

**Goal**: 400, 422, 504 e 500 distinguíveis pelo corpo, com formato consistente e sem vazar detalhe interno.

**Independent Test**: Enviar um corpo inválido, um nome de estratégia inexistente e uma execução que estoura o deadline, e verificar três respostas com `code` distinto e `details` adequado a cada uma.

### Tests for User Story 3

- [X] T024 [P] [US3] Em `src/http/server.test.ts`, casos de 400 (FR-014): `{}`, `{ "message": "" }`, `{ "message": "   " }`, `{ "message": "oi", "reflect": "sim" }` e `{ "message": "oi", "strategy": "  " }` respondem 400 com `code: "invalid_body"` e `details` apontando o campo; corpo `"{"` (JSON malformado) responde 400 com o **mesmo** `code`, e não HTML de stack trace (R-005); campo desconhecido no corpo é descartado sem erro; e em **todos** esses casos o dublê de estratégia **não foi chamado** (SC-003)
- [X] T025 [P] [US3] Em `src/http/server.test.ts`, casos de 422 (FR-015): `{ "message": "oi", "strategy": "planner" }` responde 422 com `code: "unknown_strategy"` e `details.validStrategies` igual a `baseStrategyNames()`; `{ "message": "oi", "strategy": "reflect:react" }` também responde **422**, porque na API a reflexão é o campo `reflect` e não um prefixo de nome
- [X] T026 [P] [US3] Em `src/http/server.test.ts`, casos de 504 com `timeoutMs` de dezenas de milissegundos (FR-025 — a suíte não espera 180 s reais): um dublê que nunca resolve responde 504 com `code: "timeout"` e **sem** resultado parcial (FR-019); o `AbortSignal` recebido pelo `run()` do dublê foi de fato abortado (FR-020); e um dublê que resolve **logo depois** do deadline não provoca segunda escrita — exatamente um corpo enviado, sem `ERR_HTTP_HEADERS_SENT` (FR-021)
- [X] T027 [P] [US3] Em `src/http/server.test.ts`, casos de 500 e resiliência: um dublê que lança responde 500 com `code: "internal"`, **sem** `details`, sem stack e sem a mensagem da exceção no corpo (FR-017); e uma requisição seguinte, com dublê sadio, ainda responde 200 (SC-006)

### Implementation for User Story 3

- [X] T028 [US3] Em `src/http/chat.ts`, traduzir a falha do `chatRequestSchema` em 400 com `toErrorBody("invalid_body", ..., zodIssuesToDetails(error.issues))`, garantindo que a validação aconteça **antes** de qualquer resolução ou execução de estratégia (FR-013, SC-003)
- [X] T029 [US3] Em `src/http/chat.ts`, capturar `UnknownStrategyError` vinda de `resolveStrategy` e traduzir em **422** com `code: "unknown_strategy"` e `details: { validStrategies }` tirados da própria exceção — a lista nunca escrita à mão no handler (FR-011, FR-015)
- [X] T030 [US3] Em `src/http/chat.ts`, implementar o deadline (R-006, FR-018 a FR-021): criar um `AbortController`/`AbortSignal.timeout(timeoutMs)`, passar o `signal` em `RunOptions` **e** correr `run()` contra o deadline; o que chegar primeiro decide; responder 504 com `code: "timeout"` ao estourar; guardar toda escrita atrás de `res.headersSent` para não enviar duas respostas; e pôr `.catch()` no lado perdedor da corrida para que a execução abortada não vire `unhandledRejection` e derrube o processo
- [X] T031 [US3] Em `src/http/server.ts`, registrar o error handler do Express (quatro argumentos, **depois** das rotas): reconhecer o `SyntaxError` com `status === 400` e propriedade `body` que `express.json()` lança para corpo não-JSON e responder `invalid_body` (R-005); qualquer outra exceção vira 500 `internal` sem `details`; nunca deixar o handler padrão do Express responder HTML (FR-016, FR-017)

**Checkpoint**: todas as user stories independentes e funcionando. [Validação 4](./quickstart.md) do quickstart devolve 400, 422 e 422.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T032 Rodar a [Validação 1](./quickstart.md) completa: `npm run typecheck` e `npm test` verdes, suíte inteira em menos de 30 s e **sem nenhum acesso à rede** (SC-007); conferir os 13 casos da tabela cobertos
- [X] T033 [P] Rodar a [Validação 2](./quickstart.md) — regressão da arena após a migração do registry: `npm run arena -- "quais alertas estão abertos?" --strategies reflect:react` falha só por credencial, e `--strategies nao-existe` ainda lista os quatro nomes (FR-012)
- [X] T034 [P] Rodar as [Validações 5 e 6](./quickstart.md) com credenciais: dois pedidos em sequência provam que o estado é compartilhado (FR-012a, SC-009), reiniciar o servidor volta ao baseline (FR-012c), e nenhum erro previsto derruba o processo (SC-006)
- [X] T035 [P] Atualizar `README.md` com a seção da API: como subir (`npm run dev`), `PORT`, o contrato do `POST /chat` com exemplo de `curl`, a tabela de status (200/400/422/500/504) e a nota de que o estado é compartilhado no processo e não é durável
- [X] T036 [P] Atualizar `.github/copilot-instructions.md` na seção **Comandos** para descrever `npm run dev` como "sobe a API HTTP (`src/index.ts`)" em vez de "inicia a aplicação", já que agora o comando faz algo concreto
- [X] T037 Varredura final: `grep -rn "registry.ts" src/` não retorna nada; nenhum arquivo em `src/` contém estratégia falsa ou código de teste; `package.json` sem dependência nova; log do servidor sem `unhandledRejection` após as validações online

---

## Dependencies & Execution Order

### Ordem entre fases

1. **Setup (T001–T002)** → conferência; não bloqueia código, mas dá a linha de base da regressão
2. **Foundational (T003–T013)** → bloqueia **tudo**
3. **US1 (T014–T020)** → MVP; depende de Foundational
4. **US2 (T021–T023)** → depende de US1 (edita o mesmo handler)
5. **US3 (T024–T031)** → depende de US1; independente de US2 na prática, mas edita os mesmos dois arquivos, então serializar evita conflito
6. **Polish (T032–T037)** → depende de US3

### Dependências pontuais

- T004 → T003 · T005 → T003, T004 · T006 → T005 · T007 → T003
- T009, T010 → T008 · T011 → T008
- T013 → T012
- T016 → T012 · T017 → T016, T003 · T018 → T017 · T019 → T018 · T020 → T019
- T015 → T014, T018 · T021 → T014, T023 · T022 → T003
- T023 → T017 · T028 → T016, T012 · T029 → T004, T012 · T030 → T008, T018 · T031 → T018, T012
- T024 → T028, T031 · T025 → T029 · T026 → T030 · T027 → T031
- T032 → todas as tarefas de teste · T037 → T005

### Oportunidades de paralelismo

```bash
# Foundational — três frentes em arquivos disjuntos:
Task: "Mover registry para src/agents/index.ts"            # T003 (bloqueia T004–T007)
Task: "RunOptions += signal em src/agents/types.ts"        # T008 (bloqueia T009–T011)
Task: "Criar src/http/errors.ts"                           # T012 (bloqueia T013)

# Propagação do signal — três arquivos distintos, depois de T008:
Task: "signal em src/agents/react.ts"                      # T009
Task: "signal em src/agents/plan-and-execute.ts"           # T010
Task: "signal entre tentativas em src/agents/reflection.ts" # T011

# US3 — os quatro blocos de teste são independentes entre si:
Task: "Casos de 400 em src/http/server.test.ts"            # T024
Task: "Casos de 422"                                       # T025
Task: "Casos de 504"                                       # T026
Task: "Casos de 500 e resiliência"                         # T027

# Polish — validações e docs independentes:
Task: "Validação 2 — regressão da arena"                   # T033
Task: "Validações 5 e 6 — estado e resiliência"            # T034
Task: "Atualizar README.md"                                # T035
Task: "Atualizar copilot-instructions.md"                  # T036
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — conferência e linha de base
2. Phase 2: Foundational — registry migrado, `signal` propagado, formato de erro pronto
3. Phase 3: User Story 1
4. **PARAR e VALIDAR**: `npm test` verde + [Validação 2](./quickstart.md) (arena intacta) + [Validação 3](./quickstart.md) (curl real)
5. O MVP já entrega valor: o OpsPilot deixa de exigir o repositório clonado para ser usado

### Incremental Delivery

1. Foundational → registry no lugar novo e arena intacta (regressão zero é o entregável desta fase)
2. US1 → `POST /chat` respondendo → validar → demo (MVP)
3. US2 → escolha de estratégia e reflexão → validar → demo
4. US3 → erros distinguíveis → validar → demo

---

## Notes

- `[P]` = arquivos distintos, sem dependência pendente
- **Nenhuma dependência nova** em `package.json`; a única alteração é a flag `--env-file-if-exists=.env` no script `dev` (T020)
- **A estratégia falsa mora no arquivo de teste**, nunca em `src/` — T037 verifica
- **A migração do registry é a única fonte real de regressão** desta feature: T033 existe só para isso, e `src/bench.ts` não deve ser tocado por tarefa nenhuma
- **`src/trace/`, `src/domain/` e `src/store/` não são alterados** por nenhuma tarefa — se alguma precisar, a camada Controller vazou para dentro do Model
- **`src/agents/tools.ts` não é alterado**: ele já traduz `DomainError` em observação de rastro, e um segundo ponto de tradução na borda HTTP criaria duas verdades sobre o mesmo erro (R-009)
- O risco de efeito colateral sobrevivente a um timeout (R-008) é conhecido e assumido, não resolvido: está registrado como edge case na spec
- Commitar a cada tarefa ou grupo lógico
- Parar em qualquer checkpoint para validar a story isoladamente
