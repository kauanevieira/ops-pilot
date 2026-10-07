# Tasks: War Room Web

**Input**: Design documents from `/specs/016-war-room-web/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos. A constituição exige que lógica nova nasça com teste, e a spec exige
portões offline nos dois pacotes (FR-021, SC-007). Testes da API usam `node:test` com os dublês
já usados em `src/http/server.test.ts`. Testes da war room usam Vitest em `jsdom`, com `fetch`
injetado. Nenhum teste chama a API real, o provedor ou a rede, e nenhum lê `.env`. Escrever cada
teste antes da implementação correspondente e confirmar que falha.

**Organization**: Foundational (esquemas de rede em `src/domain/`, esqueleto de `web/`, URL da
API e cliente HTTP) e depois uma fase por história, em ordem de prioridade.
- US1 (P1): conversa pelo navegador.
- US5 (P1): CORS na API. Junto com a US1, forma o MVP usável contra a API real.
- US2 (P1): "ver raciocínio" com o rastro tipado.
- US4 (P2): engrenagem com a URL da API.
- US3 (P2): cartão aprovar/negar contra o dublê de `contracts/approval-flow.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa
- Códigos entre parênteses (CO1, WS3, AP2, UI1…) são as garantias de `contracts/`

---

## Phase 1: Setup

- [x] T001 Criar o branch `016-war-room-web` a partir de `main`
- [x] T002 Criar o pacote `web/` sem workspaces npm:
  - `web/package.json` com `"private": true`, `"type": "module"` e os scripts `dev`
    (`vite`), `build` (`vite build`), `preview` (`vite preview`), `test` (`vitest run`) e
    `typecheck` (`tsc --noEmit`).
  - dependências `react` e `react-dom`; devDependencies `vite`, `@vitejs/plugin-react`, `vitest`,
    `jsdom`, `@testing-library/react`, `@testing-library/user-event`,
    `@testing-library/jest-dom`, `@types/react`, `@types/react-dom` e `typescript` (mesma major
    da raiz).
  - **não** declarar `zod` (research R-003).
- [x] T003 Criar `web/vite.config.ts` (depende de T002):
  - `base: "/opspilot/"`, `plugins: [react()]`.
  - `resolve.alias: { "@domain": path.resolve(__dirname, "../src/domain") }` e
    `server.fs.allow: [".."]`.
  - um plugin de build que, em `closeBundle`, copia `dist/index.html` para `dist/404.html`
    (research R-005).
  - `test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] }`.
- [x] T004 [P] Criar `web/tsconfig.json` (depende de T002): `strict`, `jsx: "react-jsx"`,
  `moduleResolution: "Bundler"`, `allowImportingTsExtensions`, `noEmit`,
  `types: ["vite/client", "vitest/globals", "@testing-library/jest-dom"]`,
  `paths: { "@domain/*": ["../src/domain/*"] }`, `include: ["src", "../src/domain"]`, excluindo
  `../src/domain/**/*.test.ts`.
- [x] T005 [P] Criar `web/index.html` (título "OpsPilot · War Room", `<div id="root">`, script
  `/src/main.tsx`), `web/src/main.tsx` (monta `<App />` em `StrictMode`, importa os CSS),
  `web/src/App.tsx` provisório e `web/src/test-setup.ts` (importa
  `@testing-library/jest-dom/vitest`).
- [x] T006 [P] Criar `web/.env.example` com `VITE_OPSPILOT_API_URL=http://localhost:3000` e um
  comentário. Acrescentar `web/node_modules/` e `web/dist/` ao `.gitignore` da raiz.
- [x] T007 [P] Criar `web/src/styles/tokens.css` e `web/src/styles/app.css` com a direção visual
  de research R-006:
  - variáveis em `:root` (`--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`,
    `--accent`, `--danger`, `--warn`, `--ok`, `--font-ui`, `--font-mono`) e uma cor por tipo
    de evento (`--ev-route` violeta, `--ev-thought` cinza, `--ev-action` azul,
    `--ev-observation` verde, `--ev-error` vermelho, `--ev-plan` âmbar, `--ev-critique` laranja,
    `--ev-answer` realce, `--ev-summarize` ciano, `--ev-fallback` vermelho, `--ev-unknown`
    neutro).
  - tema escuro por padrão, claro em `@media (prefers-color-scheme: light)`, `body` com fundo
    explícito.
  - layout: coluna de conversa com no máximo 820 px, compositor fixo no rodapé, gaveta à direita
    a partir de 641 px e em tela cheia até 640 px, gutter de 16 px no celular, sem rolagem
    horizontal.
- [x] T008 Rodar `npm --prefix web install` e confirmar que `npm --prefix web run typecheck` e
  `npm --prefix web test -- --passWithNoTests` passam no esqueleto

**Checkpoint**: `web/` sobe em `http://localhost:5173/opspilot/` com a página provisória.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquemas de rede como fonte única, URL da API e cliente HTTP. Todas as histórias da
war room usam isso.

**⚠️ CRITICAL**: nenhuma história da war room começa antes desta fase. A US5 (CORS) só depende
da Phase 1 e pode correr em paralelo a esta.

### Esquemas de rede (contracts/wire-schemas.md, research R-003/R-004)

- [x] T009 Escrever `src/domain/wire.test.ts` (`node:test`). Deve falhar até T010/T011:
  - **WS3**: as fixtures `StrategyResult` de `src/http/server.test.ts` (`FIXED_TRACE`/`fixedResult`)
    e um resultado com os 9 tipos de evento, `nodeName` e todas as métricas opcionais
    (inclusive `contextBreakdown`) passam em `strategyResultSchema.parse`.
  - `chatResponseSchema` aceita um evento de tipo desconhecido em `trace`, porque o rastro é
    `z.array(z.unknown())`.
  - `runMetricsSchema` descarta um campo desconhecido sem falhar.
  - `apiErrorBodySchema` aceita `code` fora de `chatErrorCodeSchema` (AP4).
  - `chatAcceptedSchema` aceita o exemplo de `contracts/approval-flow.md` com e sem
    `trace`/`expiresAt`, e recusa `status` diferente de `"pending_approval"`.
  - `approvalDecisionSchema` aceita só `"approve" | "deny"`.
  - **WS4**: lê com `node:fs` cada `src/domain/*.ts` que não seja `*.test.ts` e falha se algum
    `import` vier de algo que não seja `"zod"` ou `"./…"`.
- [x] T010 Criar `src/domain/wire.ts` (depende de T009), só com imports de `zod` e
  `./schemas.ts`:
  - `traceEventSchema`: `z.discriminatedUnion("type", [...])` com os 9 membros exatamente como
    em `src/trace/types.ts` (`thought{content}`, `action{tool, args: z.record(z.string(),
    z.unknown())}`, `observation{content, tool?, isError?}`, `plan{steps: string[],
    revision: number}`, `critique{content}`, `answer{content}`, `summarize{content,
    absorbedMessages}`, `route{route: routeSchema, strategy: z.string(), reason,
    source: routeSourceSchema}`, `fallback{from, to, reason: failureKindSchema}`). Cada membro
    estende `{ nodeName: nodeNameSchema.optional() }`. Os comentários JSDoc de cada membro
    migram de `types.ts` para cá.
  - `contextBreakdownSchema` (`message`, `history`, `summary`, `memories`, `total`: inteiros ≥ 0).
  - `runMetricsSchema` (`llmCalls`, `latencyMs` obrigatórios; `historyMessages?`,
    `recalledMemories?`, `promptTokens?`, `contextBreakdown?`, `summaryCoveredMessages?`,
    `modelUsed?`), com os JSDoc de `RunMetrics`.
  - `strategyResultSchema` (`answer`, `trace: z.array(traceEventSchema)`, `metrics`,
    `stoppedReason: stoppedReasonSchema`).
  - `chatResponseSchema` = `strategyResultSchema.extend({ trace: z.array(z.unknown()),
    conversationId: z.string(), requestId: requestIdSchema })`.
  - `apiErrorBodySchema`, `pendingActionSchema`, `chatAcceptedSchema`, `approvalDecisionSchema`
    e `approvalDeniedSchema`, conforme a tabela de `contracts/wire-schemas.md`.
  - exportar os tipos inferidos (`ChatResponseWire`, `ApiErrorBody`, `PendingAction`,
    `ChatAccepted`, `ApprovalDecision`, `ApprovalDenied`).
- [x] T011 Em `src/trace/types.ts` (depende de T010; WS1/WS2):
  - `TraceEvent`, `RunMetrics`, `ContextBreakdown` e `StrategyResult` passam a ser
    `z.infer<typeof …Schema>` de `../domain/wire.ts`. Remover a união escrita à mão e as
    interfaces, sem mudar nenhum nome exportado.
  - `_TraceTypesInSync` passa a comparar `z.infer<typeof traceEventSchema>["type"]` com
    `TraceEventType`.
  - confirmar que `npm run typecheck` passa sem tocar em nenhum outro arquivo. Se algum
    consumidor quebrar por diferença de opcionalidade, ajustar o esquema, não o consumidor.
- [x] T012 Rodar `npm run typecheck && npm test` na raiz: tudo verde, sem regressão

### URL da API e cliente (research R-007 a R-009, data-model.md)

- [x] T013 [P] Escrever `web/src/api/url.test.ts` e depois implementar `web/src/api/url.ts`
  (puras):
  - `parseApiUrl(input): { ok: true; url } | { ok: false; reason }` aceita só `http:`/`https:`
    absolutas, remove a barra final e preserva o caminho (`https://host/api/` →
    `https://host/api`). Recusa vazio, `ftp:`, relativa e texto solto.
  - `joinApiUrl(base, path)` concatena sem barra dupla (`http://h:3000` + `/chat`,
    `https://h/api` + `/chat` → `https://h/api/chat`).
  - `DEFAULT_API_URL` = `import.meta.env.VITE_OPSPILOT_API_URL` validada por `parseApiUrl`,
    ou `http://localhost:3000`.
- [x] T014 [P] Escrever `web/src/api/client.test.ts` cobrindo `classifyResponse(status, headers,
  json)` (pura):
  - 200 válido → `answered`.
  - 202 válido → `pending`.
  - 4xx/5xx com corpo de erro → `api-error`, com `requestId` vindo do corpo ou, na falta dele,
    de `X-Request-Id`.
  - 200 sem `answer`, 202 sem `approval`, status 302 e corpo de erro sem `error.code` →
    `malformed`.
- [x] T015 Implementar `web/src/api/client.ts` (depende de T013, T014, T010):
  - `classifyResponse`.
  - `createApiClient({ baseUrl, fetch, timeoutMs = 190_000 })` com
    `sendChat({ message, conversationId? })` e `decide(approvalId, decision)`, ambos
    devolvendo `ChatOutcome` (data-model.md). Importa esquemas de `@domain/wire.ts`.
  - corpo do `/chat` só com `message` e, quando existir, `conversationId` (nunca `strategy`,
    `reflect` ou `userId`).
  - `TypeError` do `fetch` vira `unreachable{reason: "network"}`. Abort pelo prazo vira
    `unreachable{reason: "timeout"}`. JSON inválido vira `malformed`.
  - testes adicionais em `client.test.ts` com `fetch` dublê: URL e corpo enviados, rede caída,
    prazo (com `timeoutMs` curto) e JSON inválido.
- [x] T016 [P] Escrever `web/src/settings/api-url-store.test.ts` e depois implementar
  `web/src/settings/api-url-store.ts`:
  - `loadApiUrl(storage) → ApiUrlSetting` lê `opspilot.apiUrl`. Valor inválido é ignorado e
    devolve `source: "default"`. Storage que lança exceção devolve `persistent: false`.
  - `saveApiUrl(storage, url)` e `resetApiUrl(storage)` envolvem todo acesso em try/catch e
    informam se gravaram.
  - o `storage` é injetado (`Storage | null`).

**Checkpoint**: a fundação está pronta. As histórias da war room podem começar.

---

## Phase 3: User Story 1 - Conversar com o OpsPilot pelo navegador (Priority: P1) 🎯 MVP

**Goal**: enviar mensagens, ver respostas e manter a conversa entre turnos, com erros legíveis.

**Independent Test**: com `fetch` dublê, duas mensagens seguidas mostram duas respostas e a
segunda chamada leva o `conversationId` da primeira. Contra a API real, depois da US5, o mesmo
vale pelo navegador.

### Tests for User Story 1

- [x] T017 [P] [US1] Escrever `web/src/state/conversation.test.ts` (reducer puro, data-model.md):
  - `send` acrescenta o item `user` e liga `inFlight`. `send` com `!canSend` é ignorado.
  - `answered` acrescenta `answer`, guarda `conversationId` e desliga `inFlight`.
  - `failed` acrescenta `error` com `retryText`.
  - `reset` volta ao estado inicial.
  - o reducer não muta o estado recebido (comparar com `structuredClone` feito antes).
- [x] T018 [P] [US1] Escrever `web/src/App.test.tsx`, com `fetch` dublê e ids/relógio fixos:
  - enviar mostra a mensagem na hora e o indicador "pensando…" até a resposta.
  - a segunda mensagem é enviada com `conversationId`.
  - "Nova conversa" limpa a tela e a próxima chamada vai sem `conversationId`.
  - o compositor fica desabilitado durante o pedido (FR-003).
  - Enter envia e Shift+Enter quebra linha.
- [x] T019 [P] [US1] Escrever `web/src/chat/ErrorBubble.test.tsx`, com um caso por linha da tabela
  "Mensagens de erro" de `contracts/web-ui.md`:
  - o texto de cada código.
  - o `requestId` aparece com botão copiar.
  - "Tentar de novo" para `timeout`/`model_unavailable`/`internal`.
  - "Nova conversa" para `conversation_not_found`.
  - a mensagem de `unreachable` cita a URL tentada, a engrenagem e `OPSPILOT_CORS_ORIGINS`.

### Implementation for User Story 1

- [x] T020 [US1] Implementar `web/src/state/conversation.ts` (depende de T017): tipos
  `ConversationState`/`ConversationItem`/`ApprovalState` como em data-model.md, um reducer
  puro com as ações `send`, `answered`, `failed` e `reset`, e o seletor `canSend` (já
  considerando cartões `pending`/`deciding`, para a US3 só acrescentar ações)
- [x] T021 [P] [US1] Implementar `web/src/chat/errors.ts` (pura): `toDisplayError(outcome, url)
  → DisplayError`, com os textos da tabela de `contracts/web-ui.md` (código desconhecido →
  "A API respondeu com erro `<code>`."), e `web/src/chat/ErrorBubble.tsx` (depende de T019)
- [x] T022 [P] [US1] Implementar `web/src/chat/MessageList.tsx`: renderiza `items` em ordem.
  `user` à direita. `answer` à esquerda com o texto (quebras preservadas), a estratégia do
  evento `route` quando existir (via `parseTrace` provisório, ou `null`) e `latencyMs`. Deixar um
  slot `onShowTrace(itemId)` para a US2. `error` via `ErrorBubble`.
- [x] T023 [P] [US1] Implementar `web/src/chat/Composer.tsx`: textarea com rótulo acessível,
  Enter envia, Shift+Enter quebra linha, botão Enviar, ambos desabilitados com `disabled`, e
  indicador "pensando… Ns" quando `inFlight` (contador por `setInterval`, limpo no unmount)
- [x] T024 [US1] Implementar `web/src/App.tsx` (depende de T015, T016, T020–T023):
  - `useReducer(conversationReducer)`. Ids por `crypto.randomUUID()` e `at` por
    `new Date().toISOString()`, só aqui (Princípio I).
  - `createApiClient` com `loadApiUrl(window.localStorage)` (tolerando exceção) e o `fetch`
    global. Aceitar `fetch`, `storage`, `newId` e `now` por props, para os testes.
  - cabeçalho com "OpsPilot · War Room", URL em uso e "Nova conversa".
  - "Tentar de novo" reenvia `retryText`. "Nova conversa" de erro chama `reset`.
- [x] T025 [US1] Rodar `npm --prefix web test` e `npm --prefix web run typecheck`: verdes

**Checkpoint**: a conversa funciona contra o `fetch` dublê.

---

## Phase 4: User Story 5 - A API aceitar a war room de outra origem (Priority: P1)

**Goal**: o navegador em `http://localhost:5173` consegue chamar a API, e uma origem fora da
lista não consegue.

**Independent Test**: `curl` com e sem `Origin` (quickstart §2). Os testes de integração em
`server.test.ts` cobrem CO1–CO5.

**Depende só de T001** (nenhuma tarefa da war room). Pode correr em paralelo às
Phases 2 e 3.

### Tests for User Story 5

- [x] T026 [P] [US5] Escrever `src/http/cors.test.ts` (`node:test`) para as funções puras:
  - `parseCorsOrigins(env)`: `undefined`/vazio dá `["http://localhost:5173"]`. Vírgulas e
    espaços são aceitos, e cada item é normalizado por `new URL(o).origin`. Um item com caminho,
    query, fragmento, esquema não-http(s) ou texto solto lança erro com o item no texto.
  - `corsDecision({ origin, method, requestMethod }, allowlist)`, cobrindo a tabela de
    `contracts/cors.md`:
    - sem origem → nenhum cabeçalho e `end: false`.
    - permitida → `Allow-Origin`, `Expose-Headers: X-Request-Id` e `Vary: Origin`.
    - negada → só `Vary: Origin`.
    - preflight permitido → `end: true`, status 204, `Allow-Methods: GET, POST`,
      `Allow-Headers: Content-Type` e `Max-Age: 600`.
    - preflight negado → `end: true`, 204, sem `Access-Control-*`.
    - comparação exata, sem curinga (`http://localhost:5173.evil.com` negado) (CO3).
    - nunca `Allow-Credentials` (CO4).
- [x] T027 [P] [US5] Acrescentar a `src/http/server.test.ts`, com `createApp({ corsOrigins:
  ["http://localhost:5173"], ... })` e os dublês existentes:
  - preflight de `POST /chat` com origem permitida → 204 com os cabeçalhos. Depois disso,
    `GET /stats` não conta nenhum pedido novo e o logger dublê não registra `request.*` (CO2).
  - `POST /chat` com origem permitida → 200 com `Access-Control-Allow-Origin` e
    `Access-Control-Expose-Headers: X-Request-Id`.
  - JSON malformado com origem permitida → 400 com os cabeçalhos CORS (CO5).
  - `POST /chat` sem `Origin` → status, corpo e cabeçalhos iguais aos de um app sem o
    middleware, a menos de `Vary` (CO1).
  - `GET /requests/:id` e `GET /stats` com origem permitida → com `Allow-Origin`.

### Implementation for User Story 5

- [x] T028 [US5] Implementar `src/http/cors.ts` (depende de T026): `parseCorsOrigins`,
  `corsDecision` (puras) e `createCors(allowlist): RequestHandler`, que aplica os cabeçalhos e
  responde 204 vazio quando `end` (preflight). Comentários com FR-023/024/025 e CO1–CO5.
- [x] T029 [US5] Em `src/http/server.ts` (depende de T028): `ChatAppDeps.corsOrigins?: string[]`,
  com default `["http://localhost:5173"]` e JSDoc no mesmo padrão das outras deps.
  `app.use(createCors(corsOrigins))` vem **antes** de `app.post("/chat", …)` e das outras
  rotas. Rodar T027.
- [x] T030 [US5] Em `src/index.ts` (depende de T028): `resolveCorsOrigins()` lê
  `process.env.OPSPILOT_CORS_ORIGINS` via `parseCorsOrigins`. Se for inválida, faz
  `console.error` com a mensagem e `process.exit(1)` (mesma regra de `resolveModelPrices`).
  Passar o resultado ao `createApp`.
- [x] T031 [US5] Rodar `npm run typecheck && npm test` na raiz: verdes

**Checkpoint (MVP)**: com `npm run dev` e `npm --prefix web run dev`, uma conversa de 3 turnos
funciona no navegador (quickstart §3 passos 1, 2 e 5).

---

## Phase 5: User Story 2 - Ver o raciocínio de uma resposta (Priority: P1)

**Goal**: "ver raciocínio" abre uma gaveta com o rastro tipado, as métricas e o motivo de
parada.

**Independent Test**: um resultado com os 9 tipos de evento, mais um desconhecido, renderiza
cada tipo com seu rótulo e seus campos. O desconhecido aparece de forma genérica, e os demais
continuam visíveis.

### Tests for User Story 2

- [x] T032 [P] [US2] Escrever `web/src/trace/parse-trace.test.ts`:
  - cada evento válido sai como `KnownEvent`, na ordem recebida.
  - `{type: "vote", …}`, `{type: "action"}` sem `tool` e um não-objeto saem como
    `{ kind: "unknown", type, raw }`, com `type: null` quando não houver string (FR-008, UI1).
- [x] T033 [P] [US2] Escrever `web/src/trace/TraceDrawer.test.tsx`, com a fixture tipada por
  `z.infer` (research R-010):
  - cada linha da tabela "Apresentação do rastro" de `contracts/web-ui.md` aparece com rótulo e
    campos. `args` aninhado não contém `[object Object]`.
  - `observation` com `isError` mostra o selo "erro". `plan` mostra "rev. N" e passos numerados.
  - `nodeName` aparece quando presente.
  - o cabeçalho mostra `stoppedReason` e só as métricas presentes. `promptTokens` ausente não
    aparece como 0 (FR-009).
  - conteúdo com mais de 600 caracteres vem recolhido, e "mostrar tudo" expande (FR-010).
  - o evento desconhecido mostra o JSON bruto, e os outros continuam (UI1).
  - Esc e o botão fechar fecham a gaveta, e o foco volta ao "ver raciocínio" de origem.

### Implementation for User Story 2

- [x] T034 [US2] Implementar `web/src/trace/parse-trace.ts` (depende de T032):
  `parseTrace(raw: unknown[]): ParsedTraceEvent[]` com `traceEventSchema.safeParse` de
  `@domain/wire.ts`. Trocar o uso provisório em `MessageList` (T022).
- [x] T035 [P] [US2] Implementar `web/src/trace/Collapsible.tsx` (limite de 600 caracteres ou 12
  linhas, "mostrar tudo"/"mostrar menos") e `web/src/trace/ArgsTree.tsx` (chave/valor
  recursivo, com arrays numerados e primitivos formatados)
- [x] T036 [P] [US2] Implementar `web/src/trace/events/` com um componente por tipo:
  `SummarizeEvent`, `RouteEvent`, `ThoughtEvent`, `ActionEvent`, `ObservationEvent`,
  `PlanEvent`, `CritiqueEvent` (selo aprovado/reprovado pelo prefixo `aprovado:`/`reprovado:`),
  `AnswerEvent`, `FallbackEvent` e `UnknownEventView`. Cada um com rótulo em texto, a cor
  `--ev-*` (UI4) e o `nodeName`. Mais `web/src/trace/events/index.tsx` com um `switch` exaustivo
  sobre `type`, em que o `default` cai no tipo `never`.
- [x] T037 [US2] Implementar `web/src/trace/TraceDrawer.tsx` (depende de T034–T036):
  - `role="dialog"`, `aria-modal` e título "Raciocínio".
  - cabeçalho com `stoppedReason` e as métricas presentes, `contextBreakdown` em linha.
  - lista de eventos.
  - fecha com Esc, botão ou clique no fundo, e devolve o foco ao elemento de origem.
- [x] T038 [US2] Ligar em `web/src/chat/MessageList.tsx` e `web/src/App.tsx`: botão "ver
  raciocínio" em cada `answer`, guardando qual item está aberto no estado local do `App` (não no
  reducer). Rodar T033 e o `App.test.tsx`.

**Checkpoint**: US1, US5 e US2 completas. A feature é integrável (P1 completo).

---

## Phase 6: User Story 4 - Apontar a war room para outra API (Priority: P2)

**Goal**: a engrenagem troca e restaura a URL da API, e a escolha sobrevive a recarregar a
página.

**Independent Test**: salvar `http://localhost:3999`, remontar o `App` com o mesmo `storage`
dublê e enviar uma mensagem. O `fetch` dublê recebe `http://localhost:3999/chat`.

### Tests for User Story 4

- [ ] T039 [P] [US4] Escrever `web/src/settings/SettingsDialog.test.tsx` e acrescentar a
  `web/src/App.test.tsx`:
  - a engrenagem (rótulo "Configurações") abre o diálogo com a URL em uso.
  - uma URL inválida mostra erro inline e mantém a anterior.
  - salvar troca o destino do próximo `fetch`.
  - remontar o `App` com o mesmo storage mantém a URL salva.
  - "Restaurar padrão" volta a `DEFAULT_API_URL`.
  - com um storage que lança exceção, o diálogo avisa que a escolha não será lembrada, e a war
    room segue com o padrão (FR-018).

### Implementation for User Story 4

- [ ] T040 [US4] Implementar `web/src/settings/SettingsDialog.tsx` (depende de T039): campo
  URL rotulado e os botões Salvar, Restaurar padrão e Cancelar. Valida com `parseApiUrl` e
  mostra o aviso quando `persistent === false`.
- [ ] T041 [US4] Em `web/src/App.tsx`: a URL passa a ser estado (`ApiUrlSetting`), o cliente é
  recriado quando ela muda, a engrenagem fica no cabeçalho e o cabeçalho mostra se a URL em uso
  é a padrão. Rodar T039.

**Checkpoint**: quickstart §3 passo 4 passa contra a API local.

---

## Phase 7: User Story 3 - Aprovar ou negar uma ação pendente (Priority: P2)

**Goal**: o 202 vira um cartão Aprovar/Negar, com uma decisão por cartão, conforme
`contracts/approval-flow.md` (estado "proposto": a API ainda não emite 202).

**Independent Test**: com `fetch` dublê que responde 202 e depois 200, 200 `denied` ou 409, o
cartão percorre cada caminho e nunca dispara duas decisões.

### Tests for User Story 3

- [ ] T042 [P] [US3] Acrescentar a `web/src/state/conversation.test.ts`:
  - `pending` acrescenta um `approval{pending}`, guarda `conversationId` e faz
    `canSend === false`.
  - `decide` só sai de `pending` (um segundo `decide` é ignorado) e liga `inFlight`.
  - `decided` leva a `approved` mais um item `answer`, ou a `denied`, ou a `rejected{reason}`.
  - nenhum estado final volta atrás (SC-004).
  - uma falha de rede na decisão volta a `pending` e acrescenta um item `error` logo depois.
- [ ] T043 [P] [US3] Escrever `web/src/chat/ApprovalCard.test.tsx` e um caso em `App.test.tsx`
  (`describe("approval")`, para o filtro de quickstart §5):
  - o 202 mostra a descrição, a ferramenta, os argumentos (via `ArgsTree`) e os botões.
  - Aprovar chama `POST {api}/approvals/{id}` com `{decision:"approve"}`. O 200 mostra
    "aprovado" e uma resposta com "ver raciocínio".
  - Negar mostra "negado".
  - um duplo clique gera uma só chamada (UI2).
  - 404/409/410 mostram "Pendência não encontrada", "Já decidida" e "Expirou".
  - o compositor fica bloqueado enquanto o cartão está pendente (US3-6).
  - um 202 em resposta à decisão gera um novo cartão.

### Implementation for User Story 3

- [ ] T044 [US3] Em `web/src/state/conversation.ts` (depende de T042): ações `pending`,
  `decide`, `decided` e `decisionFailed`, com as transições e invariantes de data-model.md
- [ ] T045 [P] [US3] Implementar `web/src/chat/ApprovalCard.tsx` (depende de T043, T035):
  borda âmbar, descrição, `tool`, `ArgsTree(args)`, `expiresAt` quando houver, e Aprovar
  (primário) e Negar (secundário), desabilitados fora de `pending`. Nos estados finais vira o
  selo "aprovado", "negado" ou "recusado: <motivo>".
- [ ] T046 [US3] Em `web/src/App.tsx` e `web/src/chat/MessageList.tsx` (depende de T044, T045):
  - `sendChat` com `pending` despacha a ação `pending`.
  - a decisão chama `client.decide` e mapeia o resultado: `answered` → `decided(approved)` mais
    `answer`; `approvalDeniedSchema` → `denied`; `pending` → novo cartão; `api-error`
    404/409/410 → `rejected` com o texto de `contracts/web-ui.md`; outros erros e `unreachable`
    → `decisionFailed`.
  - em `web/src/api/client.ts`, `decide` reconhece o 200 `denied` por `approvalDeniedSchema`
    antes de `chatResponseSchema`.
  - rodar T042 e T043.

**Checkpoint**: todas as histórias completas. A US3 fica verificada contra o dublê até a API
implementar `contracts/approval-flow.md`.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T047 [P] `.env.example`: `OPSPILOT_CORS_ORIGINS=` com comentário (formato, default
  `http://localhost:5173`, e que a preview em `4173` precisa entrar na lista)
- [ ] T048 [P] `README.md`:
  - seção "War room" com o que é, `npm --prefix web install`, `dev`, `build`, `preview`,
    `/opspilot/`, `VITE_OPSPILOT_API_URL`, engrenagem, CORS e o fato de que o 202 depende de
    uma feature futura.
  - em "Comandos", os scripts de `web/`.
  - em "Estrutura", `web/` e `src/domain/wire.ts`.
- [ ] T049 [P] `.github/copilot-instructions.md`:
  - na Stack, `web/` (Vite+React+TS, Vitest) e a regra de que os esquemas de resposta vivem em
    `src/domain/wire.ts` e que `src/domain/` só importa `zod`.
  - em Comandos, os portões de `web/`.
- [ ] T050 [P] Emendas de contrato: notas "Emendado por `016-war-room-web`" em
  `specs/003-chat-http-api/contracts/chat-endpoint.md` (CORS, 202 proposto) e em
  `specs/014-request-tracing/contracts/chat-endpoint.md` (`X-Request-Id` exposto por CORS)
- [ ] T051 Passada de acessibilidade e responsividade em `web/src/styles/app.css` e nos
  componentes:
  - rótulos, `aria-live="polite"` na lista de mensagens e foco visível.
  - em 375 px de largura, sem rolagem horizontal e com a gaveta em tela cheia.
  - contraste dos tokens nos dois temas.
- [ ] T052 Rodar os portões completos: `npm run typecheck && npm test` e
  `npm --prefix web run typecheck && npm --prefix web test`
- [ ] T053 Rodar `specs/016-war-room-web/quickstart.md` §2 a §4 contra a API local e registrar o
  resultado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende de T002–T008 para a parte da war room. T009–T012
  (esquemas) só dependem de T001. Bloqueia US1, US2, US3 e US4.
- **US5 (Phase 4)**: depende só de T001. Pode correr em paralelo às Phases 2 e 3.
- **US1 (Phase 3)**: depende da Phase 2.
- **US2 (Phase 5)**: depende da US1 (`MessageList`, `App`).
- **US4 (Phase 6)**: depende da US1 (`App`). É independente da US2.
- **US3 (Phase 7)**: depende da US1 e de `ArgsTree` (T035, US2). Não depende da US4.
- **Polish (Phase 8)**: depois das histórias desejadas.

### Within Each User Story

- Teste antes, confirmando que falha. Depois, puras → componentes → ligação no `App`.
- `src/domain/wire.ts` (T010) antes de `src/trace/types.ts` (T011), e ambos antes de qualquer
  import `@domain` na war room.

### Parallel Opportunities

- Phase 1: T004, T005, T006 e T007 em paralelo depois de T002.
- Phase 2: T013, T014 e T016 em paralelo entre si, e com T009–T011.
- US5 inteira em paralelo com Foundational e US1 (só toca `src/http/` e `src/index.ts`).
- US1: T017, T018 e T019 em paralelo; T021, T022 e T023 em paralelo depois de T020.
- US2: T032 e T033 em paralelo; T035 e T036 em paralelo.
- US4 e US2 em paralelo depois da US1, desde que se coordene a edição de `App.tsx`.
- Polish: T047–T050 em paralelo.

---

## Parallel Example: User Story 2

```bash
# Testes juntos:
Task: "parse-trace tests in web/src/trace/parse-trace.test.ts"
Task: "TraceDrawer tests in web/src/trace/TraceDrawer.test.tsx"

# Componentes de apoio juntos, depois de parse-trace:
Task: "Collapsible + ArgsTree in web/src/trace/"
Task: "One component per event type in web/src/trace/events/"
```

---

## Implementation Strategy

### MVP First (US1 + US5)

1. Phase 1 e Phase 2 (esquemas, url, cliente).
2. US1 (conversa) e US5 (CORS), em paralelo se der.
3. **Parar e validar**: conversa de 3 turnos no navegador contra a API local (quickstart §3).

### Incremental Delivery

1. MVP → US2 (raciocínio): P1 completo, a feature é integrável na `main`.
2. US4 (engrenagem) → validar quickstart §3.4.
3. US3 (aprovação) → validar contra o dublê (quickstart §5).
4. Polish, README e emendas.

---

## Notes

- Nenhum texto de conversa é gravado no navegador (UI3). Só `opspilot.apiUrl`.
- `src/domain/` continua importando só `zod`. Se alguma tarefa precisar de outra coisa ali,
  parar e revisar (WS4).
- O lado servidor do fluxo de aprovação **não** está aqui. Uma feature separada implementa
  `contracts/approval-flow.md` e a emenda, se precisar.
- Commit por tarefa ou grupo lógico, com a mensagem terminando em `(016)`, como nas features
  anteriores.
