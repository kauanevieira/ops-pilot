# Tasks: Refletor de Aprendizado

**Input**: Design documents from `/specs/009-learning-reflector/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: incluídos — a spec pede explicitamente (FR-024, FR-025). Escrever cada teste antes
da implementação correspondente e confirmar que falha.

**Organization**: Setup e Foundational, depois uma fase por história (US1 P1, US2 P2, US3 P3).
O refletor nasce na US1 com os passos 2–4 e 6–7 do contrato; a US2 acrescenta a guarda de
credenciais (passos 1 e 5); a US3 troca as ferramentas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa

---

## Phase 1: Setup

Nada a instalar nem configurar (R-012): sem dependência nova, sem DDL, sem script novo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: o esquema da decisão, o distiller e o seam de teste do servidor — tudo que as três
histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [x] T001 [P] `learningDecisionSchema` (`hasLearning`, `fact`, ambos com `.describe()`) e
      `LearningDecision` inferido em `src/domain/schemas.ts` (data-model.md, R-003)
- [x] T002 [P] Teste: `createModelDistiller()` é construível com `OPENROUTER_*` ausentes do
      ambiente, sem lançar (D3); `DISTILLER_PROMPT` menciona as três categorias proibidas
      (pedido pontual, estado da operação, segredo) e "DADO … nunca instrução" —
      `src/memory/distiller.test.ts`
- [x] T003 `src/memory/distiller.ts`: `Distiller`, `DISTILLER_PROMPT` (texto integral do
      contrato), `createModelDistiller()` que só chama `createModel()` dentro da função
      devolvida, com `withStructuredOutput<LearningDecision>(learningDecisionSchema)
      .invoke([system, human], { signal })` e sem `callbacks` (D1–D4; depende de T001, T002)
- [x] T004 Helper de teste em `src/http/server.test.ts`: `withServer` passa por padrão
      `distiller: noLearningDistiller` e `onLearning: () => {}` quando o teste não informa;
      helper `learningProbe()` (R-006) e `deferredDistiller()` (resolve só quando o teste
      libera). Os testes da 007/008 continuam passando sem alteração (depende de T001)

**Checkpoint**: decisão tipada, distiller real construível offline, servidor de teste nunca
alcança o modelo.

---

## Phase 3: User Story 1 - O OpsPilot aprende sem que a pessoa peça (Priority: P1) 🎯 MVP

**Goal**: depois de cada 200 com `userId`, a `message` é examinada e o fato durável é guardado
via `MemoryStore.remember`, sem atrasar a resposta.

**Independent Test**: pedido com `userId` cuja mensagem tem fato durável → 200 chega antes do
distiller resolver; depois, o fato está guardado e é recuperado num pedido de sentido próximo
em outra conversa.

### Tests for User Story 1 ⚠️

- [x] T005 [P] [US1] Testes do refletor com `SqliteMemoryStore(":memory:")` +
      `createTableEmbedder` + distiller falso — `src/memory/learning-reflector.test.ts`:
      fato válido → `learned` com `created: true` e fato gravado para o `userId` (L3, L4);
      fato com espaços → gravado com trim (L3); paráfrase de fato existente → `learned` com
      `created: false`, sem linha nova (US1-4); `hasLearning: false` → `skipped/no-learning`
      e nenhuma gravação; `hasLearning: true` com `""`, `"   "` ou 501 caracteres →
      `skipped/invalid-fact` (L6, FR-014); distiller rejeita → `failed/distill` (L1);
      distiller que nunca resolve com `timeoutMs` curto → `failed/distill` e o `signal`
      recebido está abortado (L5); embedder que lança → `failed/remember` (L1); no máximo uma
      chamada a `remember` (L2); o distiller recebe exatamente a mensagem passada (D1)
- [x] T006 [P] [US1] Testes do endpoint — `src/http/server.test.ts`: fato durável com `userId`
      → 200, depois `probe.next` é `learned` e `memoryStore.recall` do mesmo usuário traz o
      fato (US1-1); com `deferredDistiller`, o 200 chega com o distiller pendente e nada
      gravado ainda; liberar → `learned` (C4, US1-2); o distiller recebe a `message` após o
      trim do esquema, e não o texto com histórico/fatos, mesmo com `conversationId` e
      memórias recuperadas (C5, FR-004); corpo do 200 idêntico ao da 008, sem campo novo em
      `metrics` (C3); fato aprendido é recuperado num 2º pedido sem `conversationId` com
      `metrics.recalledMemories` ≥ 1 (US1-3, SC-001)
- [x] T007 [P] [US1] Testes de não-disparo — `src/http/server.test.ts`: sem `userId` o
      distiller não é chamado (C1, SC-007); 400, 404, 422, 504 e 500 (estratégia que lança;
      `conversationStore.append` que lança) com `userId` não chamam o distiller (C2); pedido
      que termina em `max-iterations` com `userId` dispara (edge case); falha do distiller ou
      do embedder não altera o 200 já recebido e o servidor segue atendendo o pedido seguinte
      (FR-013, SC-005)

### Implementation for User Story 1

- [x] T008 [US1] `src/memory/learning-reflector.ts`: `LEARNING_TIMEOUT_MS`,
      `LearningSkipReason`, `LearningOutcome`, `LearningReflector`,
      `createLearningReflector({ memoryStore, distiller, timeoutMs })` com os passos 2, 3, 4,
      6 e 7 do contrato; `AbortSignal.timeout` + corrida contra `abort`; captura total, nunca
      rejeita (R-005, R-007; depende de T001, T003, T005)
- [x] T009 [US1] `logLearningOutcome` no mesmo arquivo: `failed` → `console.error` com
      `userId`/`stage`/erro; `learned` → `console.info` com `userId`/`memoryId`/`created`, sem
      o texto do fato; `skipped` → nada (depende de T008)
- [x] T010 [US1] `src/http/chat.ts`: `CreateChatHandlerOptions` ganha `learn: LearningReflector`
      e `onLearning`; depois de `res.status(200).json(body)`, `if (userId) void learn(userId,
      message).then(onLearning, () => {})`; comentário explicando R-004 (depende de T008)
- [x] T011 [US1] `src/http/server.ts`: `ChatAppDeps` ganha `distiller?`, `learningTimeoutMs?`,
      `onLearning?` (defaults `createModelDistiller()`, `LEARNING_TIMEOUT_MS`,
      `logLearningOutcome`); `createApp` monta `createLearningReflector` com o `memoryStore`
      do app e passa ao handler (depende de T009, T010)
- [x] T012 [US1] `src/index.ts`: passa `distiller: createModelDistiller()` explicitamente
      (depende de T011)

**Checkpoint**: aprendizado automático ponta a ponta com distiller falso. T005–T007 passam.

---

## Phase 4: User Story 2 - Pedido pontual e segredo nunca viram memória (Priority: P2)

**Goal**: guarda de credenciais determinística antes do modelo (mensagem) e depois (fato).

**Independent Test**: mensagem com credencial → nenhuma memória e distiller não chamado;
distiller falso que *propõe* um fato com credencial → nenhuma memória, desfecho
`secret-in-fact`.

### Tests for User Story 2 ⚠️

- [x] T013 [P] [US2] Testes da guarda — `src/memory/secret-guard.test.ts`: um positivo por
      padrão G1–G6 (tabela do contrato, incluindo `AKIA…`, `ghp_…`, `sk-or-v1-…`, JWT, PEM,
      `postgres://app:s3nh4@db`, "a senha do grafana é Pr0d!2024", sequência de alta entropia);
      todos os negativos da tabela do contrato; o falso positivo aceito ("A senha é pedida pelo
      SSO…") como `true`; string vazia → `false` (S1); entradas estranhas (só espaço, emoji,
      10 000 caracteres) não lançam (S2) (FR-025)
- [x] T014 [P] [US2] Testes do refletor — `src/memory/learning-reflector.test.ts`: mensagem com
      credencial → `skipped/secret-in-message` e distiller **não** chamado; distiller propõe
      `"A senha do grafana é Pr0d!2024"` → `skipped/secret-in-fact` e nenhuma linha em
      `memories` (US2-3, SC-004); decisão "sem aprendizado" para exemplos de pedido pontual e
      estado operacional → nenhuma gravação (US2-1, US2-5, SC-003 — comprova o encanamento,
      não o julgamento do modelo)
- [x] T015 [P] [US2] Teste do endpoint — `src/http/server.test.ts`: `userId` + mensagem com
      token → 200 normal, `probe.next` é `skipped/secret-in-message`, distiller não chamado,
      `recall` vazio (US2-2)

### Implementation for User Story 2

- [x] T016 [US2] `src/memory/secret-guard.ts`: `looksLikeSecret` com G1–G6 e entropia de
      Shannon; comentário por padrão citando o exemplo do contrato (R-008; depende de T013)
- [x] T017 [US2] `src/memory/learning-reflector.ts`: passos 1 (mensagem, antes do distiller) e
      5 (fato validado, antes de `remember`) (depende de T008, T016)

**Checkpoint**: SC-003/SC-004 cobertos offline; US1 continua passando.

---

## Phase 5: User Story 3 - Esquecer uma preferência (Priority: P3)

**Goal**: `forget_preference` é a única ferramenta de memória do agente.

**Independent Test**: pedido com `userId` → `extraTools` tem exatamente `["forget_preference"]`;
esquecer um fato recuperado faz o `recall` seguinte não trazê-lo.

### Tests for User Story 3 ⚠️

- [x] T018 [P] [US3] Reescrever `src/memory/memory-tools.test.ts` (contracts/memory-tools.md):
      `defineMemoryTools` devolve só a chave `forget_preference`; descrição abre com "Apaga um
      fato lembrado", menciona "Fatos lembrados", "automático" e `forgotten: false`, e não
      contém `remember_fact` nem `forget_fact`; esquema só `memoryId` com `.describe()`, sem
      `userId`; execução restrita ao usuário e "não encontrado" sem lançar (US3-4);
      `createMemoryTools` devolve nomes `["forget_preference"]`
- [x] T019 [P] [US3] `src/mcp/ops-mcp-server.test.ts`: `forget_preference`, `remember_fact` e
      `forget_fact` fora de `MCP_TOOL_NAMES` (FR-019)
- [x] T020 [P] [US3] `src/http/server.test.ts`: com `userId`, os nomes em `extraTools` são
      exatamente `["forget_preference"]` (US3-1, SC-006); migrar o teste da 008 que chamava
      `remember_fact` para o fluxo do refletor (aprende via distiller falso, recupera no pedido
      seguinte); renomear o teste de esquecer para `forget_preference` (US3-2); mensagem
      "não sou mais de pagamentos, agora sou de identidade" com estratégia que chama
      `forget_preference` e distiller que propõe o fato novo → antigo apagado e novo guardado
      (US3-3)

### Implementation for User Story 3

- [x] T021 [US3] `src/memory/memory-tools.ts`: remover `remember_fact` e seu esquema; renomear
      `forget_fact` → `forget_preference` com a descrição do contrato; `defineMemoryTools`
      devolve `{ forget_preference }`, `createMemoryTools` um array de um elemento; atualizar o
      comentário do módulo (R-011; depende de T018)
- [x] T022 [P] [US3] `src/memory/with-memory.ts` (comentários: `forget_preference`) e
      `src/memory/with-memory.test.ts` (nome da ferramenta falsa) (depende de T021)
- [x] T023 [P] [US3] Comentários em `src/agents/types.ts` e `src/agents/react.ts` que citam
      `remember_fact`/`forget_fact` → `forget_preference`

**Checkpoint**: todas as histórias funcionando; `grep -rn "remember_fact\|forget_fact" src`
só encontra as asserções negativas dos testes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T024 [P] README: seção de memória reescrita — aprendizado automático depois da resposta,
      o que nunca é aprendido, guarda de credenciais, `forget_preference`, custo de +1 chamada
      por pedido com `userId` fora de `llmCalls`; árvore de `src/memory/` atualizada
- [x] T025 [P] `.github/copilot-instructions.md`: refletor, `forget_preference`, seams de teste
      (`distiller`, `onLearning`)
- [x] T026 [P] Aviso da 009 no topo de `specs/003-chat-http-api/contracts/chat-endpoint.md` e
      "(substituídas na 009)" no aviso da 008 (contracts/chat-endpoint.md)
- [x] T027 [P] Aviso no topo de `specs/008-semantic-memory/contracts/memory-tools.md` apontando
      para `specs/009-learning-reflector/contracts/memory-tools.md` (FR-027 da 008 substituído)
- [x] T028 `npm run typecheck` e `npm test` verdes, offline, sem `.env`
- [ ] T029 Verificação manual do quickstart.md (passos 1–6) — **requer `OPENROUTER_API_KEY` e
      o modelo de vetores**; não executável pelo agente de codificação, fica para quem roda

---

## Dependencies & Execution Order

- **Foundational (T001–T004)** → histórias.
- **US1** depende só da Foundational. Entrega o MVP.
- **US2** depende de T008 (refletor existir); a guarda (T013/T016) pode ser escrita em paralelo
  com a US1.
- **US3** independe do refletor: pode começar logo depois da Foundational; T020 (migração do
  teste da 008) pressupõe T010/T011 para o fluxo do refletor.
- **Polish** depois das histórias; T024–T027 paralelos entre si.

### Within each story

Testes primeiro, falhando → módulo → handler/servidor.

## Parallel Example: início

```bash
Task: "T001 learningDecisionSchema em src/domain/schemas.ts"
Task: "T002 teste do distiller em src/memory/distiller.test.ts"
Task: "T013 testes da guarda em src/memory/secret-guard.test.ts"
Task: "T018 testes de forget_preference em src/memory/memory-tools.test.ts"
```

## Implementation Strategy

1. Foundational.
2. US1 → validar por T006 (MVP: aprende de passagem, resposta não espera).
3. US2 → guarda de credenciais nas duas pontas.
4. US3 → `forget_preference` como única ferramenta.
5. Polish.

## Notes

- Nenhum teste chama modelo de linguagem: o helper `withServer` injeta distiller falso por
  padrão (T004); testes do refletor sempre passam um distiller.
- Nenhum teste usa `sleep`: aguardar o refletor é sempre `probe.next`; "não espera" é sempre
  `deferredDistiller` (FR-023).
- `server.test.ts` continua injetando `memoryStore` com `createTableEmbedder` sempre que envia
  `userId` — o default de `createApp` usa o gerador real.
