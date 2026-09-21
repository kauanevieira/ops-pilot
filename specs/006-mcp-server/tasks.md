---
description: "Task list for 006-mcp-server"
---

# Tasks: Servidor MCP do OpsPilot

**Input**: Design documents from `/specs/006-mcp-server/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/mcp-server.md](./contracts/mcp-server.md)

**Tests**: **INCLUÍDOS e obrigatórios.** A spec os exige (FR-023 a FR-028), o pedido nomeia
o teste de listagem ("sobe o server e valida o list de tools"), e o Princípio V os torna
portão.

**Organization**: agrupadas por história de usuário. A US4 (fonte única) é P4 em valor, mas
é pré-requisito técnico das outras. Por isso a extração vira a **Fase 2 (Foundational)**, e
a US4 guarda para a sua fase apenas os testes que provam a invariante.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a história a que a tarefa pertence (US1–US4)
- Todo caminho de arquivo é explícito

## Path Conventions

Projeto único: `src/` na raiz, testes `*.test.ts` **ao lado do código**. O glob do
`npm test` (`src/**/*.test.ts`) já alcança `src/mcp/` sem mudança no script (R-011).

---

## ⚠️ Antes de começar

Três armadilhas verificadas na Fase 0. Cada uma deixa a suíte verde, ou o código
aparentemente correto, enquanto o comportamento está errado:

1. **`npm run mcp` sem `--silent`** (R-006). O npm escreve o cabeçalho do script no stdout
   e corrompe a sessão **sem nenhum `console.log` no código**. Os testes não pegam isso,
   porque spawnam `node --import tsx` direto (T009, T019). Quem pega é a documentação: T031 e
   T032 MUST usar `npm --prefix <repo> run --silent mcp`.
2. **Registrar as tools LangChain prontas** (R-002). Funciona para listar e executar, e
   todos os testes de listagem passam. Mas erro de domínio chega sem `isError`. T014 e T021
   existem para impedir esse atalho: o adaptador MCP consome `defineOpsTools`, nunca
   `createOpsTools`.
3. **`env` herdado no `StdioClientTransport`** (R-011). Sem `env` explícito, o filho herda
   só as variáveis "seguras" do SDK, e um `OPSPILOT_DB` do ambiente pode vazar para o
   teste. Passe sempre `{ PATH, OPSPILOT_DB: ":memory:" }`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: linha de base e a dependência nova.

- [ ] T001 Confirmar a linha de base: `npm run typecheck` e `npm test` verdes em `main` antes de qualquer mudança, anotando a contagem de testes para comparar em T007
- [ ] T002 Adicionar `@modelcontextprotocol/sdk@^1.30.0` às `dependencies` com `npm install @modelcontextprotocol/sdk@^1.30.0`, conferir que `npm ls zod` mostra uma única cópia `4.6.5` (R-001) e atualizar `package.json` e `package-lock.json`
- [ ] T003 Adicionar o script `"mcp": "tsx --disable-warning=ExperimentalWarning --env-file-if-exists=.env src/mcp/server.ts"` em `package.json` (R-006, FR-003, FR-006)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: extrair a fonte única de definições (R-002). Todas as histórias dependem dela.

**⚠️ CRITICAL**: nenhuma tarefa de US1–US4 começa antes do portão T007.

- [ ] T004 Criar `src/agents/tool-definitions.ts` com os tipos `ToolOutcome = { text: string; isError: boolean }` e `OpsToolDefinition<S extends z.ZodObject>` (`name`, `description`, `schema: S`, `run(args: z.infer<S>): Promise<ToolOutcome>`), conforme [data-model.md](./data-model.md)
- [ ] T005 Em `src/agents/tool-definitions.ts`, implementar `defineOpsTools(store: OpsRepository, deps: { fetchImpl?: typeof fetch } = {})`, que devolve as 6 definições indexadas pelo nome. **Mover** (não copiar) de `src/agents/tools.ts` as descrições, os esquemas e os corpos. `DomainError` vira `{ text: JSON.stringify({ error: message }), isError: true }`, e exceção não-domínio propaga. `check_provider_status` devolve sempre `isError: false`. Manter os comentários de rastreabilidade (FR-029a etc.) junto do código movido
- [ ] T006 Reescrever `src/agents/tools.ts` como adaptador LangChain: `createOpsTools(store, deps)` mantém assinatura e ordem de retorno, e constrói cada `tool(async (args) => (await def.run(args)).text, { name, description, schema })` a partir de `defineOpsTools`. Nenhum literal de descrição ou esquema pode restar em `tools.ts`. Se a inferência genérica do `tool()` brigar com o array heterogêneo, construir as 6 explicitamente pelo nome, em vez de usar `as any`
- [ ] T007 **Portão da extração**: `npm run typecheck` e `npm test` verdes **sem alterar nenhum arquivo de teste existente**, em especial `src/agents/tools.test.ts`, com a mesma contagem de testes de T001. `react.ts` e `plan-and-execute.ts` não podem ter sido tocados

**Checkpoint**: a fonte única existe, e o agente interno se comporta byte a byte como antes.

---

## Phase 3: User Story 1 - Um cliente MCP descobre as ferramentas do OpsPilot (Priority: P1) 🎯 MVP

**Goal**: o servidor `opspilot` sobe por stdio e anuncia exatamente as 4 ferramentas, com
descrição e esquema da definição interna.

**Independent Test**: subir o processo real, conectar um `Client` do SDK por
`StdioClientTransport` e verificar `serverInfo.name` e a lista exata de ferramentas.

### Tests for User Story 1 ⚠️

> Escrever primeiro e confirmar que falham (o módulo ainda não existe).

- [ ] T008 [P] [US1] Criar `src/mcp/ops-mcp-server.test.ts` (in-process: `InMemoryTransport.createLinkedPair()` + `Client` do SDK + `SqliteOpsStore(new DatabaseSync(":memory:"))` semeado com `seedDatabase(db, baselineState())`, um store novo por teste). Casos: (a) `getServerVersion()` tem `name === "opspilot"` e `version` igual ao do `package.json`; (b) `listTools()` devolve exatamente `["list_alerts", "list_incidents", "open_incident", "resolve_incident"]`, comparados como conjunto ordenado
- [ ] T009 [P] [US1] Criar `src/mcp/server.test.ts` com o **teste pedido**: spawnar `process.execPath` com `["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/mcp/server.ts"]`, `cwd` na raiz do repo, `env: { PATH: process.env.PATH, OPSPILOT_DB: ":memory:" }` e `stderr: "pipe"` via `StdioClientTransport`. Verificar `serverInfo.name === "opspilot"` e a lista exata das 4 ferramentas. Fechar o client em `after`/`finally`, mesmo em falha, para não deixar processo órfão (FR-027)

### Implementation for User Story 1

- [ ] T010 [US1] Criar `src/mcp/ops-mcp-server.ts`: exportar `MCP_TOOL_NAMES = ["list_alerts", "list_incidents", "open_incident", "resolve_incident"] as const` e `createOpsMcpServer(store: OpsRepository): McpServer`. Nome `opspilot`, versão via `import pkg from "../../package.json" with { type: "json" }`. Para cada nome da lista, buscar em `defineOpsTools(store)` e lançar erro se não existir (R-003). Registrar com `server.registerTool(def.name, { description: def.description, inputSchema: def.schema }, async (args) => { const o = await def.run(args); return { content: [{ type: "text", text: o.text }], isError: o.isError }; })`. Nenhum literal de descrição ou esquema neste arquivo
- [ ] T011 [US1] Criar `src/mcp/server.ts` (entrada, R-007): helper `diag(msg: string)` que escreve `[opspilot-mcp] <msg>\n` em `process.stderr`; `main()` async que abre com `openDatabase()`, cria `new SqliteOpsStore(db)`, roda `seedDatabase(db, baselineState())` nessa ordem (espelhando `src/index.ts`), chama `createOpsMcpServer(store).connect(new StdioServerTransport())` e depois `diag("pronto (stdio)")`. **Nenhum** `console.*` e nenhum `process.stdout` no arquivo
- [ ] T012 [US1] Rodar T008 e T009 até ficarem verdes; `npm run typecheck` verde

**Checkpoint**: MVP integrável. Um cliente MCP registra o OpsPilot e vê as 4 ferramentas.

---

## Phase 4: User Story 2 - Executar as ferramentas sobre o mesmo estado (Priority: P2)

**Goal**: as 4 ferramentas executam sobre o store, erro de domínio vem com `isError`, e
argumento inválido ou ferramenta desconhecida são recusados sem tocar o estado.

**Independent Test**: chamar cada ferramenta in-process e inspecionar o `SqliteOpsStore`
que o teste segura (Princípio V: estado, não texto).

### Tests for User Story 2 ⚠️

- [ ] T013 [US2] Em `src/mcp/ops-mcp-server.test.ts`, casos de execução com inspeção do store:
  - `list_alerts {}` devolve os alertas `firing` do seed, igual a `store.listAlerts("firing")`.
  - `list_incidents {}` devolve só os `open`.
  - `open_incident { title, service: "checkout", severity: "high" }`: `store.listIncidents("open")` passa a conter o incidente, e o texto é o JSON dele.
  - `resolve_incident { id }` sobre esse incidente: `store.getIncident(id)?.status === "resolved"` e `resolvedAt` não nulo.
- [ ] T014 [US2] Em `src/mcp/ops-mcp-server.test.ts`, casos de erro, todos com a sessão ainda utilizável no final (uma chamada `list_alerts` seguinte funciona):
  - `open_incident` com serviço inexistente: `isError: true`, texto `{"error": ...}`, contagem de incidentes inalterada.
  - `resolve_incident { id: "inc-nope" }`: `isError: true`.
  - `resolve_incident` num incidente já resolvido: `isError: true`, `resolvedAt` original preservado.
  - `open_incident` com `severity: "bogus"`: `isError: true`, texto contendo `critical`, contagem inalterada.
  - `open_incident` sem `title`: `isError: true`.
  - `consultar_runbook` e `check_provider_status`: `isError: true` com `not found`.
  - `list_alerts {}` com store vazio: `isError` falso e texto `[]` (vazio não é erro).
- [ ] T015 [US2] Em `src/mcp/ops-mcp-server.test.ts`, caso de paridade (FR-016): para os mesmos argumentos sobre dois stores semeados idênticos, `content[0].text` do MCP é igual ao retorno de `createOpsTools(store).find(t => t.name === ...).invoke(args)`, para `list_alerts` e `list_incidents`. Não vale para `open_incident`, porque id e horário variam

### Implementation for User Story 2

- [ ] T016 [US2] Em `src/mcp/ops-mcp-server.ts`, envolver a chamada a `def.run` num `try/catch` que, para exceção **não-domínio**, chama um callback `onTechnicalError?(toolName, error)` recebido em `createOpsMcpServer(store, { onTechnicalError })` e **relança**, para o SDK converter em `isError` (R-004, FR-014). Em `src/mcp/server.ts`, passar `onTechnicalError` usando `diag`
- [ ] T017 [US2] Teste de falha técnica em `src/mcp/ops-mcp-server.test.ts`: um `OpsRepository` dublê cujo `listAlerts` lança `new Error("boom")`. Esperar `isError: true` com `boom`, `onTechnicalError` chamado uma vez com `list_alerts`, e a sessão continuando
- [ ] T018 [US2] Rodar a suíte; T013–T017 verdes

**Checkpoint**: US1 e US2 funcionam; o cliente MCP lê e escreve incidentes reais.

---

## Phase 5: User Story 3 - O canal do protocolo nunca é corrompido (Priority: P3)

**Goal**: stdout só com protocolo durante toda a vida do processo; diagnóstico e falhas de
configuração no stderr; encerramento limpo.

**Independent Test**: capturar o stdout bruto do processo real numa sessão completa e numa
falha de configuração.

### Tests for User Story 3 ⚠️

- [ ] T019 [P] [US3] Em `src/mcp/server.test.ts`, teste de stdout bruto (SC-004): `spawn` direto (sem SDK), mesmo comando e `env` de T009. Escrever no stdin, uma por linha:
  - `initialize`;
  - `notifications/initialized`;
  - `tools/list`;
  - `tools/call list_alerts {}`;
  - `tools/call resolve_incident {"id":"inc-nope"}`.

  Aguardar as 4 respostas com `id`, fechar o stdin e aguardar `exit`. Verificar:
  - toda linha não vazia do stdout faz `JSON.parse` e tem `jsonrpc === "2.0"`;
  - o código de saída é 0;
  - o stderr contém `pronto`.

  Usar timeout do teste (ex.: 10 s) e `kill()` no `finally`.
- [ ] T020 [P] [US3] Em `src/mcp/server.test.ts`, teste de falha de configuração (FR-021): spawn com `OPSPILOT_DB: ""` e stdin fechado. Esperar código de saída 1, stdout com **0 bytes** e stderr contendo `OPSPILOT_DB inválida`
- [ ] T021 [P] [US3] Em `src/mcp/server.test.ts`, varredura estática (FR-018, SC-005): ler todo `src/mcp/*.ts` que não termine em `.test.ts` e afirmar que nenhum casa com `/console\.(log|info|debug)\b|process\.stdout/`. Afirmar também que `ops-mcp-server.ts` importa de `../agents/tool-definitions.ts` e **não** de `../agents/tools.ts` (armadilha 2)

### Implementation for User Story 3

- [ ] T022 [US3] Em `src/mcp/server.ts`, guarda de runtime (R-005): a primeira instrução de `main()` redireciona `console.log`, `console.info` e `console.debug` para escrever no stderr, com um comentário explicando que o stdout é o canal do protocolo. Usar atribuição a partir de `console.error`, sem mencionar `process.stdout`, para não quebrar T021
- [ ] T023 [US3] Em `src/mcp/server.ts`, tratar falha de inicialização (R-009): `main().catch((error) => { diag(error instanceof Error ? error.message : String(error)); process.exit(1); })`
- [ ] T024 [US3] Em `src/mcp/server.ts`, encerramento limpo (R-008, FR-022): função `shutdown(reason)` idempotente (flag) que chama `await server.close()`, `store.close()`, `diag(\`encerrado (${reason})\`)` e `process.exit(0)`. Registrar em `process.stdin.once("end", ...)`, `process.once("SIGINT", ...)` e `process.once("SIGTERM", ...)`
- [ ] T025 [US3] Rodar T019–T021 até ficarem verdes

**Checkpoint**: nenhuma forma conhecida de escrever texto solto no stdout.

---

## Phase 6: User Story 4 - Uma única fonte de contrato (Priority: P4)

**Goal**: provar por teste que o contrato anunciado no MCP é o da definição interna, sem cópia.

**Independent Test**: comparar descrição e `inputSchema` anunciados com os da definição.

- [ ] T026 [US4] Em `src/mcp/ops-mcp-server.test.ts`, teste de igualdade (FR-025, SC-003): para cada ferramenta de `listTools()`, `tool.description === defs[tool.name].description` e `assert.deepStrictEqual(tool.inputSchema, z.toJSONSchema(defs[tool.name].schema, { target: "draft-7", io: "input" }))`, com `defs = defineOpsTools(store)`. Oráculo verificado em R-001
- [ ] T027 [US4] Em `src/mcp/ops-mcp-server.test.ts`, teste de propagação (FR-011): a descrição e o schema anunciados para `list_alerts` são os mesmos que `createOpsTools(store)` expõe ao agente interno (`description` e `z.toJSONSchema(tool.schema, ...)`). Isso fecha o triângulo: definição = LangChain = MCP
- [ ] T028 [US4] Conferir por inspeção que `src/mcp/ops-mcp-server.ts` e `src/agents/tools.ts` não contêm nenhum literal de descrição (`grep -n "Use quando" src/mcp src/agents/tools.ts` sem resultado) e que `src/agents/tool-definitions.ts` é o único arquivo com esses literais

**Checkpoint**: todas as histórias entregues e verificadas.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Atualizar o comentário de cabeçalho de `src/agents/tools.ts` para apontar a fonte única (`tool-definitions.ts`) e os dois adaptadores, e mover para `tool-definitions.ts` o texto sobre as 6 regras e `deps.fetchImpl`
- [ ] T030 [P] Atualizar `README.md` na seção "Estrutura": incluir `src/mcp/` e `src/agents/tool-definitions.ts`
- [ ] T031 [P] Adicionar ao `README.md` a seção "Servidor MCP":
  - o que é e as 4 ferramentas;
  - registro com `claude mcp add opspilot -- npm --prefix "$PWD" run --silent mcp`;
  - o bloco JSON genérico de [contracts/mcp-server.md](./contracts/mcp-server.md);
  - aviso em destaque de que `--silent` é obrigatório e por quê (R-006);
  - `OPSPILOT_DB` compartilhado com a API HTTP.
- [ ] T032 Conferir [contracts/mcp-server.md](./contracts/mcp-server.md) contra o comportamento real: textos de erro do SDK, `capabilities` anunciadas, versão. Corrigir o contrato se divergir (Princípio III)
- [ ] T033 Rodar o [quickstart.md](./quickstart.md), passos 1 a 3 (portões, stdout limpo manual com e sem `--silent`, falha de configuração), e registrar o resultado
- [ ] T034 Portão final: `npm run typecheck` e `npm test` verdes, sem rede e sem `.env`, com a suíte inteira abaixo de 30 s (SC-009)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T002 → T003 (mesmo `package.json`).
- **Foundational (Phase 2)**: depende de T001. T004 → T005 → T006 → T007 (sequencial, mesmos arquivos). **Bloqueia todas as histórias.**
- **US1 (Phase 3)**: depende de T002, T003 e T007.
- **US2 (Phase 4)**: depende de US1 (usa `ops-mcp-server.ts` e o arquivo de teste de T008).
- **US3 (Phase 5)**: depende de US1 (usa `server.ts` e o arquivo de teste de T009). Pode correr **em paralelo com US2**, porque os arquivos de teste são diferentes. T016 e T024 tocam `server.ts` em trechos distintos; serializar se houver conflito.
- **US4 (Phase 6)**: depende de US1. Pode correr em paralelo com US3.
- **Polish (Phase 7)**: depois das histórias desejadas.

### Within Each User Story

- Testes escritos primeiro, e falhando, antes da implementação.
- `ops-mcp-server.ts` (fábrica) antes de `server.ts` (entrada).
- Cada checkpoint fecha com a suíte inteira verde.

### Parallel Opportunities

- T008 ∥ T009 (arquivos de teste diferentes).
- Depois de US1: fase US2 (`ops-mcp-server.test.ts`) ∥ fase US3 (`server.test.ts`).
- T019 ∥ T020 ∥ T021 como redação; como estão no mesmo arquivo, fazer merge com cuidado.
- T029 ∥ T030 ∥ T031 (T030 e T031 no mesmo `README.md`, mas em seções diferentes).

---

## Parallel Example: User Story 1

```bash
# Os dois testes da US1 juntos (arquivos diferentes):
Task: "T008 in-process: nome opspilot + lista exata em src/mcp/ops-mcp-server.test.ts"
Task: "T009 processo real via StdioClientTransport em src/mcp/server.test.ts"
```

## Parallel Example: após o MVP

```bash
Task: "Fase US2 — execução, estado e isError em src/mcp/ops-mcp-server.test.ts"
Task: "Fase US3 — stdout bruto, falha de config e varredura em src/mcp/server.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) → Phase 2 (extração + portão T007).
2. Phase 3 (US1) → **PARAR e VALIDAR**: `npm test` verde e quickstart passo 2 (stdout
   limpo manual). O servidor já é registrável num cliente MCP.

### Incremental Delivery

1. Setup + Foundational → agente interno inalterado, fonte única pronta.
2. \+ US1 → descoberta (MVP, integrável pela constituição: P1 completa).
3. \+ US2 → execução sobre o estado real.
4. \+ US3 → garantias do canal e do ciclo de vida.
5. \+ US4 → invariante da fonte única travada por teste.
6. Polish → README, contrato conferido, quickstart.

---

## Notes

- Total: **34 tarefas**. Setup 3 · Foundational 4 · US1 5 · US2 6 · US3 7 · US4 3 · Polish 6.
- Os testes nunca usam rede, credencial ou arquivo de banco: só `":memory:"` (Princípios II e V).
- Commit por checkpoint. Os commits ficam a critério de quem implementa: esta lista não os cria.
- Evitar `as any` para calar o genérico do `registerTool`/`tool()`. Se for inevitável, isolar num único ponto comentado do adaptador.
