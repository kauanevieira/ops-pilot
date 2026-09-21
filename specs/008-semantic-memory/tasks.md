# Tasks: Memória Semântica

**Input**: Design documents from `/specs/008-semantic-memory/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: incluídos — a spec pede explicitamente (FR-033 a FR-036). Escrever cada teste antes
da implementação correspondente e confirmar que falha.

**Organization**: Setup e Foundational, depois uma fase por história (US1 P1, US2 P2, US3 P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa

---

## Phase 1: Setup

- [x] T001 Adicionar `@huggingface/transformers@^4.3.0` a `dependencies` via `npm install`
      (atualiza `package.json` e `package-lock.json`) — R-001
- [x] T002 [P] Script `"memory:model"` em `package.json` apontando para
      `src/memory/download-model.ts` (arquivo criado em T034) — R-005

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos, canal de ferramentas por pedido, gerador de vetores e gerador falso — tudo
que as três histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Tipos e canais

- [x] T003 [P] `userIdSchema`, `memoryFactSchema`, `rememberResultSchema`,
      `recalledMemorySchema` e tipos inferidos em `src/domain/schemas.ts` (data-model.md)
- [x] T004 [P] `recalledMemories?: number` em `RunMetrics` — `src/trace/types.ts` (R-016)
- [x] T005 [P] `extraTools?: ClientTool[]` em `RunOptions` — `src/agents/types.ts` (R-011)
- [x] T006 `createReactStrategy` usa `[...createOpsTools(store), ...(options?.extraTools ?? [])]`
      — `src/agents/react.ts` (depende de T005)
- [x] T007 Idem em `createPlanAndExecuteStrategy` — `src/agents/plan-and-execute.ts`
      (depende de T005)

### Gerador de vetores

- [x] T008 [P] Testes do singleton com carga falsa via `createEmbedderFromLoader`: carga única
      com N chamadas concorrentes (E1); nada carregado antes do 1º `embed` (E2); falha não
      memorizada, 2ª chamada recarrega (E3) — `src/memory/embeddings.test.ts`
- [x] T009 Implementar `src/memory/embeddings.ts`: `Embedder`, constantes (`EMBEDDING_MODEL`,
      `EMBEDDING_DTYPE`, `EMBEDDING_DIM`, `MODEL_CACHE_DIR` resolvido de `import.meta.url`),
      `createEmbedderFromLoader`, `createLocalEmbedder({ allowRemote })` com
      `await import("@huggingface/transformers")` dentro da carga, `env.cacheDir`,
      `env.allowRemoteModels`, `pipeline("feature-extraction", …, { dtype: "q8" })`,
      `{ pooling: "mean", normalize: true }` (depende de T001, T008)
- [x] T010 [P] Gerador falso `createTableEmbedder(table)` e helper para construir vetores
      unitários de 384 posições com produto escalar exato — `src/memory/table-embedder.ts`
      (R-004)

**Checkpoint**: estratégias aceitam ferramentas extras; há gerador real e falso.

---

## Phase 3: User Story 1 - O agente lembra o que a pessoa contou (Priority: P1) 🎯 MVP

**Goal**: com `userId`, o agente guarda fatos e, em pedidos posteriores de qualquer conversa,
recebe os até 3 fatos mais próximos da mensagem.

**Independent Test**: guardar um fato para um usuário e verificar que um pedido de sentido
próximo, sem palavra em comum, o recebe — e que um pedido sem relação não.

### Tests for User Story 1 ⚠️

- [x] T011 [P] [US1] Testes do store com `createTableEmbedder` sobre `":memory:"`: guardar (M1
      caso novo); duplicata `> 0.92` não grava e devolve o existente (M1); exatamente `0.92`
      grava (M2); duplicata de outro usuário não conta (M3); recall ≤ 3 e ordenado (M4); corte
      `< 0.3` e `0.3` inclusivo (M5); desempate pelo mais recente (M6); usuário sem fatos ⇒ `[]`
      (M7); dedup concorrente grava um só (M11); `CHECK` rejeita vetor de tamanho errado (M13);
      reabertura em arquivo de `os.tmpdir()` sem perda (M12) — `src/memory/memory-store.test.ts`
- [x] T012 [P] [US1] Testes de `remember_fact`: descrição cobre as 6 regras (imperativo, quando
      usar, quando NÃO usar, retorno incluindo `created: false`); esquema sem campo de usuário;
      `fact` com `.describe()` e limite de 500; execução grava para o `userId` fechado —
      `src/memory/memory-tools.test.ts`
- [x] T013 [P] [US1] Testes de `withMemory` com estratégia falsa: fatos vazios ⇒ entrada
      intacta (FR-023); fatos presentes ⇒ bloco "Fatos lembrados" com `[memoryId]` antes da
      entrada; `extraTools` repassados somando aos já existentes; `metrics.recalledMemories`;
      sobrevive por fora de `withReflection`; composição com `withConversationHistory` produz
      fatos → histórico → mensagem — `src/memory/with-memory.test.ts`
- [x] T014 [US1] Testes de integração com `SqliteMemoryStore(":memory:", createTableEmbedder)`
      injetado: com `userId` e fato próximo, a estratégia falsa recebe o fato no texto e
      `remember_fact` entre `options.extraTools`, `recalledMemories` correto; fato sem relação
      não chega; fato guardado num pedido é recuperado em outra conversa e sem conversa —
      `src/http/server.test.ts`

### Implementation for User Story 1

- [x] T015 [US1] `src/memory/memory-store.ts`: `MemoryStore`, `DEDUP_THRESHOLD`,
      `RECALL_MIN_SCORE`, `RECALL_LIMIT`, `MEMORY_SCHEMA_SQL`, `SqliteMemoryStore` com
      `remember` (vetor primeiro, depois varredura + insert sem `await` — R-009) e `recall`
      (varredura, `>= 0.3`, ordenação, desempate por `rowid`, corte em 3 — R-008); conversão
      BLOB ⇄ `Float32Array` com cópia e validação de tamanho (R-007) (depende de T003, T009,
      T010, T011)
- [x] T016 [US1] `src/memory/memory-tools.ts`: `defineMemoryTools(memoryStore, userId)` com
      `remember_fact` (descrição de contracts/memory-tools.md) e adaptador
      `createMemoryTools` para LangChain (depende de T015, T012)
- [x] T017 [US1] `src/memory/with-memory.ts`: `formatMemoriesInput` (pura) e `withMemory`
      (depende de T004, T005, T013)
- [x] T018 [US1] `chatRequestSchema.userId = userIdSchema.optional()`;
      `CreateChatHandlerOptions.memoryStore` — `src/http/chat.ts` (depende de T003)
- [x] T019 [US1] No handler, com `userId`: `recall(userId, message)` dentro da Promise que
      disputa com o timeout, antes do `run`; composição
      `withConversationHistory(withMemory(strategy, { memories, tools }), history)` —
      `src/http/chat.ts` (depende de T016, T017, T018)
- [x] T020 [US1] `ChatAppDeps.memoryStore`, default
      `new SqliteMemoryStore(new DatabaseSync(":memory:"), createLocalEmbedder())` — preguiçoso,
      não carrega o modelo — `src/http/server.ts` (depende de T015)

**Checkpoint**: US1 funcional e testável sozinha (guardar + recuperar pelo chat).

---

## Phase 4: User Story 2 - Pedir para o agente esquecer (Priority: P2)

**Goal**: `forget_fact` apaga um fato do próprio usuário; o fato some de todo recall seguinte.

**Independent Test**: guardar, esquecer, verificar que o recall que o trazia não traz mais; e que
id de outro usuário ou já esquecido dá "não encontrado".

### Tests for User Story 2 ⚠️

- [x] T021 [P] [US2] Testes do store: `forget` do próprio fato ⇒ `true` e some do recall (M9);
      id inexistente, já esquecido ou de outro usuário ⇒ `false`, nada apagado (M10) —
      `src/memory/memory-store.test.ts`
- [x] T022 [P] [US2] Testes de `forget_fact`: descrição pelas 6 regras (inclui a origem do
      `memoryId` e o caso `forgotten: false`); esquema sem usuário; execução não apaga fato de
      outro usuário — `src/memory/memory-tools.test.ts`

### Implementation for User Story 2

- [x] T023 [US2] `forget` em `SqliteMemoryStore` com
      `DELETE … WHERE id = ? AND user_id = ?`, devolvendo `changes === 1` —
      `src/memory/memory-store.ts` (depende de T015, T021)
- [x] T024 [US2] `forget_fact` em `defineMemoryTools` e no adaptador —
      `src/memory/memory-tools.ts` (depende de T016, T022, T023)

**Checkpoint**: US1 + US2 funcionando juntas.

---

## Phase 5: User Story 3 - Memória só com usuário identificado (Priority: P3)

**Goal**: isolamento entre usuários; sem `userId`, nenhum efeito de memória; `userId` inválido
é 400.

**Independent Test**: pedidos com dois usuários e sem usuário — cada um vê só o seu, o sem
usuário não toca na memória.

### Tests for User Story 3 ⚠️

- [x] T025 [US3] Testes de integração: fato do usuário A não chega em pedido do usuário B; sem
      `userId`, a estratégia falsa recebe a mensagem crua, `extraTools` ausente/vazio,
      `metrics` sem `recalledMemories`, e um `MemoryStore` espião não é chamado; `userId` vazio
      ou só espaços ⇒ 400 `invalid_body` sem chamar a estratégia; `recall` que lança ⇒ 200 com
      `recalledMemories: 0` e erro registrado (FR-025) — `src/http/server.test.ts`

### Implementation for User Story 3

- [x] T026 [US3] Garantir no handler que sem `userId` não há chamada a `memoryStore` nem
      `withMemory`, e que falha de `recall` vira `console.error` + `memories = []` —
      `src/http/chat.ts` (ajuste sobre T019, depende de T025)

**Checkpoint**: as três histórias juntas; SC-004 e SC-006 verificados.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T027 [P] Teste com modelo real em `src/memory/embeddings.test.ts`:
      `createLocalEmbedder({ allowRemote: false })`; se a carga lançar ⇒
      `t.skip("modelo não está em cache — rode npm run memory:model")`; se carregar ⇒ norma 1 e
      384 posições (E5), e com `SqliteMemoryStore` real "Meu time de plantão é o de pagamentos"
      é recuperado por "quem cobre cobranças e faturamento?" e não por "como reinicio o banco
      de dados?" (FR-034)
- [x] T028 [P] Teste de que nenhum nome de ferramenta de memória está em `MCP_TOOL_NAMES`
      (FR-031) — `src/mcp/ops-mcp-server.test.ts`
- [x] T029 `src/index.ts`: `new SqliteMemoryStore(db, createLocalEmbedder())` sobre a mesma
      conexão, injetado em `createApp` (depende de T020)
- [x] T030 [P] Atualizar comentário de `buildCritiqueContext` em `src/agents/critic.ts`: o
      "pedido original" pode incluir fatos lembrados além do histórico
- [x] T031 [P] Aviso de emenda da 003 (`specs/003-chat-http-api/contracts/chat-endpoint.md`)
      passa a citar também `specs/008-semantic-memory/contracts/chat-endpoint.md`
- [x] T032 [P] README: campo `userId`, `recalledMemories`, `remember_fact`/`forget_fact`,
      `npm run memory:model`, custo em disco (+744 MB `node_modules`, 113 MB de modelo em
      `data/models/`), estrutura de `src/memory/`, link para `specs/008-semantic-memory/`
- [x] T033 [P] `.github/copilot-instructions.md`: linha de stack com a nova dependência e o
      comando `npm run memory:model`
- [x] T034 `src/memory/download-model.ts`: carrega o extrator com `allowRemote: true`, imprime
      o caminho do cache e sai (depende de T009, T002)
- [x] T035 Rodar `npm run typecheck` e `npm test` sem o modelo em cache (esperado: 1 skipped);
      rodar `npm run memory:model` e `npm test` de novo (esperado: 0 skipped)
- [x] T036 Roteiro de `specs/008-semantic-memory/quickstart.md`, passo 3 (arena/bench/MCP
      inalterados — verificado estruturalmente: nenhum dos três importa `src/memory/**` ou
      `extraTools`). **Passos 4 e 5 não executados**: exigem `OPENROUTER_API_KEY` real para
      chamar o modelo de linguagem, o que a constituição reserva para quem roda o projeto,
      não para o agente de codificação — pendente de validação manual.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T010)** → histórias.
- **US1** depende só da Foundational. Entrega o MVP.
- **US2** depende de T015/T016 (store e arquivo de ferramentas existirem); independente do
  endpoint.
- **US3** depende de T019 (handler com memória).
- **Polish** depois das histórias; T027, T028, T030–T033 são paralelos entre si.

### Within each story

Testes primeiro, falhando → store → ferramentas/decorador → handler.

## Parallel Example: Foundational

```bash
Task: "T003 schemas em src/domain/schemas.ts"
Task: "T004 RunMetrics.recalledMemories em src/trace/types.ts"
Task: "T005 RunOptions.extraTools em src/agents/types.ts"
Task: "T008 testes do singleton em src/memory/embeddings.test.ts"
Task: "T010 gerador falso em src/memory/table-embedder.ts"
```

## Implementation Strategy

1. Setup + Foundational.
2. US1 → validar pelo T014 (MVP: guardar e recuperar pelo chat).
3. US2 → esquecer.
4. US3 → isolamento e compatibilidade.
5. Polish, incluindo o teste com modelo real e o custo em disco no README.

## Notes

- Nenhum teste pode baixar o modelo: todo teste que não seja T027 injeta `createTableEmbedder`
  ou uma carga falsa; T027 usa `allowRemote: false`.
- `server.test.ts` sempre injeta `memoryStore` quando envia `userId` — o default de
  `createApp` usa o gerador real.
