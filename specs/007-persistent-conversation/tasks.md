# Tasks: Conversa Persistente

**Input**: Design documents from `/specs/007-persistent-conversation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: incluídos — a spec pede testes explicitamente (FR-024 a FR-027).

**Organization**: por história de usuário (US1 P1, US2 P2, US3 P3), com uma fase
fundacional antes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos incluídos em cada tarefa

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: tipos de domínio, erro e contrato de armazenamento que toda história usa.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [x] T001 Adicionar `messageRoleSchema`, `conversationMessageSchema` e
      `newConversationMessageSchema` em `src/domain/schemas.ts` (data-model.md)
- [x] T002 [P] Adicionar `ConversationNotFoundError` em `src/domain/errors.ts`
- [x] T003 [P] Adicionar `historyMessages?: number` em `RunMetrics`
      (`src/trace/types.ts`)
- [x] T004 Criar interface `ConversationStore` em `src/store/conversation-store.ts`
      (contracts/conversation-store.md)
- [x] T005 Criar bateria de contrato compartilhada `runConversationStoreContract` em
      `src/store/conversation-store.contract.ts` (CV1–CV6, CV9, CV10; NÃO termina em
      `.test.ts`)

**Checkpoint**: tipos e contrato prontos; os stores concretos podem começar.

---

## Phase 2: User Story 1 - Continuar uma conversa com o OpsPilot (Priority: P1) 🎯 MVP

**Goal**: `/chat` aceita `conversationId` opcional, devolve o id sempre, e um segundo
pedido na mesma conversa recebe o histórico do primeiro.

**Independent Test**: pedido sem conversa → devolve id; pedido seguinte com esse id →
estratégia recebe o histórico do turno anterior.

### Tests for User Story 1 ⚠️

- [x] T006 [P] [US1] `InMemoryConversationStore` passa em
      `runConversationStoreContract` — `src/store/in-memory-conversation-store.test.ts`
- [x] T007 [P] [US1] `SqliteConversationStore` passa em
      `runConversationStoreContract` sobre `new DatabaseSync(":memory:")` —
      `src/store/sqlite-conversation-store.test.ts`
- [x] T008 [US1] Testes de `formatHistoryInput` e `withConversationHistory` com
      estratégia falsa (histórico vazio ⇒ entrada intacta; histórico presente ⇒ prefixo
      com rótulos `[plantonista]`/`[OpsPilot]`; `metrics.historyMessages` preenchido) —
      `src/agents/conversation-history.test.ts`
- [x] T009 [US1] Testes de integração do endpoint: sem `conversationId` cria e devolve
      id; com `conversationId` de um turno anterior, a estratégia falsa recebe o
      histórico; duas conversas não vazam histórico entre si —
      `src/http/server.test.ts` (casos novos, fake registry existente)

### Implementation for User Story 1

- [x] T010 [US1] Implementar `InMemoryConversationStore`
      (`src/store/in-memory-conversation-store.ts`): `create`/`append`/`lastMessages`
      síncronos, ids por contador, lança `ConversationNotFoundError` (depende de T001,
      T002, T004)
- [x] T011 [US1] Adicionar `CONVERSATION_SCHEMA_SQL` em `src/store/sqlite-schema.ts`
      (contracts/database-schema.md) (depende de T004)
- [x] T012 [US1] Implementar `SqliteConversationStore`
      (`src/store/sqlite-conversation-store.ts`): aplica o DDL no construtor, prepara os
      4 statements, `append` em transação `BEGIN`/`COMMIT`/`ROLLBACK`, `lastMessages` com
      a subconsulta `ORDER BY id DESC LIMIT ? / ORDER BY id` (depende de T011)
- [x] T013 [US1] Implementar `HISTORY_WINDOW`, `formatHistoryInput` (pura) e
      `withConversationHistory` em `src/agents/conversation-history.ts` (depende de T003)
- [x] T014 [US1] `chatRequestSchema` ganha `conversationId` opcional; `ChatResponse`
      inclui `conversationId`; `CreateChatHandlerOptions` ganha `conversationStore` —
      `src/http/chat.ts`
- [x] T015 [US1] No handler: resolver histórico (`conversationId` presente ⇒
      `lastMessages`; ausente ⇒ `[]`), compor
      `withConversationHistory(strategy, history)` por fora da estratégia resolvida,
      gravar o turno (`create` se necessário + `append([user, assistant])`) só no ramo de
      sucesso do `Promise.race`, devolver `conversationId` na resposta — `src/http/chat.ts`
      (depende de T012, T013, T014)
- [x] T016 [US1] `ChatAppDeps.conversationStore` (default
      `new InMemoryConversationStore()`) e repasse ao handler — `src/http/server.ts`
      (depende de T010, T014)

**Checkpoint**: US1 completa e testável isoladamente.

---

## Phase 3: User Story 2 - Histórico limitado e visível nas métricas (Priority: P2)

**Goal**: histórico nunca passa de 12 mensagens; `metrics.historyMessages` sempre
presente e correto.

**Independent Test**: conversa com >12 mensagens armazenadas → estratégia recebe
exatamente as 12 mais recentes, em ordem; métrica reporta 12.

### Tests for User Story 2 ⚠️

- [x] T017 [P] [US2] Teste de `lastMessages` com mais de `HISTORY_WINDOW` mensagens
      devolvendo só as mais recentes, em ordem cronológica — acrescentar caso em
      `conversation-store.contract.ts` (roda para os dois stores via T006/T007)
- [x] T018 [US2] Teste de integração: conversa com 13+ mensagens gravadas via fixture,
      pedido novo ⇒ estratégia falsa recebe 12, `metrics.historyMessages === 12`;
      conversa nova ⇒ `historyMessages === 0` — `src/http/server.test.ts`

### Implementation for User Story 2

- [x] T019 [US2] Confirmar que o handler usa `HISTORY_WINDOW` (não um literal) ao chamar
      `lastMessages` — ajuste em `src/http/chat.ts` se T015 tiver usado literal (depende
      de T013, T015)

**Checkpoint**: US1 + US2 funcionando juntas.

---

## Phase 4: User Story 3 - Erros claros sobre a conversa (Priority: P3)

**Goal**: `conversationId` vazio/mal formado ⇒ 400; inexistente ⇒ 404; pedido que falha
não grava nada.

**Independent Test**: enviar id vazio, id inexistente, e um pedido que estoura o
timeout numa conversa existente; verificar cada erro e que a conversa não mudou.

### Tests for User Story 3 ⚠️

- [x] T020 [P] [US3] `ChatErrorCode` ganha `"conversation_not_found"`; teste de
      `toErrorBody` cobrindo o novo código — `src/http/errors.test.ts`
- [x] T021 [US3] Testes de integração: `conversationId` vazio/espaços ⇒ 400
      `invalid_body`; `conversationId` inexistente ⇒ 404 `conversation_not_found` sem
      chamar a estratégia; timeout numa conversa existente ⇒ 504 e a conversa
      permanece sem novas mensagens (consultar via `conversationStore.lastMessages`
      injetado no teste) — `src/http/server.test.ts`

### Implementation for User Story 3

- [x] T022 [US3] Adicionar `"conversation_not_found"` a `ChatErrorCode` —
      `src/http/errors.ts` (depende de T014)
- [x] T023 [US3] No handler: após resolver a estratégia, se `conversationId` foi
      informado, chamar `lastMessages` e capturar `ConversationNotFoundError` ⇒ 404 com
      `details: { conversationId }`, antes de iniciar a execução — `src/http/chat.ts`
      (depende de T015, T022)

**Checkpoint**: as três histórias funcionam juntas; SC-004 satisfeito.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T024 [P] Caso de reabertura de arquivo (`os.tmpdir()`) para
      `SqliteConversationStore`, e teste de sincronia CHECK↔enum para `messages.role` —
      `src/store/sqlite-conversation-store.test.ts`
- [x] T025 [P] Atualizar comentário de `buildCritiqueContext` em `src/agents/critic.ts`
      (R-008: `input` pode incluir histórico)
- [x] T026 `src/index.ts`: instanciar `SqliteConversationStore` sobre a mesma conexão do
      `SqliteOpsStore` e injetar em `createApp` (depende de T012, T016)
- [x] T027 [P] Aviso de emenda no topo de
      `specs/003-chat-http-api/contracts/chat-endpoint.md` apontando para
      `specs/007-persistent-conversation/contracts/chat-endpoint.md`
- [x] T028 [P] Atualizar README (seção da API: `conversationId`, `historyMessages`)
- [x] T029 Rodar `npm run typecheck`, `npm test` e o roteiro de
      `specs/007-persistent-conversation/quickstart.md`
- [ ] T030 Confirmar `npm run arena` e `npm run bench` com saída inalterada (SC-007) —
      **não executado**: requer credencial de modelo (`OPENROUTER_API_KEY`), indisponível
      neste ambiente. Verificado estruturalmente: nem `arena.ts` nem `bench.ts` importam
      `conversation-history.ts` ou qualquer `ConversationStore`, e
      `formatHistoryInput([], input) === input` byte a byte. Pendente de confirmação
      manual com credencial (roteiro em quickstart.md, passo 2).

---

## Dependencies & Execution Order

- **Phase 1** bloqueia todas as histórias.
- **US1 (Phase 2)** depende só da Phase 1; entrega o MVP.
- **US2 (Phase 3)** depende de US1 estar implementada (usa o mesmo handler e o mesmo
  decorador); adiciona só verificação de teto e métrica.
- **US3 (Phase 4)** depende de US1 (usa o mesmo handler); independente de US2.
- **Phase 5** depende de US1–US3 completas.

## Parallel Example: Foundational

```bash
Task: "T002 ConversationNotFoundError em src/domain/errors.ts"
Task: "T003 historyMessages? em RunMetrics em src/trace/types.ts"
```

## Implementation Strategy

MVP = Phase 1 + Phase 2 (US1). US2 e US3 adicionam sobre o mesmo endpoint sem quebrar
US1. Escrever cada teste listado antes da implementação correspondente e confirmar que
falha antes de implementar.
