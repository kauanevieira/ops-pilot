---

description: "Task list for 001-reasoning-core"
---

# Tasks: Núcleo de Raciocínio do OpsPilot

**Input**: Design documents from `/specs/001-reasoning-core/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Incluídos. A spec exige testes explicitamente (FR-034, FR-035) e a convenção do projeto é "lógica nova nasce com teste". Os testes cobrem as partes puras — store e formatação de rastro — conforme delimitado no Complexity Tracking do plano.

**Organization**: Tarefas agrupadas por user story, para implementação e validação independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: User story a que a tarefa pertence (US1, US2, US3)
- Todo caminho de arquivo é relativo à raiz do repositório

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Deixar o ambiente e o projeto prontos para a implementação.

- [X] T001 Atualizar o runtime local para Node 22 LTS e confirmar com `node --version` — **bloqueia todo o resto**: `@langchain/openai@1.5.13` declara `engines.node: ">=22"`, o glob `src/**/*.test.ts` do script `test` depende da expansão nativa do `node --test` (Node 21+), e o Node 20.6.0 instalado quebra `npm run typecheck`. Ver R-010 em research.md
- [X] T002 Declarar `"engines": { "node": ">=22" }` em `package.json` para que a exigência fique registrada no projeto
- [X] T003 Adicionar o script `"seed": "tsx --env-file=.env src/scripts/seed.ts"` em `package.json` e ajustar `arena` para `"tsx --env-file=.env src/arena.ts"`, usando a flag nativa de env (R-007 — `dotenv` é vetado)
- [X] T004 Confirmar que `npm run typecheck` e `npm test` executam sem erro de runtime no Node 22 (suíte ainda vazia, apenas o portão funcionando)

**Checkpoint**: Ambiente correto, scripts prontos, portões de qualidade executáveis.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Núcleo puro e infraestrutura compartilhada por todas as user stories.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

### Domínio

- [X] T005 [P] Criar enums e esquemas zod das entidades em `src/domain/schemas.ts`: `Severity` = `critical | high | medium | low`; `AlertStatus` = `firing | resolved`; `IncidentStatus` = `open | resolved`. `Service.id` obrigatório, único, slug `^[a-z0-9-]+$`; `Service.name` obrigatório, não vazio. `Alert` com `id`, `serviceId` (MUST referenciar um `Service` existente), `summary` não vazio, `severity`, `status`, `firedAt: Date`. `Incident` com `id` gerado na abertura, `title` não vazio, `serviceId`, `severity`, `status`, `openedAt: Date`, `resolvedAt: Date | null` (`null` enquanto `status === "open"`)
- [X] T006 [P] Criar classes de erro de domínio em `src/domain/errors.ts`: `ServiceNotFoundError`, `IncidentNotFoundError`, `IncidentAlreadyResolvedError`, todas derivando de uma base `DomainError` que as torne distinguíveis de falhas técnicas por `instanceof` (FR-015)
- [X] T007 [P] Escrever testes das classes de erro em `src/domain/errors.test.ts`, verificando que cada erro de domínio é `instanceof DomainError` e que falhas técnicas não são

### Store puro

- [X] T008 Implementar as transições puras em `src/store/state.ts` como `(state, command) => newState`, sem efeitos colaterais (FR-018): `openIncident` e `resolveIncident`. Invariantes a garantir: `status === "resolved"` ⟺ `resolvedAt !== null`; `resolvedAt >= openedAt` quando presente; abrir para serviço inexistente lança `ServiceNotFoundError`; resolver inexistente lança `IncidentNotFoundError`; resolver já resolvido lança `IncidentAlreadyResolvedError` (depende de T005, T006)
- [X] T009 Escrever os testes de store em `src/store/state.test.ts` cobrindo cada transição e cada invariante de T008, além de confirmar que o estado de entrada não é mutado. Determinísticos e sem rede (FR-034, FR-035)
- [X] T010 [P] Declarar as interfaces `AlertRepository` e `IncidentRepository` em `src/store/repository.ts` com as assinaturas do contrato em data-model.md — `listAlerts(status?)`, `findService(id)`, `openIncident({title, serviceId, severity})`, `resolveIncident(id)`, `getIncident(id)` (FR-017)
- [X] T011 Implementar o repositório in-memory em `src/store/in-memory.ts` como casca fina que guarda o estado corrente e delega às funções puras de T008 (depende de T008, T010)
- [X] T012 [P] Definir os dados da linha de base em `src/store/seed.ts`: 5 serviços (`checkout`, `payments`, `auth`, `search`, `notifications`) e exatamente 6 alertas — `alert-1` checkout/critical/firing, `alert-2` payments/high/firing, `alert-3` auth/medium/firing, `alert-4` search/low/resolved, `alert-5` notifications/medium/resolved, `alert-6` checkout/high/resolved — e 0 incidentes. Identificadores e timestamps determinísticos, para que reaplicar produza estado idêntico (FR-020, FR-021)

### Rastro

- [X] T013 [P] Definir os tipos do rastro em `src/trace/types.ts`: união discriminada `TraceEvent` por `type` — `thought {content}`, `action {tool, args}`, `observation {content, tool?, isError?}`, `plan {steps, revision}` (revision 0 = plano inicial), `critique {content}`, `answer {content}`; mais `RunMetrics {llmCalls, latencyMs}` e `StrategyResult {answer, trace, metrics, stoppedReason}` com `stoppedReason: "completed" | "max-iterations" | "max-steps"` (FR-002, FR-003, FR-004)
- [X] T014 Implementar `messagesToTrace(messages): TraceEvent[]` como função pura em `src/trace/from-messages.ts`, mapeando `AIMessage` com conteúdo → `thought`, `AIMessage` com `tool_calls` → um `action` por chamada carregando `tool` e `args`, `ToolMessage` → `observation`, `AIMessage` final sem `tool_calls` → `answer` (R-002, FR-003) (depende de T013)
- [X] T015 [P] Implementar a renderização do rastro para terminal em `src/trace/format.ts`, uma linha por evento no formato `[tipo] conteúdo`, com `action` mostrando ferramenta e argumentos serializados (FR-031)
- [X] T016 Escrever os testes de formatação de rastro em `src/trace/format.test.ts` e `src/trace/from-messages.test.ts`, montando arrays de mensagens à mão — sem rede, sem credencial, sem chamar modelo — e verificando que toda `action` preserva ferramenta e argumentos (FR-034, FR-035, SC-004) (depende de T014, T015)

### Agentes — infraestrutura compartilhada

- [X] T017 [P] Declarar a interface `ReasoningStrategy` e `RunOptions` em `src/agents/types.ts` conforme [contracts/reasoning-strategy.md](./contracts/reasoning-strategy.md): `readonly name: string` e `run(input, options?): Promise<StrategyResult>` (FR-001) (depende de T013)
- [X] T018 [P] Implementar a fábrica única do modelo em `src/agents/model.ts`: `new ChatOpenAI({ apiKey, model, temperature: 0, configuration: { baseURL: "https://openrouter.ai/api/v1" } })`, lendo `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` de `process.env` e lançando erro que **nomeia a variável ausente** antes de qualquer chamada (FR-007 a FR-010, R-006)
- [X] T019 [P] Implementar o contador de chamadas de LLM em `src/agents/llm-counter.ts` como `BaseCallbackHandler` que incrementa em `handleChatModelStart`, com instância nova por execução para que duas chamadas a `run` não compartilhem contador (FR-006, R-003, obrigação 8 do contrato)
- [X] T020 Implementar as três ferramentas em `src/agents/tools.ts` com `tool()` de `@langchain/core/tools` e esquemas zod, conforme [contracts/tools.md](./contracts/tools.md): `list_alerts(status?)` somente leitura; `open_incident(title, service, severity)` onde o parâmetro `service` mapeia para `Incident.serviceId`; `resolve_incident(id)`. Erros de domínio traduzidos na borda para observação legível com `isError: true`, **sem abortar a execução** (FR-011 a FR-015, SC-008) (depende de T006, T011)
- [X] T021 Criar o registro de estratégias em `src/agents/registry.ts` como `Record<string, () => ReasoningStrategy>` e o valor padrão de `maxIterations`; consultar nome ausente MUST lançar erro listando as chaves válidas (FR-033) (depende de T017)
- [X] T022 Implementar o comando autônomo de carga inicial em `src/scripts/seed.ts`, aplicando os dados de T012 e imprimindo a confirmação de 5 serviços, 6 alertas (3 firing, 3 resolved) e 0 incidentes; reaplicar MUST deixar estado idêntico (FR-019, FR-021, SC-007) (depende de T011, T012)

**Checkpoint**: Núcleo puro testado, ferramentas operando sobre o store, modelo acessível, carga inicial funcionando. As user stories podem começar.

---

## Phase 3: User Story 1 - Resolver um pedido de plantão com raciocínio auditável (Priority: P1) 🎯 MVP

**Goal**: Uma pessoa de plantão envia um pedido em linguagem natural e recebe resposta final mais o rastro completo do caminho percorrido, com métricas.

**Independent Test**: Com o estado semeado, rodar um pedido de leitura ("quais alertas estão disparando?") e um de escrita ("abra um incidente crítico para o checkout e resolva"), verificando resposta, rastro com `thought`/`action`/`observation`/`answer`, toda `action` carregando ferramenta e argumentos, e métricas preenchidas.

- [X] T023 [US1] Implementar a estratégia ReAct em `src/agents/react.ts` usando `createReactAgent({ llm, tools })` de `@langchain/langgraph/prebuilt`, com `name = "react"`, convertendo o resultado em `StrategyResult` via `messagesToTrace` e anexando o contador de LLM nos `callbacks` da invocação (FR-022, FR-023, R-001) (depende de T014, T017, T018, T019, T020)
- [X] T024 [US1] Implementar o limite de iterações em `src/agents/react.ts` traduzindo `maxIterations` para `recursionLimit = 2 * maxIterations + 1` na config de invocação, e capturando `GraphRecursionError` para retornar `stoppedReason: "max-iterations"` com o rastro parcial preservado, **sem lançar** (FR-005, R-004, obrigação 2 do contrato) (depende de T023)
- [X] T025 [US1] Medir `latencyMs` do início ao retorno de `run` e montar `RunMetrics` com a contagem do handler, garantindo que as métricas estejam presentes inclusive quando a execução parou por limite (FR-004, SC-002) (depende de T023, T024)
- [X] T026 [US1] Registrar `"react"` em `src/agents/registry.ts` (depende de T021, T023)
- [X] T027 [US1] Criar o entrypoint mínimo de execução em `src/arena.ts`: aceita o pedido posicional, aplica a linha de base, roda **uma** estratégia e imprime rastro e métricas. É o veículo de demonstração desta story; a comparação multi-estratégia e as flags chegam na US3 (depende de T015, T022, T026)

**Checkpoint**: US1 entregue e demonstrável isoladamente — o MVP já é útil a quem está de plantão.

---

## Phase 4: User Story 2 - Planejar antes de agir em pedidos multi-etapa (Priority: P2)

**Goal**: Pedidos multi-etapa resolvidos por uma estratégia que monta plano explícito, executa um passo por vez e revisa o restante após cada passo.

**Independent Test**: Rodar um pedido multi-etapa e verificar que o rastro traz um `plan` antes de qualquer `action`, um passo executado por vez com `plan` de revisão entre eles, e encerramento quando o plano se esgota. Testável sem a US3 usando o entrypoint da US1.

- [X] T028 [P] [US2] Definir os esquemas zod de saída estruturada em `src/agents/plan-schemas.ts`: plano como lista ordenada de passos (`steps: string[]`) para o planner, e resposta do replanner como lista de passos restantes ou resposta final (FR-024, R-005)
- [X] T029 [US2] Implementar o grafo em `src/agents/plan-and-execute.ts` com `StateGraph` e três nós — `planner` → `executor` → `replanner` — com estado carregando `input`, `plan: string[]`, `pastSteps: [step, result][]`, `stepCount` e `trace`; `name = "plan-and-execute"`. Planner e replanner usam `withStructuredOutput()` com os esquemas de T028 (FR-024 a FR-027, R-005) (depende de T017, T018, T019, T020, T028)
- [X] T030 [US2] Garantir no nó `executor` que **exatamente um** passo é executado por invocação, com acesso às mesmas ferramentas de T020 (FR-025) (depende de T029)
- [X] T031 [US2] Implementar a aresta condicional do `replanner`: volta ao `executor` enquanto houver passos pendentes e `stepCount < 8`; vai a `END` quando não resta nada, produzindo a resposta final; ao atingir o teto retorna `stoppedReason: "max-steps"` com rastro parcial. O teto é verificado **na aresta**, não dentro do executor, para valer mesmo se o replanner devolver um plano grande de uma vez (FR-026, FR-027, FR-028, R-005) (depende de T029)
- [X] T032 [US2] Emitir no rastro o plano inicial como `plan` com `revision: 0` e cada replanejamento como `plan` com `revision` incrementando, além dos `thought`/`action`/`observation` (FR-029) (depende de T029, T031)
- [X] T033 [US2] Aplicar o limite de iterações e a contagem de LLM nesta estratégia, do mesmo modo que T024 e T025, retornando `stoppedReason` correto (FR-005, FR-006) (depende de T029)
- [X] T034 [US2] Registrar `"plan-and-execute"` em `src/agents/registry.ts` (depende de T021, T029)

**Checkpoint**: Duas estratégias funcionando de forma independente sobre as mesmas ferramentas.

---

## Phase 5: User Story 3 - Comparar estratégias sobre o mesmo pedido (Priority: P3)

**Goal**: Uma invocação roda uma ou mais estratégias sobre o mesmo pedido e apresenta rastro e métricas de cada uma, lado a lado.

**Independent Test**: Rodar `npm run arena -- "<pedido>" --strategies react,plan-and-execute` e verificar duas seções na saída, cada uma com rastro completo e bloco de métricas identificados pelo nome da estratégia.

- [X] T035 [US3] Implementar o parsing e a validação dos argumentos da CLI em `src/arena.ts` com zod, conforme [contracts/arena-cli.md](./contracts/arena-cli.md): pedido posicional obrigatório, `--strategies` como lista separada por vírgula (default: todas as registradas), `--max-iterations` inteiro ≥ 1 (default: o do registro). Validar **antes** de executar qualquer estratégia (depende de T027)
- [X] T036 [US3] Estender `src/arena.ts` para executar as estratégias selecionadas sobre o **mesmo** pedido, cada uma partindo de um estado recém-semeado, de modo que uma não interfira na outra (FR-030) (depende de T035)
- [X] T037 [US3] Imprimir uma seção por estratégia com rastro completo e linha de métricas (`llmCalls`, `latencyMs`, `stoppedReason`), identificadas pelo nome da estratégia (FR-031, SC-005) (depende de T036)
- [X] T038 [US3] Tratar nome de estratégia desconhecido em `src/arena.ts` com erro que lista os nomes válidos e código de saída diferente de zero, **sem executar nenhuma estratégia** (FR-033) (depende de T035)
- [X] T039 [US3] Garantir que estratégia interrompida por limite **não** seja tratada como erro: imprimir rastro parcial e `stoppedReason`, com saída bem-sucedida (contrato arena-cli, FR-005) (depende de T037)

**Checkpoint**: As três user stories funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T040 [P] Atualizar `.env.example` se a implementação revelar alguma variável adicional, mantendo `OPENROUTER_API_KEY=` e `OPENROUTER_MODEL=` sem valores
- [X] T041 [P] Atualizar [.github/copilot-instructions.md](../../.github/copilot-instructions.md) com o script `seed` e a exigência de Node 22, para que a documentação do agente reflita o projeto real
- [X] T042 Confirmar `npm run typecheck` e `npm test` verdes, e que rodar `npm test` duas vezes produz resultado idêntico (SC-006, convenção "sempre verdes")
- [ ] T043 Executar o roteiro completo de [quickstart.md](./quickstart.md), marcando o checklist de aceitação da feature — inclui os casos de teto de 8 passos, limite de iterações, estratégia inválida e credencial ausente
- [X] T044 Revisar se alguma parte pura ficou em `src/agents/` e deveria estar em `src/store/` ou `src/trace/`, preservando a separação puro/efeitoso que sustenta FR-035

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 bloqueia literalmente tudo — sem Node 22 as dependências não rodam
- **Foundational (Phase 2)**: depende do Setup. **BLOQUEIA todas as user stories**
- **User Stories (Phase 3-5)**: dependem da Foundational
  - US1 (P1) é independente das demais
  - US2 (P2) é independente da US1 — usa a mesma infraestrutura da Phase 2
  - US3 (P3) estende o entrypoint criado em T027 (US1); com apenas a US1 pronta, a arena já roda uma estratégia
- **Polish (Phase 6)**: depende das stories desejadas

### Within Each User Story

- Testes das partes puras foram concentrados na Foundational, onde vive o código puro
- Estratégia → limite/métricas → registro → entrypoint
- Story completa antes de passar para a próxima prioridade

### Parallel Opportunities

- **Phase 2**: T005, T006, T010, T012, T013, T015, T017, T018, T019 podem correr em paralelo (arquivos distintos)
- T007 (testes de erro) paralelo a T008/T009 (store)
- **US1 e US2 podem ser desenvolvidas em paralelo** por pessoas diferentes assim que a Phase 2 fechar — tocam arquivos distintos (`react.ts` vs `plan-and-execute.ts`), colidindo apenas em `registry.ts` (T026 e T034)
- **Phase 6**: T040 e T041 em paralelo

---

## Parallel Example: Phase 2 Foundational

```bash
# Primeiro bloco, tudo em paralelo (arquivos distintos, sem dependências):
Task: "Criar enums e esquemas zod em src/domain/schemas.ts"
Task: "Criar classes de erro de domínio em src/domain/errors.ts"
Task: "Declarar interfaces de repositório em src/store/repository.ts"
Task: "Definir dados da linha de base em src/store/seed.ts"
Task: "Definir tipos do rastro em src/trace/types.ts"
Task: "Implementar renderização do rastro em src/trace/format.ts"
Task: "Implementar fábrica do modelo em src/agents/model.ts"
Task: "Implementar contador de chamadas em src/agents/llm-counter.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — **começar por T001**, sem Node 22 nada roda
2. Phase 2: Foundational (crítica, bloqueia tudo)
3. Phase 3: User Story 1
4. **PARAR e VALIDAR**: rodar as Validações 1 a 3 do quickstart
5. O MVP já entrega valor: pedido de plantão resolvido com rastro auditável

### Incremental Delivery

1. Setup + Foundational → núcleo puro testado e ferramentas operando
2. US1 → ReAct com rastro → validar → demo (MVP)
3. US2 → Plan-and-Execute → validar → demo
4. US3 → comparação lado a lado → validar → demo

---

## Notes

- `[P]` = arquivos distintos, sem dependência pendente
- Nenhuma tarefa cria `src/index.ts` (API Express): está fora do escopo desta feature
- `express`, `sequelize` e `mysql2` permanecem instalados mas **não usados** aqui; a persistência entra na feature seguinte, atrás das interfaces de T010
- Commitar a cada tarefa ou grupo lógico
- Parar em qualquer checkpoint para validar a story isoladamente
