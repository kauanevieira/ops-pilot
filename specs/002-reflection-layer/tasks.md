---

description: "Task list for 002-reflection-layer"
---

# Tasks: Camada de Reflexão

**Input**: Design documents from `/specs/002-reflection-layer/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Incluídos, e desta vez **sem ressalva**. A convenção do projeto é "lógica nova nasce com teste", e toda a lógica que esta feature acrescenta é lógica de controle — contar tentativas, decidir quando parar, montar rastro, somar métricas. Com o crítico e a estratégia base injetados (R-004), o ciclo inteiro é testável offline, sem rede e sem credenciais.

**Organization**: Tarefas agrupadas por user story, para implementação e validação independentes.

**Status (2026-09-18)**: Implementação completa e coberta por 45 testes offline (`npm run typecheck` e `npm test` verdes). As tarefas T002, T027, T028, T029 e T030 permanecem **não marcadas** — não por falha, mas porque são validações *online* do quickstart e o OpenRouter está retornando `429 free-models-per-day` (cota diária do modelo gratuito esgotada) neste ambiente. T032 (fechamento do portão) também fica pendente por depender delas. Assim que a cota resetar ou outro modelo for configurado em `.env`, essas cinco tarefas ficam prontas para rodar sem nenhuma mudança de código.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: User story a que a tarefa pertence (US1, US2, US3)
- Todo caminho de arquivo é relativo à raiz do repositório

---

## Phase 1: Setup

**Purpose**: Confirmar que o ponto de partida está íntegro. Esta feature não acrescenta dependência, script nem configuração.

- [X] T001 Confirmar o runtime com `node --version` (esperado ≥ 22; o ambiente atual roda 22.22.2) e registrar a linha de base rodando `npm run typecheck` e `npm test` — ambos devem estar verdes **antes** de qualquer alteração, para que qualquer quebra posterior seja atribuível a esta feature (R-012)
- [ ] T002 Confirmar que a feature 001 está funcional executando `npm run arena -- "quais alertas estão disparando?" --strategies react`, com credenciais do OpenRouter em `.env`. Sem isto, nada do que a 002 decora existe

**Checkpoint**: Base verde e estratégias cruas operando.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos, esquema e crítico — compartilhados por US1 e US2.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

- [X] T003 [P] Estender `StoppedReason` em `src/trace/types.ts` para `"completed" | "max-iterations" | "max-steps" | "max-reflections"`. Mudança **aditiva**: não alterar `TraceEvent` (o evento `critique` já existe desde a 001) nem `src/trace/format.ts`, que interpola `stoppedReason` sem `switch`. Rodar `npm test` em seguida para confirmar que `src/trace/format.test.ts` continua verde (R-005, R-006)
- [X] T004 [P] Definir em `src/agents/critic.ts` o esquema zod `critiqueSchema = z.object({ approved: z.boolean(), feedback: z.string() })` e os tipos `Critique = z.infer<typeof critiqueSchema>`, `CritiqueContext { input: string; answer: string; observations: { tool?: string; content: string; isError?: boolean }[]; actions: { tool: string; args: Record<string, unknown> }[] }` e `Critic = (context: CritiqueContext) => Promise<Critique>`. `approved` e `feedback` são ambos obrigatórios; `feedback` não vazio quando `approved === false`, podendo ser vazio quando `approved === true` (data-model.md, contracts/critic.md)
- [X] T005 Implementar a função **pura** `buildCritiqueContext(input: string, result: StrategyResult): CritiqueContext` em `src/agents/critic.ts`: extrai os eventos `observation` e `action` do `result.trace` preservando a ordem, usa `result.answer` como `answer`, e recebe o **pedido original** como `input` — nunca o input enriquecido da regeneração. Rastro sem observações produz `observations: []`, não erro. Sem I/O (FR-008, R-004) (depende de T004)
- [X] T006 Escrever os testes de `buildCritiqueContext` em `src/agents/critic.test.ts`: ordem preservada de `observation` e `action`; eventos `thought`/`plan`/`answer` ignorados; `isError` e `tool` propagados quando presentes; rastro vazio → listas vazias; pureza (a entrada não é mutada). Determinísticos e offline (depende de T005)
- [X] T007 Implementar `createLlmCritic(): Critic` em `src/agents/critic.ts` usando `createModel().withStructuredOutput(critiqueSchema)` — a fábrica única, sem configuração de modelo própria — e passando uma instância própria de `LlmCallCounter` em `callbacks`, exposta ao chamador para a soma de métricas. Não recebe ferramentas nem acesso ao store. Lança em falha de rede/timeout/parecer inválido: o `try/catch` é responsabilidade do decorator (FR-007, FR-009, R-003, R-008, R-009) (depende de T004)
- [X] T008 Escrever o prompt do crítico em `src/agents/critic.ts`, no padrão dos prompts de `src/agents/plan-schemas.ts`. Deve reprovar quando: (1) a resposta contradiz uma observação registrada; (2) a resposta afirma fato operacional — alerta, incidente, serviço, estado — que nenhuma observação sustenta, inclusive quando não há observação alguma; (3) a resposta não atende, ou atende só em parte, ao que foi pedido. **Não** reprovar por estilo, tom ou verbosidade. Exigir `feedback` acionável — o que falta e o que fazer, não só que está errado, porque é ele que alimenta a regeneração (FR-010, FR-012, contracts/critic.md) (depende de T007)

**Checkpoint**: Crítico pronto e testado na parte pura; tipos estendidos sem quebrar a 001.

---

## Phase 3: User Story 1 — Respostas revisadas antes de chegarem ao plantão (Priority: P1) 🎯 MVP

**Goal**: O ciclo de crítica e regeneração funcionando: a resposta entregue é a da última tentativa, o ciclo para em aprovação ou no limite, e nada disso derruba a execução.

**Independent Test**: Com uma estratégia base falsa e um crítico falso, verificar que a base roda o número certo de vezes, que a resposta devolvida é a da última tentativa, e que o limite é respeitado — tudo offline. Em seguida, [Validação 2](./quickstart.md) do quickstart com `reflect:react` real.

### Testes (escritos junto com a implementação, não depois)

- [X] T009 [P] [US1] Criar os dublês em `src/agents/reflection.test.ts`: uma estratégia base falsa que conta invocações, registra os `input` e `RunOptions` recebidos e devolve `StrategyResult` roteirizados; e críticos falsos (sempre aprova / sempre reprova / aprova na 2ª / lança erro). Sem rede, sem modelo, sem credenciais (R-004)
- [X] T010 [US1] Escrever em `src/agents/reflection.test.ts` os testes do ciclo: crítico aprova de primeira → base roda 1× e a resposta é a da 1ª tentativa (FR-011); reprova depois aprova → base roda 2× e a resposta é a da 2ª (FR-012); reprova sempre com `maxReflections: 2` → base roda exatamente 3× e `stoppedReason === "max-reflections"` (FR-014, FR-015, SC-003); `maxReflections: 0` → base roda 1×, zero chamada de crítico, resultado idêntico ao da base com `stoppedReason` intacto (FR-016); crítico lança → `run` **resolve**, não rejeita, entregando a resposta corrente com o `stoppedReason` da tentativa (FR-017, SC-006); `name === "reflect:<nome-da-base>"` (FR-003); `RunOptions` chega íntegro à base em **toda** tentativa (FR-005); duas chamadas a `run` na mesma instância não compartilham estado (FR-002) (depende de T009)

### Implementação

- [X] T011 [US1] Implementar o esqueleto de `withReflection(strategy: ReasoningStrategy, options?: ReflectionOptions): ReasoningStrategy` em `src/agents/reflection.ts`: `ReflectionOptions { maxReflections?: number; critic?: Critic }` com padrões `maxReflections = 2` (FR-004) e `critic = createLlmCritic()`; `name` derivado como `` `reflect:${strategy.name}` `` — derivado, nunca literal (FR-003, R-011); atalho explícito para `maxReflections === 0` devolvendo o resultado da base sem tocá-lo, sem evento de crítica e sem chamada extra (FR-016, R-010) (depende de T003, T004)
- [X] T012 [US1] Implementar o laço de reflexão em `src/agents/reflection.ts` conforme o algoritmo de [contracts/reflection.md](./contracts/reflection.md): executa a base, chama o crítico com `buildCritiqueContext(inputOriginal, resultado)`, encerra em `approved` (FR-011), regenera enquanto houver reflexões disponíveis (FR-012), e garante o teto de `maxReflections + 1` execuções da base (FR-014). O `RunOptions` recebido é repassado íntegro à base em toda tentativa — o orçamento de iterações vale por tentativa, não é dividido (FR-005) (depende de T011, T005)
- [X] T013 [US1] Implementar em `src/agents/reflection.ts` a montagem **pura** do input enriquecido da regeneração: pedido original + resposta reprovada + feedback do crítico + as ações já executadas com suas observações + a instrução explícita de **não repetir ações que já tiveram efeito** (`open_incident`, `resolve_incident`), tratando as observações anteriores como fato consumado. O `input` do `CritiqueContext` continua sendo o pedido **original**, para o crítico julgar contra o que o usuário pediu (FR-012, R-002, data-model.md) (depende de T012)
- [X] T014 [US1] Implementar a precedência de `stoppedReason` em `src/agents/reflection.ts` conforme a tabela de [data-model.md](./data-model.md): aprovado → o da tentativa aprovada; `maxReflections = 0` → o da única tentativa, intacto; crítico falhou → o da tentativa corrente; reflexões esgotadas sem aprovação → `"max-reflections"`, que **prevalece** sobre o da tentativa (FR-015) (depende de T012)
- [X] T015 [US1] Implementar o `try/catch` em volta da chamada do crítico em `src/agents/reflection.ts`: qualquer falha — rede, timeout, parecer que não valida contra `critiqueSchema` — encerra o ciclo entregando a resposta corrente, **sem propagar erro** de `run` (FR-017, R-009) (depende de T012)
- [X] T016 [US1] Rodar `npm run typecheck` e `npm test` até verdes, com os testes de T010 passando (depende de T011–T015)

**Checkpoint**: MVP entregue — o ciclo de reflexão funciona e está coberto offline. O rastro e as métricas ainda são os da última tentativa apenas; US2 os completa.

---

## Phase 4: User Story 2 — Auditar a crítica e o custo da reflexão (Priority: P2)

**Goal**: O rastro final conta a história inteira — todas as tentativas, cada parecer no lugar certo — e as métricas cobram o preço real da reflexão.

**Independent Test**: Offline, com os mesmos dublês: verificar a ordem do rastro, o número e o conteúdo dos eventos `critique`, e a soma de `llmCalls`. Em seguida, [Validação 3](./quickstart.md) comparando `react` e `reflect:react` na arena.

**Depende de US1**: esta story edita a mesma função `withReflection`. Não é independente no sentido de "implementável antes", mas é um incremento separável e separadamente verificável — US1 entrega respostas revisadas, US2 as torna auditáveis.

### Testes

- [X] T017 [P] [US2] Escrever em `src/agents/reflection.test.ts` os testes de rastro: com duas tentativas, o rastro final é `eventos da tentativa 1 + critique + eventos da tentativa 2 + critique`, nessa ordem (FR-019); cada `critique` vem imediatamente após o último evento da tentativa que avaliou (R-007); o `answer` das tentativas **reprovadas** permanece no rastro, para que a regressão seja auditável; o número de eventos `critique` nunca excede `maxReflections + 1`; `maxReflections: 0` produz zero eventos `critique` (depende de T010)
- [X] T018 [P] [US2] Escrever em `src/agents/reflection.test.ts` os testes de conteúdo do evento de crítica: prefixo `aprovado: ` quando `approved === true`, `reprovado: ` quando `false` (FR-018), e `indisponível: ` quando o crítico lançou — distinguível de uma reprovação (FR-020) (depende de T010)
- [X] T019 [P] [US2] Escrever em `src/agents/reflection.test.ts` os testes de métricas: `llmCalls` = soma dos `metrics.llmCalls` de todas as tentativas + as chamadas do crítico (FR-022); `latencyMs` cobre o `run` decorado inteiro e **não** é a soma das tentativas (FR-023); com `maxReflections: 0`, `llmCalls` é idêntico ao da base (depende de T010)

### Implementação

- [X] T020 [US2] Implementar a acumulação do rastro em `src/agents/reflection.ts`: concatenar, em ordem cronológica, os eventos de cada tentativa, inserindo o evento `critique` logo após o último evento da tentativa avaliada. Nenhum evento sintético de delimitação — a fronteira entre tentativas **é** o evento de crítica (FR-019, FR-021, R-007) (depende de T012)
- [X] T021 [US2] Emitir o evento `{ type: "critique", content }` em `src/agents/reflection.ts` com os prefixos estáveis `aprovado: `, `reprovado: ` e `indisponível: `, seguidos do feedback ou do motivo da falha. Reusar o tipo `critique` que já existe em `src/trace/types.ts`: **não** acrescentar campos ao evento nem alterar `src/trace/format.ts` (FR-018, FR-020, R-006) (depende de T020, T015)
- [X] T022 [US2] Implementar a agregação de métricas em `src/agents/reflection.ts`: somar `metrics.llmCalls` de cada tentativa e as chamadas contabilizadas pelo `LlmCallCounter` do crítico (T007); medir `latencyMs` como relógio de parede do `run` decorado inteiro, do início da primeira tentativa ao fim da última revisão (FR-022, FR-023, R-008) (depende de T012, T007)
- [X] T023 [US2] Rodar `npm run typecheck` e `npm test` até verdes, com T017–T019 passando (depende de T020–T022)

**Checkpoint**: Rastro e métricas completos e verificados offline.

---

## Phase 5: User Story 3 — Comparar, na arena, com e sem reflexão (Priority: P3)

**Goal**: `reflect:react` e `reflect:plan-and-execute` disponíveis na arena, ao lado das cruas.

**Independent Test**: [Validação 3](./quickstart.md) — quatro blocos de saída, um por estratégia, cada um com rastro e métricas próprios; e [Validação 5](./quickstart.md) para a mensagem de nome inválido.

- [X] T024 [US3] Alterar `src/agents/registry.ts` para **derivar** as entradas refletidas a partir do mapa `FACTORIES` base, compondo `withReflection(baseFactory(store))` — o nome vem de `reflect:${strategy.name}`, não de string literal escrita no registro, para impedir divergência entre o nome registrado e o `name` reportado pela estratégia (FR-024, R-011) (depende de T011)
- [X] T025 [US3] Confirmar que `availableStrategyNames()` passa a devolver os quatro nomes — `react`, `plan-and-execute`, `reflect:react`, `reflect:plan-and-execute` — e que a mensagem de erro de nome inválido já existente em `src/arena.ts` passa a listá-los **sem nenhuma alteração em `src/arena.ts`** (FR-025). Validar com `npm run arena -- "teste" --strategies reflect:nao-existe`, esperando código de saída 1 (depende de T024)
- [X] T026 [US3] Decidir e registrar o comportamento padrão da arena **sem** `--strategies`: como ela usa `availableStrategyNames()` como padrão, passará a rodar as quatro estratégias, triplicando o custo de modelo de uma invocação sem flags. Se isso não for desejado, restringir o padrão às estratégias cruas em `src/arena.ts` e anotar a decisão aqui (ponto de atenção 2 do plano) (depende de T024)
- [ ] T027 [US3] Rodar a [Validação 3](./quickstart.md) do quickstart com as quatro estratégias e confirmar que cada bloco `reflect:*` reporta `llmCalls` estritamente maior que o do seu par cru, quando houve ao menos uma revisão (SC-004, SC-007) (depende de T024)

**Checkpoint**: Feature completa e comparável lado a lado.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T028 [P] Rodar a [Validação 2](./quickstart.md) — `reflect:react` isolado — e confirmar que o rastro termina com ao menos um `[critique]` prefixado por `aprovado:` ou `reprovado:`
- [ ] T029 [P] Rodar a [Validação 4](./quickstart.md) com um pedido ambíguo e confirmar que uma regeneração de fato ocorre: `[critique] reprovado:` seguido de novas ações de ferramenta e de um segundo `[answer]`. Se o crítico aprovar de primeira, o caso não foi induzido — repetir com pedido mais ambíguo, não é falha (SC-002)
- [ ] T030 Rodar a [Validação 6](./quickstart.md) — risco conhecido de efeito colateral duplicado — contando os eventos `[action] open_incident` do rastro após uma regeneração. **Esta validação pode falhar sem invalidar a feature**: R-002 assume mitigação por contexto, não garantia. Registrar o resultado observado; se duplicar com frequência, abrir a recomendação de tornar `open_incident` idempotente, que é mudança de domínio e está fora do escopo desta feature
- [X] T031 [P] Atualizar [README.md](../../README.md) com os dois nomes novos de estratégia e uma linha sobre o custo multiplicativo da reflexão (padrão: até 3 execuções da base + 3 chamadas de crítico)
- [ ] T032 Fechar o portão de aceitação do [quickstart](./quickstart.md): `npm run typecheck` e `npm test` verdes, e os seis critérios da tabela final conferidos

---

## Dependencies & Execution Order

### Ordem entre fases

1. **Setup (T001–T002)** → sem bloqueio de ambiente desta vez; é só conferência
2. **Foundational (T003–T008)** → bloqueia tudo
3. **US1 (T009–T016)** → MVP; depende de Foundational
4. **US2 (T017–T023)** → depende de US1 (edita a mesma função)
5. **US3 (T024–T027)** → depende de T011 (precisa de `withReflection` existindo); pode começar assim que US1 fechar, em paralelo com US2
6. **Polish (T028–T032)** → depende de US3

### Dependências pontuais

- T005 → T004 · T006 → T005 · T007 → T004 · T008 → T007
- T011 → T003, T004 · T012 → T011, T005 · T013, T014, T015 → T012
- T020 → T012 · T021 → T020, T015 · T022 → T012, T007
- T024 → T011 · T025, T026, T027 → T024

### Oportunidades de paralelismo

```bash
# Foundational — dois arquivos distintos, sem dependência entre si:
Task: "Estender StoppedReason em src/trace/types.ts"            # T003
Task: "Definir critiqueSchema e tipos em src/agents/critic.ts"  # T004

# US2 — os três blocos de teste são independentes entre si:
Task: "Testes de rastro em src/agents/reflection.test.ts"       # T017
Task: "Testes de conteúdo da crítica"                           # T018
Task: "Testes de métricas"                                      # T019

# US3 e US2 podem correr em paralelo depois que US1 fechar:
Task: "Derivar reflect:* em src/agents/registry.ts"             # T024
Task: "Acumulação de rastro em src/agents/reflection.ts"        # T020

# Polish — validações independentes:
Task: "Validação 2 do quickstart"                               # T028
Task: "Validação 4 do quickstart"                               # T029
Task: "Atualizar README.md"                                     # T031
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — conferência rápida, sem bloqueio de ambiente
2. Phase 2: Foundational — crítico e tipos, bloqueia tudo
3. Phase 3: User Story 1
4. **PARAR e VALIDAR**: `npm test` verde + [Validação 2](./quickstart.md)
5. O MVP já entrega valor: respostas revisadas antes de chegarem ao plantão

### Incremental Delivery

1. Foundational → crítico pronto, parte pura testada
2. US1 → ciclo de reflexão → validar → demo (MVP)
3. US2 → rastro e métricas completos → validar → demo
4. US3 → comparação na arena → validar → demo

---

## Notes

- `[P]` = arquivos distintos, sem dependência pendente
- Nenhuma dependência nova, nenhum script novo em `package.json`
- **Nenhuma tarefa altera `src/agents/react.ts` ou `src/agents/plan-and-execute.ts`** — se alguma precisar, o decorator falhou em ser um decorator (FR-001)
- **Nenhuma tarefa altera `src/trace/format.ts`** — o evento `critique` já é renderizado e `stoppedReason` é interpolado
- A única alteração em `src/arena.ts` é a opcional de T026
- O risco de efeito colateral duplicado (R-002) é conhecido e assumido, não resolvido: T030 o torna visível
- Commitar a cada tarefa ou grupo lógico
- Parar em qualquer checkpoint para validar a story isoladamente
