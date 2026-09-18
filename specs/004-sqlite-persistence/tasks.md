---
description: "Task list for 004-sqlite-persistence"
---

# Tasks: Persistência real de operações

**Input**: Design documents from `/specs/004-sqlite-persistence/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **INCLUÍDOS e obrigatórios.** A spec os exige explicitamente (FR-038, FR-039,
FR-040) e a US4 inteira é sobre a suíte. O Princípio V da constituição os torna portão.

**Organization**: agrupadas por história de usuário. Cada fase de história é um incremento
completo e testável sozinho.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a história a que a tarefa pertence (US1–US4)
- Todo caminho de arquivo é explícito

## Path Conventions

Projeto único: `src/` na raiz, testes `*.test.ts` **ao lado do código** (convenção do
projeto, não `tests/`).

---

## ⚠️ Antes de começar

Três suposições da spec seguem sem confirmação. Nenhuma bloqueia, mas cada uma tem um custo
se mudar **depois** de implementada:

| Suposição | Onde | Custo se mudar depois |
|---|---|---|
| `tier` = `tier-1 \| tier-2 \| tier-3` e a atribuição do cenário (R-017) | T006, T009, T012, T017 | 4 arquivos |
| `summary` do incidente nasce sem produtor (R-018) | T007 | 1 arquivo, + esquema de `resolve_incident` se virar produtor |
| Nome `consultar_runbook` (R-020) | T035, T038, T044 | 3 arquivos |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar o terreno — o que precisa estar certo antes de qualquer código novo.

- [X] T001 [P] Adicionar `data/` ao `.gitignore` (FR-007), em linha própria após `dist`
- [X] T002 [P] Remover as dependências `sequelize` e `mysql2` de `package.json` (R-019 — verificado: nenhum arquivo de `src/` as importa), rodar `npm install` e confirmar que `package-lock.json` foi atualizado
- [X] T003 [P] Acrescentar `--disable-warning=ExperimentalWarning` aos scripts `dev`, `arena`, `seed` e `test` em `package.json` (R-002); **não** usar `--no-warnings`, que esconderia depreciações reais
- [X] T004 [P] Documentar `OPSPILOT_DB` em `.env.example` com o valor padrão `./data/opspilot.db` e um comentário de uma linha dizendo que `:memory:` é o valor usado nos testes
- [X] T005 Rodar `npm run typecheck && npm test` e confirmar **verde antes de qualquer mudança de código** — é a linha de base contra a qual toda quebra posterior será atribuída

**Checkpoint**: repositório limpo, linha de base verde, dependências proibidas fora.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: as mudanças de domínio e de cenário que **todas** as histórias precisam. Sem
elas nada compila.

**⚠️ CRITICAL**: nenhuma história pode começar antes desta fase fechar.

**⚠️ Ordem importa**: acrescentar `tier` ao `serviceSchema` quebra o `typecheck` de todo
lugar que constrói um `Service` literal. A sequência T006 → T009 → T012 evita um estado
intermediário com dezenas de erros de tipo (ver plan.md, ponto de atenção 4).

- [X] T006 Em `src/domain/schemas.ts`: criar `serviceTierSchema = z.enum(["tier-1","tier-2","tier-3"])` e acrescentar `tier: serviceTierSchema` a `serviceSchema` (FR-015). Enum, **não** número — Regra 6 do Princípio IV, e um inteiro convidaria a comparações de ordem que ninguém definiu
- [X] T007 Em `src/domain/schemas.ts`: acrescentar `summary: z.string().nullable()` a `incidentSchema` (FR-016). **`nullable`, não `optional`** — `null` é "não há resumo", um estado explícito; `undefined` seria ruído de serialização. Mesma escolha que `resolvedAt` já faz
- [X] T008 Em `src/domain/schemas.ts`: criar `runbookSchema = z.object({ serviceId: z.string().min(1), title: z.string().min(1), steps: z.array(z.string().min(1)).min(1) })` e exportar o tipo `Runbook` (FR-017). **Sem `id` próprio**: a relação é 1-para-1 com serviço, então `serviceId` é a chave
- [X] T009 Em `src/store/seed.json`: acrescentar `tier` aos 5 serviços — `checkout`, `payments` e `auth` = `"tier-1"`; `search` = `"tier-2"`; `notifications` = `"tier-3"` (R-017 ⚠️) — e acrescentar a coleção `runbooks` com 3 entradas, para `checkout`, `payments` e `auth` (FR-025), cada uma com `title` e `steps` ordenados
- [X] T010 Em `src/store/seed.ts`: estender `seedFileSchema` com `runbooks: z.array(runbookSchema)` e com o `tier` que `serviceSchema` agora exige; acrescentar `summary` ao `incidents` coercido do arquivo
- [X] T011 Em `src/store/types.ts`: acrescentar `readonly runbooks: readonly Runbook[]` a `WorldState` (R-014) — necessário para que `consultar_runbook` funcione igual nas duas implementações
- [X] T012 [P] Em `src/bench/scenarios.ts`: acrescentar `tier` a `CATALOG_SERVICE` e confirmar que `benchBaselineState()` propaga `runbooks` (o espalhamento `...base` já carrega o campo novo, mas conferir — um `WorldState` montado campo a campo passaria a faltar propriedade)
- [X] T013 [P] Em `src/domain/errors.ts`: criar `RunbookNotFoundError extends DomainError` com mensagem `Runbook not found for service: <id>` (FR-029a) — distinto de `ServiceNotFoundError`, porque são dois recados diferentes para quem está de plantão
- [X] T014 Rodar `npm run typecheck && npm test`: a suíte existente **deve continuar verde**. `src/store/state.test.ts` e os testes que montam `WorldState` são os primeiros a acusar campo faltando

**Checkpoint**: domínio e cenário base atualizados, projeto compila, suíte antiga verde.

---

## Phase 3: User Story 1 — O que aconteceu no plantão não se perde (P1) 🎯 MVP

**Goal**: o estado operacional sobrevive ao reinício do processo. Incidente aberto hoje
continua lá amanhã, com id e horário intactos.

**Independent Test**: abrir um incidente num processo, encerrar, subir outro processo sobre
o mesmo arquivo e ler o incidente de volta idêntico — [quickstart.md](./quickstart.md),
Validação 5.

### Tests for User Story 1 ⚠️

> Escrever **antes** da implementação e confirmar que falham.

- [X] T015 [P] [US1] Criar `src/store/sqlite-ops-store.test.ts` com o caso de **ida-e-volta de datas** (R-003 ⚠️): gravar um incidente, reler, comparar `openedAt.getTime()`. É o teste mais importante da feature — `node:sqlite` grava `new Date()` como `NULL` **sem lançar**, e sem este caso o bug passa despercebido
- [X] T016 [P] [US1] Em `src/store/sqlite-ops-store.test.ts`: casos de **seed idempotente** — semear 3× e afirmar 5 serviços / 6 alertas (3 `firing`, 3 `resolved`) / 3 runbooks, sem duplicatas (FR-026, SC-003); e afirmar que um incidente aberto antes do seed **sobrevive** a ele (FR-027)
- [X] T017 [P] [US1] Em `src/store/sqlite-ops-store.test.ts`: casos de **`CHECK` e chave estrangeira** — gravar direto pelo `DatabaseSync`, contornando a validação de aplicação, e esperar `ERR_SQLITE_ERROR` para `tier` fora de `('tier-1','tier-2','tier-3')`, `severity` fora de `('critical','high','medium','low')`, `status` de incidente fora de `('open','resolved')`, `status` de alerta fora de `('firing','resolved')`, e `FOREIGN KEY constraint failed` para `service_id` inexistente (FR-018, FR-019, SC-004)
- [X] T018 [P] [US1] Em `src/store/sqlite-ops-store.test.ts`: caso de **sincronia `CHECK` ↔ enum zod** (R-007) — extrair os valores de cada `CHECK` de `sqlite_master` e comparar, como conjunto, com `.options` do enum correspondente. É o que torna aceitável ter DDL literal em vez de gerado
- [X] T019 [P] [US1] Em `src/store/sqlite-ops-store.test.ts`: casos de **CRUD e erros de domínio** — abrir incidente; abrir com serviço inexistente ⇒ `ServiceNotFoundError` e **nada gravado**; resolver; resolver de novo ⇒ `IncidentAlreadyResolvedError` com o `resolvedAt` original **não sobrescrito**; resolver id inexistente ⇒ `IncidentNotFoundError` (FR-012, invariantes C4–C6)
- [X] T020 [P] [US1] Em `src/store/sqlite-ops-store.test.ts`: caso de **persistência entre aberturas** (FR-040) — gravar por uma conexão, fechar, abrir outra sobre o mesmo caminho e ler de volta. Único caso que usa arquivo: em `os.tmpdir()`, removido no fim, **nunca** na árvore do projeto (R-016)
- [X] T021 [P] [US1] Em `src/store/sqlite-ops-store.test.ts`: caso de **texto hostil** — título com aspas simples, ponto-e-vírgula e um `DROP TABLE` embutido, gravado e relido idêntico, com a tabela intacta depois (FR-022, SC-005)

### Implementation for User Story 1

- [X] T022 [US1] Criar `src/store/sqlite-schema.ts` com `SCHEMA_SQL` — o DDL **literal** das 4 tabelas e 2 índices, exatamente como em [contracts/database-schema.md](./contracts/database-schema.md): todo `CREATE` com `IF NOT EXISTS` (FR-005), `CHECK` em `tier`/`severity`/ambos os `status` (FR-018), `REFERENCES services(id)` em `alerts`/`incidents`/`runbooks` (FR-019), `NOT NULL` em toda data obrigatória (rede contra R-003), `resolved_at` e `summary` anuláveis em `incidents` (FR-016), `runbooks.service_id` como PK e `steps TEXT NOT NULL` em JSON. **Nenhuma parte gerada ou interpolada** (FR-021)
- [X] T023 [US1] Em `src/store/sqlite-schema.ts`: implementar `seedDatabase(db, state)` recebendo um `WorldState` **já validado** (não um caminho de arquivo — é o que o torna testável com cenário mínimo, R-005). Upsert `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` para serviços, alertas e runbooks; **nunca** tocar `incidents` (FR-027); tudo dentro de `BEGIN`/`COMMIT` (R-010). Upsert e **não** `INSERT OR IGNORE`, que não reaplicaria um `seed.json` corrigido a um banco já semeado (R-006)
- [X] T024 [US1] Criar `src/store/db.ts` com `openDatabase(path?)`: resolve argumento → `OPSPILOT_DB` → `./data/opspilot.db`, validado com `z.string().min(1)` (R-011, convenção de fronteira do projeto); se o caminho **não** for exatamente `":memory:"`, `mkdirSync(dirname, { recursive: true })` (FR-006); abrir `new DatabaseSync(path)`; executar `PRAGMA foreign_keys = ON` explicitamente (R-008); em falha, propagar com **caminho e causa** na mensagem (FR-008)
- [X] T025 [US1] Criar `src/store/sqlite-ops-store.ts` com `SqliteOpsStore implements OpsRepository`: construtor **recebe** a `DatabaseSync` (não a abre — é o que permite ao teste passar `:memory:` sem tocar em `OPSPILOT_DB`), aplica `SCHEMA_SQL` via `db.exec` (FR-004) e **prepara todos os statements uma vez** (R-012, Q2). Implementar `listAlerts`, `findService`, `openIncident`, `resolveIncident`, `getIncident` e `close()`
- [X] T026 [US1] Em `src/store/sqlite-ops-store.ts`: implementar a **conversão de borda** (R-003 ⚠️, §4 de data-model.md) — escrita `date.toISOString()` / `date?.toISOString() ?? null`, leitura `z.coerce.date()`; `steps` com `JSON.stringify`/`JSON.parse`. **Nenhum `Date` e nenhum `boolean` chega a um parâmetro ligado.** Toda linha lida é validada pelo esquema zod correspondente antes de virar objeto de domínio (FR-023)
- [X] T027 [US1] Em `src/store/sqlite-ops-store.ts`: `resolveIncident` usa `UPDATE incidents SET status='resolved', resolved_at=? WHERE id=? AND status='open'` e decide pelo `changes` — `1` ⇒ resolvido, `0` ⇒ `SELECT` de desambiguação entre `IncidentNotFoundError` e `IncidentAlreadyResolvedError` (R-009). Atômico por construção, e o `WHERE status='open'` é o que impede sobrescrever o `resolved_at` original. `openIncident` gera o id (`inc-<uuid>`) e lê o relógio **aqui**, nunca nas transições puras (C7, C8, Princípio I); devolve o registro **relido do banco**, não o objeto montado em memória (C9)
- [X] T028 [US1] Em `src/index.ts`: abrir o banco com `openDatabase()`, semear com `seedDatabase(db, baselineState())` e injetar `new SqliteOpsStore(db)` em `createApp({ store })` (FR-010). **`src/http/server.ts` NÃO muda de default** — correção sobre o plano original: verificado que apenas 1 dos ~15 casos de `server.test.ts` injeta `store`; trocar o default abriria `./data/opspilot.db` de verdade em cada um dos outros, violando FR-032. O default de `createApp()` permanece `InMemoryOpsRepository(baselineState())`; a injeção durável fica restrita a `src/index.ts`
- [X] T029 [US1] Em `src/scripts/seed.ts`: passar a semear o banco durável (`openDatabase()` + `seedDatabase`) em vez do estado in-memory, mantendo a mesma saída no console (5 serviços, 6 alertas com a contagem por status) e acrescentando a contagem de runbooks (FR-024)

**Checkpoint**: `npm run seed` cria `data/opspilot.db`; um incidente aberto sobrevive ao
reinício. **MVP entregue** — as Validações 1, 2, 3, 4 e 5 do quickstart passam.

---

## Phase 4: User Story 2 — Consultar incidentes e runbooks pela conversa (P2)

**Goal**: quem está de plantão pergunta "o que está aberto?" e "o que eu faço com o
checkout?" e recebe resposta.

**Independent Test**: pedir a lista de incidentes com cada filtro, e o runbook de um serviço
que tem e de outro que não tem — quickstart, Validação 6.

### Tests for User Story 2 ⚠️

- [X] T030 [P] [US2] Em `src/store/sqlite-ops-store.test.ts`: casos de `listIncidents` — sem argumento devolve **todos** (invariante C2: o default "em aberto" é da ferramenta, não do repositório), `"open"` só abertos, `"resolved"` só resolvidos, e **lista vazia quando não há nenhum, sem lançar** (FR-029b, C3). Afirmar também a ordem cronológica estável (C10)
- [X] T031 [P] [US2] Em `src/store/sqlite-ops-store.test.ts`: casos de `findRunbook` — serviço com runbook devolve título e `steps` **na ordem definida**; serviço existente sem runbook devolve `undefined`; `steps` com JSON inválido gravado à mão ⇒ erro de validação zod na leitura, não objeto meio-formado (FR-023)
- [X] T032 [P] [US2] Criar `src/agents/tools.test.ts` com os casos de `list_incidents` sobre `SqliteOpsStore(":memory:")` — os três filtros, o default `open` quando o campo é omitido (FR-028), e a lista vazia como resposta normal
- [X] T033 [P] [US2] Em `src/agents/tools.test.ts`: casos de `consultar_runbook` — serviço com runbook devolve os passos; serviço existente sem runbook devolve o erro de runbook ausente; serviço inexistente devolve o erro de serviço inexistente; **os dois últimos são distinguíveis** (FR-029a). Confirmar que ambos chegam como observação legível e **não abortam** a execução

### Implementation for User Story 2

- [X] T034 [US2] Em `src/store/repository.ts`: acrescentar `listIncidents(status?: IncidentStatus): Incident[]` a `IncidentRepository` e criar `RunbookRepository` com `findRunbook(serviceId: string): Runbook | undefined`, compondo-a em `OpsRepository` (FR-028, FR-029, R-004). Manter a interface **síncrona** — é a premissa que sustenta o plano inteiro
- [X] T035 [US2] Em `src/store/sqlite-ops-store.ts`: implementar `listIncidents` com **dois statements fixos** — um `SELECT ... ORDER BY opened_at` e um `SELECT ... WHERE status = ? ORDER BY opened_at` — escolhidos por `if`. **Nunca** um `WHERE` montado condicionalmente (R-013): é a forma mais inocente de SQL concatenado entrar num projeto. Implementar `findRunbook` por `selectRunbook` na PK
- [X] T036 [P] [US2] Em `src/store/in-memory.ts`: implementar `listIncidents` (filtro sobre `#state.incidents`) e `findRunbook` (busca em `#state.runbooks`), para que as duas implementações sejam intercambiáveis e o bench possa exercitar as ferramentas novas
- [X] T037 [US2] Em `src/agents/tools.ts`: criar a ferramenta `list_incidents` com `schema: z.object({ status: z.enum(["open","resolved","all"]).default("open") })` (FR-028) e a descrição escrita em [contracts/ops-tools.md](./contracts/ops-tools.md) §2, incluindo o `.describe()` do campo
- [X] T038 [US2] Em `src/agents/tools.ts`: criar a ferramenta `consultar_runbook` com `schema: z.object({ service: z.string().min(1) })` (FR-029) e a descrição de [contracts/ops-tools.md](./contracts/ops-tools.md) §3. Verificar o serviço **antes** do runbook, para distinguir `ServiceNotFoundError` de `RunbookNotFoundError` (FR-029a); traduzir ambos em observação, como as demais ferramentas já fazem
- [X] T039 [US2] Em `src/agents/tools.ts`: acrescentar as duas ferramentas novas ao array devolvido por `createOpsTools` — sem isso elas existem e o modelo nunca as vê
- [X] T040 [US2] Rodar `npm run typecheck && npm test`; confirmar que os testes das features 001–003 seguem verdes com a interface ampliada

**Checkpoint**: cinco ferramentas ativas; incidentes e runbooks consultáveis pela conversa.

---

## Phase 5: User Story 3 — O agente escolhe a ferramenta certa na primeira tentativa (P3)

**Goal**: com cinco ferramentas, nenhuma escolha errada por descrição ambígua — cada uma
paga em chamada de modelo e passo de rastro.

**Independent Test**: auditar as 6 descrições contra as 6 regras do Princípio IV e rodar o
pedido ambíguo "como está o plantão?" sem que nada seja escrito — quickstart, Validação 6.

### Tests for User Story 3 ⚠️

- [X] T041 [P] [US3] Em `src/agents/tools.test.ts`: teste de **cobertura de `.describe()`** — percorrer `createOpsTools(store)` e afirmar que **todo campo de todo esquema** tem descrição não vazia (FR-036). A Regra 5 é a única das seis verificável por máquina, e é justamente a que hoje falha em 100% dos casos — o que mostra que revisão por leitura não a pega
- [X] T042 [P] [US3] Em `src/agents/tools.test.ts`: teste de que **todo campo de conjunto fechado é `ZodEnum`** e não `ZodString` (FR-037), e que os valores aceitos aparecem literalmente no texto da descrição da ferramenta

### Implementation for User Story 3

- [X] T043 [US3] Em `src/agents/tools.ts`: reescrever a descrição de `list_alerts` conforme [contracts/ops-tools.md](./contracts/ops-tools.md) §1 — acrescentar a fronteira contra `list_incidents` (Regra 3: alerta é sinal automático, incidente é trabalho aberto por alguém), o que devolve **incluindo o caso vazio** (Regra 4), e o `.describe()` de `status` com o default explicitado
- [X] T044 [US3] Em `src/agents/tools.ts`: reescrever a descrição de `open_incident` conforme §4 — **esta é a dívida nomeada no pedido** (FR-035). Acrescentar quando NÃO usar: não usar para consultar (`list_incidents`), não usar para responder sobre estado (`list_alerts`), e a frase que faz o trabalho — "esta ferramenta escreve; um pedido por si só não é motivo para abrir, o pedido precisa dizer para abrir". `.describe()` nos três campos, com os valores de `severity` explicitados
- [X] T045 [US3] Em `src/agents/tools.ts`: reescrever a descrição de `resolve_incident` conforme §5 — hoje tem uma frase e nenhum gatilho. Acrescentar quando usar, o "não use sem o id: descubra com `list_incidents`, e não invente um", o que devolve, e o `.describe()` de `id` com o formato `inc-<uuid>`
- [X] T046 [US3] Percorrer o checklist de aceitação de [contracts/ops-tools.md](./contracts/ops-tools.md) marcando as 6 regras × 5 ferramentas; qualquer célula não marcada volta para T043–T045 (FR-034)
- [X] T047 [US3] Substituir `specs/001-reasoning-core/contracts/tools.md` como contrato vigente: acrescentar no topo dele um aviso de uma linha apontando para `specs/004-sqlite-persistence/contracts/ops-tools.md`, preservando o arquivo como registro histórico daquela entrega (Princípio III — contrato desatualizado é pior que contrato nenhum)

**Checkpoint**: as 5 ferramentas conformes; o pedido ambíguo não escreve nada.

---

## Phase 6: User Story 4 — Comparar estratégias sobre o mesmo cenário, sempre (P4)

**Goal**: preservar a reprodutibilidade que a durabilidade da US1 ameaça. Não é opcional: é
a capacidade que o projeto já tem e que esta feature poderia quebrar em silêncio.

**Independent Test**: rodar o bench duas vezes seguidas e obter a mesma verificação de
acerto por cenário; rodar a suíte e confirmar que nenhum arquivo de dados foi criado.

- [X] T048 [US4] Confirmar por inspeção que `src/arena.ts` e `src/bench.ts` **continuam** instanciando `InMemoryOpsRepository` (R-014, FR-030, FR-031) — é uma decisão explícita, não um esquecimento: persistir faria a segunda estratégia enxergar os incidentes abertos pela primeira, e `Scenario.check(initial, final)` opera sobre `WorldState`, que só o store in-memory expõe. Registrar a razão em comentário de uma linha em cada arquivo, para que a próxima pessoa não "corrija" isso
- [X] T049 [P] [US4] Em `src/bench/scenarios.test.ts`: acrescentar caso afirmando que `benchBaselineState()` devolve o mesmo estado inicial em duas chamadas consecutivas, incluindo `runbooks` (FR-030)
- [X] T050 [P] [US4] Varrer todos os `*.test.ts` e confirmar que **nenhum** abre um caminho de arquivo dentro da árvore do projeto; o único caso com arquivo é o de T020, em `os.tmpdir()`, com remoção no fim (FR-032, R-016)
- [X] T051 [US4] Rodar `npm test` e, em seguida, `git status --short` e `ls data/` — a suíte não pode ter criado nem alterado nada (FR-032, SC-009). Se `data/` apareceu, algum teste está abrindo arquivo em vez de `":memory:"`
- [ ] T052 [US4] Rodar `npm run bench` duas vezes e comparar a coluna de acerto de cada cenário entre as execuções (SC-008). Requer credencial; se indisponível, registrar como pendência de validação em vez de marcar a tarefa como feita

**Checkpoint**: arena e bench reprodutíveis; a suíte não deixa rastro em disco.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T053 [P] Em `README.md`: corrigir a afirmação "**Não há persistência em disco nem em banco**" na seção da API HTTP — deixou de ser verdade e é o texto que mais engana quem chega agora
- [X] T054 [P] Em `README.md`: documentar `OPSPILOT_DB` no Setup, atualizar o comentário de `npm run seed` (hoje diz "estado in-memory") e acrescentar `src/store/sqlite-ops-store.ts` à árvore da seção Estrutura, mencionando as 5 ferramentas em vez de 3
- [X] T055 [P] Em `.github/copilot-instructions.md`: trocar a linha de stack "Express com MySQL como banco (Sequelize + mysql2)" por SQLite via `node:sqlite`. **Não é divergência a justificar, é correção a executar**: pela regra de precedência da constituição, em conflito o documento subordinado é corrigido
- [X] T056 [P] Em `README.md`: acrescentar `specs/004-sqlite-persistence/` à lista de documentação de features no rodapé
- [X] T057 Remover o Sync Impact Report (comentário HTML no topo) de `.specify/memory/constitution.md` antes do commit definitivo — é material de revisão da emenda, não conteúdo de governança
- [X] T058 Executar o roteiro completo de [quickstart.md](./quickstart.md), Validações 1 a 5 (offline). Toda falha vira tarefa, não observação de rodapé
- [ ] T059 Executar as Validações 6 e 7 do quickstart (exigem `OPENROUTER_API_KEY`). A 6 é a que cobra a dívida do `open_incident`: se `open_incident` aparecer no rastro de "como está o plantão?", a Regra 3 não está fazendo efeito e T044 volta
- [X] T060 Portão final: `npm run typecheck && npm test` verdes, `git status --short` limpo de artefatos, e conferência de que os 43 FRs da spec têm tarefa correspondente concluída

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sem dependências
- **Foundational (Fase 2)**: depende da Fase 1 — **bloqueia todas as histórias**
- **US1 (Fase 3)**: depende da Fase 2. É o MVP
- **US2 (Fase 4)**: depende da Fase 2 e, na prática, da US1 — `listIncidents`/`findRunbook` são implementados na classe que a US1 cria
- **US3 (Fase 5)**: depende da US2 apenas porque duas das cinco ferramentas nascem lá. As descrições das **três existentes** (T043–T045) podem ser feitas logo após a Fase 2, em paralelo com a US1
- **US4 (Fase 6)**: depende da US1 (é ela que introduz o risco à reprodutibilidade)
- **Polish (Fase 7)**: depende das histórias desejadas

### Dentro de cada história

Testes escritos e **falhando** → esquema/DDL → store → ferramentas → composição.

### Ordem crítica dentro da Fase 2

`T006` (tier no esquema) → `T009` (seed.json) → `T012` (bench). Inverter produz um estado
intermediário com dezenas de erros de tipo.

### Parallel Opportunities

- **Fase 1**: T001–T004 são quatro arquivos distintos, todos em paralelo
- **Fase 2**: T006–T008 são o mesmo arquivo (`schemas.ts`) — **sequenciais**. T012 e T013 são arquivos distintos e paralelizáveis entre si
- **Fase 3**: T015–T021 são todos casos do mesmo arquivo de teste; paralelos como *redação*, mas convergem num arquivo só — combinar antes de commitar. A implementação T022 → T027 é sequencial (mesmo arquivo, dependência real)
- **Fase 4**: T030–T033 em paralelo (dois arquivos de teste); T036 é paralelo a T035 (arquivos distintos)
- **Fase 7**: T053–T056 são documentação em arquivos distintos, todos em paralelo

---

## Parallel Example: Phase 1

```bash
# Quatro arquivos distintos, nenhuma dependência entre eles:
T001  .gitignore          → data/
T002  package.json        → remover sequelize, mysql2
T003  package.json        → flag nos scripts   (mesmo arquivo que T002: agrupar)
T004  .env.example        → OPSPILOT_DB
```

> T002 e T003 tocam o mesmo arquivo — fazer numa passada só, apesar do `[P]`.

## Parallel Example: Phase 4 (tests)

```bash
T030  src/store/sqlite-ops-store.test.ts  → listIncidents, 3 filtros + vazio
T031  src/store/sqlite-ops-store.test.ts  → findRunbook, com e sem resultado
T032  src/agents/tools.test.ts            → list_incidents pela ferramenta
T033  src/agents/tools.test.ts            → consultar_runbook, 3 desfechos
```

---

## Implementation Strategy

### MVP First (US1)

1. Fase 1 (Setup) → 2. Fase 2 (Foundational) → 3. Fase 3 (US1)
4. **PARAR e VALIDAR**: Validações 1–5 do quickstart, todas offline
5. Nesse ponto a feature já entrega o que a justifica: o plantão não se perde

### Incremental Delivery

1. Setup + Foundational → base pronta
2. + US1 → durabilidade → **MVP**, validável sem credencial
3. + US2 → consultas novas pela conversa
4. + US3 → escolha de ferramenta confiável
5. + US4 → reprodutibilidade preservada
6. Fase 7 → documentação alinhada ao que o código faz

### Ordem recomendada se for uma pessoa só

Fases em sequência. A tentação de pular a US4 deve ser resistida: ela não acrescenta
capacidade, ela **protege** uma que já existe — e é o tipo de quebra que só aparece semanas
depois, num benchmark cujo resultado ninguém entende.

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- Confirmar que cada teste **falha** antes de implementar
- Commitar por tarefa ou grupo lógico
- ⚠️ **T015 é o teste que não pode ser adiado**: sem ele, o bug de data do R-003 passa por toda a suíte sem ser notado, e só aparece quando alguém reinicia o servidor e vê um incidente sem horário
- ⚠️ **Três suposições abertas** (R-017, R-018, R-020) — ver a tabela no topo

## Task count

| Fase | Tarefas | IDs |
|---|---|---|
| 1 — Setup | 5 | T001–T005 |
| 2 — Foundational | 9 | T006–T014 |
| 3 — US1 (P1) 🎯 | 15 | T015–T029 |
| 4 — US2 (P2) | 11 | T030–T040 |
| 5 — US3 (P3) | 7 | T041–T047 |
| 6 — US4 (P4) | 5 | T048–T052 |
| 7 — Polish | 8 | T053–T060 |
| **Total** | **60** | |
