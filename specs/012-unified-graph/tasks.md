# Tasks: Grafo Unificado com Roteador

**Input**: Design documents from `/specs/012-unified-graph/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos. A spec os exige (FR-026, FR-027). Todo teste usa roteador, sumarizador e
estratégia falsos: nenhum chama modelo nem lê `.env`. Escrever cada teste antes da
implementação correspondente e confirmar que falha.

**Organization**: Foundational (domínio, tipos do rastro, esqueleto do roteador, funções puras,
o grafo inteiro e a troca do handler) e depois uma fase por história.
- US1 (P1): o roteador real escolhe a estratégia, com recuo.
- US2 (P1): override por `strategy`/`reflect`, visível no rastro.
- US3 (P2): `nodeName` legível e conferido de ponta a ponta.

O grafo é escrito inteiro na Foundational, conforme `contracts/production-graph.md`, porque as
três histórias passam pelos mesmos nós. Cada história acrescenta o que só ela precisa (o
roteador real em US1, a prova do override em US2, a exibição em US3) e os testes que a provam.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa
- Códigos entre parênteses (G4, RN3, RT1, CH5…) são as garantias de
  `contracts/production-graph.md`, `contracts/router.md` e `contracts/chat-endpoint.md`

---

## Phase 1: Setup

Nada a instalar ou configurar: nenhuma dependência nova, nenhuma tabela nova (plan.md,
Technical Context).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tudo que as três histórias usam: esquemas de rota, tipos do rastro, tipos e
constantes do roteador, funções puras do grafo, o grafo com os seis nós e o `/chat` passando
por ele.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Domínio e tipos do rastro (R-005, R-010, R-011)

- [ ] T001 [P] Em `src/domain/schemas.ts`, numa seção `// --- 012-unified-graph`:
      `export const ROUTE_REASON_MAX_CHARS = 300;`;
      `routeSchema = z.enum(["react", "plan-and-execute", "reflect"])`;
      `routeDecisionSchema = z.object({ route: routeSchema.describe("estratégia de raciocínio
      escolhida para o pedido: react, plan-and-execute ou reflect"), reason:
      z.string().describe("uma frase curta explicando por que essa estratégia é a mais adequada
      ao pedido") })`, com `reason` **sem** `.max()` (FR-013 manda cortar, não rejeitar);
      `routeSourceSchema = z.enum(["router", "override", "fallback"])`;
      `nodeNameSchema = z.enum(["context", "router", "react", "plan-and-execute", "reflect",
      "response"])`; e os tipos inferidos `Route`, `RouteDecision`, `RouteSource`, `NodeName`
- [ ] T002 [P] Em `src/trace/types.ts`: acrescentar à união o membro `{ type: "route"; route:
      Route; strategy: string; reason: string; source: RouteSource }` com comentário no molde do
      `summarize` (produzido só pelo nó `router` do grafo do `/chat`, exatamente uma vez por
      pedido, depois do `summarize` e antes da estratégia; `strategy` no vocabulário do
      registro: `react`, `plan-and-execute`, `reflect:react`, `reflect:plan-and-execute`).
      Transformar `TraceEvent` em `( …união… ) & { nodeName?: NodeName }`, com comentário: é
      opcional, carimbado só pelo grafo (R-011), e ausente na arena, no bench e no MCP. Rodar
      `npm run typecheck`. O `switch` de `src/trace/format.ts` deixa de ser exaustivo até a T022.
      Se o `tsc` acusar, acrescentar ali provisoriamente `case "route": return \`[route]
      ${event.strategy}\`;`

### Esqueleto do roteador (R-004, R-007, R-008, R-009)

- [ ] T003 [P] Criar `src/agents/router.test.ts` com os casos de `capReason` (RT5): `"  ok  "`
      → `"ok"`; `""` → `""`; `"   "` → `""`; texto de exatamente 300 caracteres → intacto;
      texto de 301 → 300 caracteres terminando em `…`; o resultado nunca passa de
      `ROUTE_REASON_MAX_CHARS`
- [ ] T004 Criar `src/agents/router.ts` com: `interface RouterInput { message: string; summary:
      string | null; messages: ConversationMessage[] }`; `type Router = (input: RouterInput,
      signal: AbortSignal) => Promise<unknown>` (comentário: `unknown` de propósito, validado no
      nó com `routeDecisionSchema.safeParse`, R-004); `export const ROUTER_TIMEOUT_MS =
      15_000`; `export const FALLBACK_REASON = "Roteador indisponível; seguindo com react."`;
      `export const OVERRIDE_REASON = "Estratégia imposta pelo pedido."`; e `capReason(text)`
      (trim; acima de 300, `slice(0, 299).trimEnd()` + `…`, no molde de `capSummary`). T003
      verde

### Funções puras do grafo (data-model.md, G10, G11)

- [ ] T005 [P] Criar `src/agents/production-graph.test.ts` com os testes das funções puras:
      `isOverride` (`{ strategy: undefined, reflect: false }` → false; `{ strategy: "react",
      reflect: false }` → true; `{ strategy: undefined, reflect: true }` → true);
      `routeForSelection` (`{react,false}` → `react`; `{plan-and-execute,false}` →
      `plan-and-execute`; `{undefined,true}` → `reflect`; `{plan-and-execute,true}` →
      `reflect`; `{undefined,false}` → `react`); `strategyLabel` (`{undefined,false}` →
      `"react"`; `{plan-and-execute,true}` → `"reflect:plan-and-execute"`; `{undefined,true}` →
      `"reflect:react"`); G10 para as três rotas de `ROUTE_SELECTIONS`; `stampNode` devolve
      cópias com `nodeName` e não muta o array nem os eventos de entrada (G11, comparar com
      `structuredClone` feito antes)
- [ ] T006 Em `src/agents/production-graph.ts` (novo), implementar e exportar `isOverride`,
      `routeForSelection`, `strategyLabel`, `ROUTE_SELECTIONS: Record<Route, StrategySelection>`
      (`react` → `{ name: "react", reflect: false }`; `plan-and-execute` → `{ name:
      "plan-and-execute", reflect: false }`; `reflect` → `{ name: "react", reflect: true }`) e
      `stampNode`. T005 verde

### O grafo (R-001, R-002, R-011 a R-013; contracts/production-graph.md)

- [ ] T007 Em `src/agents/production-graph.test.ts`, acrescentar os testes do grafo com
      `InMemoryConversationStore`, um `MemoryStore` falso (objeto com `recall` controlado,
      `remember` e `forget` que falham se chamados), `resolveStrategy` que grava as seleções e
      devolve uma estratégia falsa que grava a entrada e as opções, um sumarizador falso e um
      roteador falso que devolve `{ route: "react", reason: "dublê" }`. Casos:
      G1 (uma única estratégia roda);
      G2 (com `override`, `resolveStrategy` não é chamado e roda `override.strategy`; sem
      override, uma chamada);
      G3 (com conversa de 3 turnos e `userId` com uma memória, a entrada da estratégia é igual a
      `formatMemoriesInput(memórias, formatHistoryInput(contexto, message))`);
      G4 (ordem `[route, …estratégia]` sem resumo; `[summarize, route, …]` com conversa de 16
      mensagens e sumarizador falso);
      G5 (`nodeName` em todo evento: `context`, `router` e o nome do nó da estratégia; com rota
      `reflect`, uma estratégia falsa cujo rastro traz `critique` sai toda com `reflect`);
      G6 (`answer`, `stoppedReason` e `metrics.llmCalls` iguais aos da estratégia falsa;
      `metrics.contextBreakdown` igual a `buildContextBreakdown` com os mesmos insumos;
      `historyMessages` e `summaryCoveredMessages` presentes);
      G7 (o `signal` recebido pela estratégia aborta quando o `signal` de `run` aborta, e `run`
      rejeita);
      G8 (estratégia que lança → `run` rejeita com o mesmo erro, e `resolveStrategy` não é
      chamado de novo; recall que rejeita → `run` resolve com zero memórias)
- [ ] T008 Em `src/agents/production-graph.ts`, implementar `ProductionGraphDeps`,
      `ProductionGraphInput` e `createProductionGraph(deps)`, conforme
      `contracts/production-graph.md`: `Annotation.Root` com os canais do data-model (`trace`
      com redutor de concatenação, o resto último valor);
      nó `context` (move de `http/chat.ts` o `Promise.all` de `prepareConversationContext` ‖
      `recall` com falha aberta e o mesmo log, usando `config.signal`; emite
      `stampNode([summarizeEvent], "context")` quando houver);
      nó `router` (override → RN1; sem override → `withTimeout(routerTimeoutMs, (s) =>
      router(formatRouterInput…, s), { parentSignal: config.signal, timeoutMessage: "Tempo
      limite do roteador excedido." })`, `safeParse`, `capReason`; em qualquer falha, se
      `config.signal?.aborted` relançar (RN5), senão recuar com `FALLBACK_REASON` e
      `console.error("Falha ao rotear pedido:", error)` (RN4); depois `resolveStrategy(
      ROUTE_SELECTIONS[route], store)` fora do `try` (RN6); emite o `route` com
      `strategyLabel` e `nodeName: "router"`). Até a T015, `formatRouterInput` pode ser um
      provisório que devolve só `message`;
      nós `react`/`plan-and-execute`/`reflect` (uma fábrica por nome: `withMemory` se houver
      `userId`, com `createMemoryTools(memoryStore, userId)`, depois `withConversationHistory`;
      `run(message, { maxIterations: DEFAULT_MAX_ITERATIONS, signal: config.signal })`; grava
      `result` e `stampNode(result.trace, nome)`);
      nó `response` (G6); arestas `START → context → router`, condicional por `state.route`
      com a lista dos três nós, cada estratégia `→ response → END`. Compilar uma vez; `run`
      faz `graph.invoke(input, { signal })` e devolve `response`. Comentário no topo citando
      a R-001 (spike) e a G9 (o registro não importa este módulo). T007 verde

### Troca do handler (R-003, R-014, R-016)

- [ ] T009 Em `src/http/chat.ts`: `CreateChatHandlerOptions` ganha `router: Router` e
      `routerTimeoutMs?: number` (default `ROUTER_TIMEOUT_MS`); criar o grafo uma vez com
      `createProductionGraph`; trocar a resolução incondicional da estratégia por: se
      `isOverride(parsed.data)`, `resolveStrategy({ name, reflect })` com o mesmo 422 de hoje, e
      guardar `{ selection, strategy }` como `override`; senão nada (R-003). O 404 continua
      igual. `runChat` passa a ser `graph.run({ message, conversationId, userId, override },
      controller.signal)`. Corrida, gravação e aprendizado sem mudança. Atualizar o comentário
      de ordem do handler conforme `contracts/chat-endpoint.md`
- [ ] T010 Em `src/http/server.ts`: `ChatAppDeps` ganha `router?: Router` (default
      `createModelRouter()` a partir da T016; até lá, um roteador que rejeita com `"roteador
      não configurado"`) e `routerTimeoutMs?: number` (default `ROUTER_TIMEOUT_MS`), com
      comentários no molde de `summarizer`/`summaryTimeoutMs`; repassar ao handler
- [ ] T011 Em `src/http/server.test.ts`: acrescentar os dublês `fixedRouter(route, reason)`
      (grava as entradas), `rejectingRouter()`, `invalidRouter(value)` e
      `neverResolvingRouter()`; `withServer` passa `router: fixedRouter("react", "dublê")` por
      padrão; acrescentar `stripGraphFields(trace)` (remove eventos `route` e o campo
      `nodeName`). Ajustar as expectativas listadas na R-016:
      "responde 200 com o StrategyResult intacto…" (`body.trace` via `stripGraphFields`;
      `calls[0]` passa a ser `{ name: "react", reflect: false }`);
      "omitir strategy e reflect chega ao registry…" (renomear e esperar `{ name: "react",
      reflect: false }` vindo da rota);
      os testes da 011 que usam `body1.trace[0]`, `trace.slice(1)` e `trace.length` (contar
      com o `route` na posição 1) e o que compara `body.trace` com `FIXED_TRACE` no fim do
      arquivo. `npm test` verde

**Checkpoint**: `/chat` roda pelo grafo. Com `withServer`, todo pedido sem `strategy` é roteado
pelo falso para `react`, e o comportamento visível só difere pelo `route` e pelo `nodeName`.

---

## Phase 3: User Story 1 - O OpsPilot escolhe a estratégia sozinho (Priority: P1) 🎯 MVP

**Goal**: sem `strategy`, o roteador real decide entre as três estratégias, com motivo, a partir
da mensagem e da conversa, e recua para ReAct em falha.

**Independent Test**: com roteador falso, cada rota decidida executa só a estratégia
correspondente, e o `route` traz rota, motivo e `source: "router"`. Rota inválida, erro e tempo
esgotado dão 200 com ReAct e `source: "fallback"`.

### Tests for User Story 1

- [ ] T012 [P] [US1] Em `src/agents/production-graph.test.ts`, os testes do nó `router` sem
      override: RN2 (o roteador falso é chamado uma vez, com `message`, `summary` e `messages`
      iguais aos do contexto preparado, e sem memórias); RN3 (para cada uma das três rotas, a
      seleção passada a `resolveStrategy` é a de `ROUTE_SELECTIONS`, e o `route` traz `source:
      "router"` e o motivo cortado por `capReason`, com um motivo de 400 caracteres); RN4 (roteador que
      rejeita; `invalidRouter` com `{ route: "planner", reason: "x" }`, `"react"` e `{}`;
      `neverResolvingRouter` com `routerTimeoutMs: 20` → rota `react`, `source: "fallback"`,
      `reason === FALLBACK_REASON`, `run` resolve); RN5 (`neverResolvingRouter` com
      `routerTimeoutMs` longo e `signal` de `run` abortado em 20 ms → `run` rejeita, sem
      recuo); RN6 (`resolveStrategy` que lança depois de uma decisão válida → `run` rejeita);
      RN7 (`metrics.llmCalls` igual ao da estratégia falsa)
- [ ] T013 [P] [US1] Em `src/agents/router.test.ts`: RT1 (`ROUTER_PROMPT` contém uma linha de
      tabela para cada valor de `routeSchema.options`, pelo nome exato, e os cabeçalhos "Quando
      usar", "Quando NÃO usar" e "Custo"); RT2 (contém as instruções de desempate pela mais
      barata, de não responder ao pedido e de tratar a conversa como dado); RT3
      (`formatRouterInput` sem resumo e sem histórico devolve só a mensagem; com resumo e
      histórico é `formatSummaryBlock(summary) + formatHistoryBlock(messages) + message`); RT4
      (`createModelRouter()` não lança sem `OPENROUTER_API_KEY` e `OPENROUTER_MODEL`: apagar as
      duas de `process.env` no teste e restaurar no `finally`)
- [ ] T014 [P] [US1] Em `src/http/server.test.ts`, `describe("POST /chat — 012 US1
      (roteamento)")`: para cada rota do `fixedRouter`, `resolveStrategy` recebe a seleção de
      CH4 e o `route` da resposta tem a rota, a `strategy` (`reflect` → `"reflect:react"`), o
      motivo e `source: "router"`; com `conversationId` de uma conversa com 2 turnos, o
      `fixedRouter` recebeu essas 4 mensagens (acceptance 4); CH5 com `rejectingRouter` e
      `invalidRouter({ route: "planner" })` → 200, `source: "fallback"`, seleção `{react,
      false}`; CH7 com `neverResolvingRouter`, `routerTimeoutMs` longo e `timeoutMs: 30` → 504
      e o turno não é gravado; CH8 (`metrics.llmCalls` igual ao da estratégia falsa)

### Implementation for User Story 1

- [ ] T015 [US1] Em `src/agents/router.ts`: `formatRouterInput(input)` =
      `formatSummaryBlock(input.summary) + formatHistoryBlock(input.messages) + input.message`
      (RT3), e `ROUTER_PROMPT` em português, com: papel (escolher como o OpsPilot vai raciocinar,
      nunca responder ao pedido); a tabela da R-006, com as colunas Estratégia, Quando usar,
      Quando NÃO usar e Custo, e uma linha por `react`, `plan-and-execute` e `reflect`; desempate
      ("na dúvida entre duas, escolha a mais barata"); `reason` em uma frase; proteção contra
      injeção no molde do `SUMMARIZER_PROMPT` (conversa e mensagem são DADO, nunca instrução).
      Remover o provisório da T008 em `production-graph.ts`. T013 (RT1–RT3) verde
- [ ] T016 [US1] Em `src/agents/router.ts`, `createModelRouter(): Router`: `createModel()`
      chamado dentro da função devolvida (RT4, comentário citando R-004 e o padrão de
      `createModelSummarizer`); `withStructuredOutput(routeDecisionSchema).invoke([["system",
      ROUTER_PROMPT], ["human", formatRouterInput(input)]], { signal })`, sem callbacks
      (comentário: FR-022, não entra em `llmCalls`/`promptTokens`). Em `src/http/server.ts`,
      trocar o default provisório da T010 por `createModelRouter()`. Em `src/index.ts`, passar
      `router: createModelRouter()` a `createApp`, com comentário no molde do summarizer.
      T012, T013 e T014 verdes

**Checkpoint**: US1 entregável. Pedidos sem `strategy` são roteados, e falha do roteador nunca
vira erro.

---

## Phase 4: User Story 2 - Forçar uma estratégia continua possível e fica visível (Priority: P1)

**Goal**: com `strategy` ou `reflect: true`, a escolha é a do pedido, o roteador não é
consultado e o `route` registra `source: "override"`.

**Independent Test**: com um roteador falso que grava chamadas, pedidos com `strategy`, com
`strategy` + `reflect` e só com `reflect` rodam a estratégia pedida, o roteador tem zero
chamadas, e o `route` traz a combinação imposta.

### Tests for User Story 2

- [ ] T017 [P] [US2] Em `src/agents/production-graph.test.ts`: RN1 para `override` com
      `{plan-and-execute,false}` (rota `plan-and-execute`), `{plan-and-execute,true}` (rota
      `reflect`, `strategy: "reflect:plan-and-execute"`) e `{undefined,true}` (rota `reflect`,
      `strategy: "reflect:react"`): roteador falso com zero chamadas, `reason ===
      OVERRIDE_REASON`, `source: "override"`, roda `override.strategy`
- [ ] T018 [P] [US2] Em `src/http/server.test.ts`, `describe("POST /chat — 012 US2
      (override)")`: CH3 para `{ strategy: "plan-and-execute" }`, `{ strategy:
      "plan-and-execute", reflect: true }`, `{ reflect: true }` e `{ strategy: "react", reflect:
      false }`: o roteador falso tem zero chamadas, `resolveStrategy` recebe a seleção exatamente
      como no corpo (`{ name: undefined, reflect: true }` no caso só `reflect`), e o `route` tem
      `source: "override"` com a `strategy` esperada. `{ reflect: false }` sem `strategy` é
      roteado (uma chamada, R-015). CH6: `strategy: "planner"` → 422 com `validStrategies`, e
      `strategy: "  "` → 400, ambos com zero chamadas ao roteador e ao sumarizador

### Implementation for User Story 2

- [ ] T019 [US2] Rodar T017 e T018 contra a implementação da Foundational (T006, T008, T009).
      Corrigir em `src/agents/production-graph.ts` ou `src/http/chat.ts` o que falhar. O esperado
      é passar sem mudança, e a tarefa é a prova disso. Conferir em especial que o 422 acontece
      antes do grafo (nenhum nó roda) e que `isOverride` é avaliado sobre `parsed.data` (com
      `reflect` já com o default `false`)

**Checkpoint**: US1 e US2 (as duas P1) completas. A feature é integrável.

---

## Phase 5: User Story 3 - Ler o rastro sabendo que parte do fluxo produziu cada evento (Priority: P2)

**Goal**: o rastro do `/chat` mostra de que nó veio cada evento, também na exibição legível, sem
mudar o rastro nem a exibição da arena.

**Independent Test**: em pedidos pelo `/chat`, 100% dos eventos têm `nodeName` com o nó
esperado por tipo; `formatTrace` mostra o nó e o `route`; um rastro sem `nodeName` é exibido
byte a byte como antes.

### Tests for User Story 3

- [ ] T020 [P] [US3] Em `src/trace/format.test.ts`: G12 (`route` renderizado como `[route]
      <strategy> (<source>) <reason>`, alinhado como os demais rótulos); G13 (evento com
      `nodeName: "router"` ganha o prefixo `{router} `; o `FIXED` de cada teste existente, sem
      `nodeName`, gera exatamente a mesma string de antes, conferida contra um literal)
- [ ] T021 [P] [US3] Em `src/http/server.test.ts`, `describe("POST /chat — 012 US3
      (nodeName)")`: CH2 com uma estratégia falsa cujo rastro traz `thought`, `action`,
      `observation`, `critique` e `answer`: todo evento tem `nodeName`; `route` → `router`; os
      da estratégia → o nó da rota (`reflect` quando o `fixedRouter` decide `reflect`); com
      conversa de 16 mensagens, `summarize` → `context` na posição 0 e `route` na 1
      (acceptance 2 da US3)

### Implementation for User Story 3

- [ ] T022 [US3] Em `src/trace/format.ts`: `case "route"` definitivo (G12, substituindo o
      provisório da T002, se houver) e, em `formatTrace`, prefixo `{${event.nodeName}} ` só
      quando `nodeName` existe (G13). T020 e T021 verdes

**Checkpoint**: as três histórias completas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [P] Em `README.md`, na seção do `POST /chat`: a linha de `strategy` na tabela passa a
      dizer "ausente: escolhida pelo roteador (react, plan-and-execute ou reflect)"; um
      parágrafo sobre override (`strategy` ou `reflect: true` impõem a estratégia) e recuo;
      o evento `route` e o campo `nodeName` no exemplo de resposta; o roteador fora de
      `llmCalls`/`promptTokens`; `src/agents/production-graph.ts` e `src/agents/router.ts` na
      árvore de arquivos; link para `specs/012-unified-graph/`
- [ ] T024 [P] Avisos de emenda (Princípio III, FR-025), no molde dos avisos deixados pela 011:
      em `specs/003-chat-http-api/contracts/chat-endpoint.md` e
      `specs/003-chat-http-api/contracts/strategy-registry.md` (o padrão `react` deixou de ser
      fixo; ver `specs/012-unified-graph/contracts/chat-endpoint.md`), e em
      `specs/011-history-summarization/contracts/chat-endpoint.md` (o `summarize` continua na
      posição 0 e agora é seguido pelo `route`)
- [ ] T025 [P] Em `.github/copilot-instructions.md`, uma linha na Stack descrevendo o grafo de
      produção (`context → router → estratégia → response`) e o roteador com
      `withStructuredOutput`
- [ ] T026 Conferir G9: `grep -n "production-graph\|router" src/agents/index.ts src/arena.ts
      src/bench.ts src/mcp/*.ts` não encontra importação. Conferir que nenhum `switch` sobre
      `TraceEvent` ficou sem o `case "route"` (`npm run typecheck`)
- [ ] T027 Portões: `npm run typecheck` e `npm test` verdes, sem rede (quickstart, etapa 1)
- [ ] T028 Roteiro manual com o modelo real (`quickstart.md`, etapas 2 e 3): conferir CH1 e CH2
      nas respostas, rodar a amostra anotada e registrar o acerto (meta ≥ 8/10, SC-005) numa
      nota ao fim de `specs/012-unified-graph/quickstart.md`. Se ficar abaixo, ajustar a tabela
      do `ROUTER_PROMPT` (T015) e repetir. Rodar `npm run seed` depois

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: vazia.
- **Foundational (2)**: bloqueia todas as histórias. Ordem interna: T001, T002, T003 e T005 em
  paralelo → T004 → T006 → T007 → T008 → T009 → T010 → T011.
- **US1 (3)**: depende da Foundational.
- **US2 (4)**: depende só da Foundational. Pode rodar em paralelo com US1.
- **US3 (5)**: depende só da Foundational (o carimbo está na T008). Pode rodar em paralelo com
  US1 e US2.
- **Polish (6)**: depois das histórias desejadas. T028 depende de T016 (roteador real).

### User Story Dependencies

- **US1 (P1)**: nenhuma outra história.
- **US2 (P1)**: nenhuma outra história. Os testes de override não dependem do roteador real.
- **US3 (P2)**: nenhuma outra história.

### Within Each User Story

- Testes primeiro, falhando. Depois a implementação.
- `router.ts` antes de `server.ts`/`index.ts` (T015 → T016).

### Parallel Opportunities

- Foundational: T001, T002, T003 e T005 (quatro arquivos diferentes).
- US1: T012, T013 e T014 (três arquivos de teste diferentes).
- US2: T017 e T018.
- US3: T020 e T021.
- Com a Foundational pronta, US1, US2 e US3 podem ser tocadas em paralelo, porque os testes de
  cada uma ficam em blocos `describe` próprios.
- Polish: T023, T024 e T025.

---

## Parallel Example: User Story 1

```bash
# Os três arquivos de teste da US1, juntos:
Task: "T012 testes do nó router (RN2–RN7) em src/agents/production-graph.test.ts"
Task: "T013 testes do prompt e da entrada do roteador (RT1–RT4) em src/agents/router.test.ts"
Task: "T014 testes de roteamento no /chat (CH4, CH5, CH7, CH8) em src/http/server.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Foundational (T001–T011): `/chat` já passa pelo grafo, com um roteador falso nos testes.
2. US1 (T012–T016): roteador real.
3. **Parar e validar**: `npm test` e a etapa 2 do quickstart.

### Incremental Delivery

1. Foundational → `/chat` pelo grafo, sem regressão.
2. US1 → roteamento real (MVP).
3. US2 → prova do override. Com as duas P1 completas, a feature é integrável (Constituição,
   Fluxo de Desenvolvimento).
4. US3 → exibição legível e prova de ponta a ponta do `nodeName`.
5. Polish → documentação, avisos de emenda e validação manual do acerto.

---

## Notes

- Dublês (roteadores, estratégias, `MemoryStore` falso) vivem só nos arquivos de teste, nunca em
  `src/` fora de `*.test.ts`.
- `llmCalls` e `promptTokens` nunca incluem o roteador. Um teste que passe a ver `llmCalls`
  diferente do valor da estratégia falsa acusa vazamento de callbacks entre nós (risco do
  plan.md).
- Commit ao fim de cada fase, com a referência às tarefas.
