# Research: Grafo Unificado com Roteador

**Feature**: 012-unified-graph | **Date**: 2026-09-22

Verificado no ambiente: Node v22.22.2, `@langchain/langgraph` 1.4.15, `@langchain/core` 1.2.11.

---

## R-001 — O grafo externo é um `StateGraph` do LangGraph, compilado uma vez

**Decision**: `src/agents/production-graph.ts` monta um `StateGraph` com os nós `context`,
`router`, `react`, `plan-and-execute`, `reflect` e `response`, e uma aresta condicional do
`router` para o nó da estratégia. O grafo é compilado uma vez, em `createChatHandler`, e
invocado por pedido com `graph.invoke(entrada, { signal })`. Não há checkpointer.

**Rationale**: o pedido nomeia um grafo com nós, e o LangGraph já é dependência (é o motor do
ReAct e do Plan-and-Execute). Um spike offline (script descartável, rodado com `tsx`) confirmou
três pontos:

1. Um grafo compilado rodado dentro de um nó de outro grafo, com `stream` e `recursionLimit`
   próprios, funciona sem checkpointer e devolve o estado final.
2. Um `BaseCallbackHandler` passado explicitamente ao grafo interno conta só as chamadas do
   interno. Uma chamada de modelo feita em outro nó, sem callbacks, não chega a ele.
3. Abortar o `signal` do `invoke` externo durante um nó lento rejeita o `invoke` com
   `AbortError` em cerca de 50 ms, e o `config.signal` que o nó recebe também é abortado.

**Alternatives considered**:
- Pipeline de funções `async` em sequência, sem LangGraph: mais simples, mas não é o grafo
  pedido, e perde a aresta condicional explícita que documenta o roteamento.
- Compilar o grafo a cada pedido: custo inútil. As dependências são fixas por app, e o que
  varia por pedido entra pelo estado.

## R-002 — Os nós de estratégia rodam o `ReasoningStrategy` que o registro já resolve

**Decision**: os três nós de estratégia são a mesma função, parametrizada pelo nome do nó. Ela
pega a estratégia resolvida no estado, aplica `withMemory` (com `userId`) e
`withConversationHistory` na mesma ordem de hoje, e chama `run(message, { maxIterations,
signal })`. O mapeamento de rota para seleção do registro é uma tabela constante:

| rota | seleção passada a `resolveStrategy` |
|---|---|
| `react` | `{ name: "react", reflect: false }` |
| `plan-and-execute` | `{ name: "plan-and-execute", reflect: false }` |
| `reflect` | `{ name: "react", reflect: true }` |

**Rationale**: `resolveStrategy` continua sendo o único ponto que monta estratégias, com
`withIncidentConfirmation` por baixo (005) e `withReflection` por cima quando pedido. Continua
injetável, então os testes do `/chat` seguem usando estratégias falsas. A ordem dos decoradores
(memória dentro de histórico, ambos por fora da reflexão) é a mesma da 007, 008 e 011, e
pelo mesmo motivo: `withReflection` reconstrói `metrics` a cada retorno.

**Alternatives considered**:
- Nós que chamam diretamente `createReactStrategy`/`createPlanAndExecuteStrategy`: duplica
  o registro e tira a injeção que torna o `/chat` testável offline.
- Explodir as estratégias em subnós do grafo externo (agente, ferramentas, planejador…): muda
  as estratégias e quebra arena, bench e MCP, que as rodam sozinhas (FR-024).

## R-003 — O 422 continua antes do grafo; a estratégia é resolvida uma vez por pedido

**Decision**: com override (`strategy` presente ou `reflect: true`), o handler chama
`resolveStrategy(seleção)` antes do grafo, como hoje. `UnknownStrategyError` vira 422 antes de
qualquer nó rodar, e a estratégia resolvida entra no estado como `override`. Sem override, a
estratégia é resolvida pelo nó `router`, depois da decisão, com a seleção da tabela da R-002.
Em ambos os casos, `resolveStrategy` é chamado exatamente uma vez por pedido.

**Rationale**: FR-016 exige os mesmos erros, antes de qualquer execução. A ordem atual do
handler (400 → 422 → 404 → execução) não muda. Uma falha de `resolveStrategy` dentro do nó
`router` só aconteceria com o registro quebrado, e é tratada como falha técnica (500), não como
falha do roteador.

**Alternatives considered**: validar o nome contra `baseStrategyNames()` no handler e resolver
sempre dentro do grafo. Duplica a fonte de verdade do 422, que hoje é o próprio registro (e o
dublê que os testes injetam no lugar dele).

## R-004 — O roteador é uma função injetável que devolve `unknown`, validada no nó

**Decision**:

```ts
type Router = (input: RouterInput, signal: AbortSignal) => Promise<unknown>;
```

O real (`createModelRouter`) usa `createModel().withStructuredOutput(routeDecisionSchema)`. O
nó `router` sempre valida o retorno com `routeDecisionSchema.safeParse`, venha do real ou de um
falso. `createModel()` é chamado dentro da função devolvida, nunca na construção, como no
sumarizador (011) e no destilador (009).

**Rationale**: a saída do modelo é entrada externa e passa por zod na borda (Restrições
Técnicas). Tipar o retorno como `unknown` deixa um teste entregar `{ route: "planner" }` sem
cast e exercita o recuo pelo mesmo caminho da produção. Construir o default sem ler variáveis
de ambiente mantém `createApp()` construível sem credenciais (Princípio V).

**Alternatives considered**: `Promise<RouteDecision>` confiando no `withStructuredOutput`.
Deixa o falso contornar a validação, e o teste de rota inválida precisaria de cast.

## R-005 — O esquema da decisão vive no domínio, com enum e `.describe()`

**Decision**: em `src/domain/schemas.ts`:

- `routeSchema = z.enum(["react", "plan-and-execute", "reflect"])`
- `routeDecisionSchema = z.object({ route, reason })`, com `.describe()` em cada campo, e
  `reason: z.string()` sem limite de tamanho.
- `routeSourceSchema = z.enum(["router", "override", "fallback"])`
- `nodeNameSchema = z.enum(["context", "router", "react", "plan-and-execute", "reflect",
  "response"])`
- `ROUTE_REASON_MAX_CHARS = 300`

**Rationale**: Princípio I (entidade definida uma vez em zod, no domínio). O roteador não é uma
ferramenta, mas o esquema chega ao modelo como definição de saída estruturada, então valem os
mesmos cuidados do Princípio IV: `route` é enum, e todo campo tem descrição. `reason` não tem
`.max()` porque FR-013 manda cortar, não rejeitar. Um `.max(300)` transformaria um motivo longo
em falha e mandaria o pedido para o recuo.

## R-006 — O prompt do roteador tem uma tabela e recebe a conversa como dado

**Decision**: `ROUTER_PROMPT` (mensagem `system`) traz:

1. o papel (escolher como o OpsPilot vai raciocinar, sem responder ao pedido);
2. uma tabela Markdown com as colunas estratégia, quando usar, quando NÃO usar e custo
   relativo;
3. o critério de desempate: na dúvida entre duas, a mais barata;
4. a proteção contra injeção.

A conversa entra num turno `human` separado, montado por `formatRouterInput` com os mesmos
blocos que a estratégia recebe (`formatSummaryBlock` e `formatHistoryBlock`), seguidos da
mensagem atual. Memórias não entram.

Tabela (conteúdo, a redação final fica no código):

| Estratégia | Quando usar | Quando NÃO usar | Custo |
|---|---|---|---|
| `react` | Consulta direta, só de leitura: listar alertas ou incidentes, ver o status de um provedor, consultar um runbook | Pedido que encadeia várias etapas dependentes, ou que abre ou resolve incidente | Baixo (1–3 chamadas) |
| `plan-and-execute` | Várias etapas em que uma depende do resultado da outra: investigar, descobrir o responsável e então agir | Consulta de uma etapa só | Médio (planejador + uma execução por passo + revisões) |
| `reflect` | Pedido com efeito colateral (abrir, resolver) ou em que uma resposta errada é cara, quando vale revisar antes de entregar | Consulta só de leitura | Alto (até 3× o ReAct + o crítico) |

**Rationale**: FR-009 e FR-010. Reusar os blocos garante que o roteador veja a conversa com a
mesma forma que a estratégia vai ver. Um pedido de continuação ("e agora abre o incidente") é
classificado pelo que a conversa estabeleceu. As memórias ficam de fora (Assumptions da spec).

## R-007 — Tempo limite próprio de 15 s, com o `withTimeout` da 011

**Decision**: `ROUTER_TIMEOUT_MS = 15_000`, aplicado com `withTimeout(…, { parentSignal })` de
`src/lib/with-timeout.ts`. Injetável como `routerTimeoutMs` em `ChatAppDeps`.

**Rationale**: o roteador fica no caminho crítico de todo pedido sem override, e a saída dele é
de poucas dezenas de tokens. 15 s é metade do sumarizador (30 s) e fica bem abaixo do prazo de
180 s. `withTimeout` já resolve o problema do `AbortSignal.timeout()` com `node:test` e já
propaga o cancelamento do pedido.

## R-008 — O recuo vai para `react`, com motivo fixo, e a falha vai para o log

**Decision**: erro, tempo esgotado ou falha do `safeParse` levam a `{ route: "react", source:
"fallback", reason: "Roteador indisponível; seguindo com react." }`, com
`console.error("Falha ao rotear pedido:", error)`. A mensagem do erro não entra no motivo.

**Rationale**: FR-012. O motivo fixo evita vazar para o cliente detalhes do provedor, como a
mensagem da exceção, que pode trazer URL ou corpo de resposta. O log guarda o detalhe.

## R-009 — `capReason`: aparar e cortar em 300 com reticências

**Decision**: função pura em `router.ts`, no mesmo molde de `capSummary`. `trim`, e acima de
`ROUTE_REASON_MAX_CHARS` corta em 299 caracteres e acrescenta `…`. Um motivo vazio fica
vazio e não conta como falha.

**Rationale**: FR-013 e o edge case "motivo vazio ou longo demais". O motivo só explica a
escolha, não decide nada.

## R-010 — O evento `route`

**Decision**:

```ts
{ type: "route"; route: Route; strategy: string; reason: string; source: RouteSource; nodeName: "router" }
```

`route` é o nó de estratégia que roda. `strategy` é o nome completo da combinação executada,
derivado da seleção com a convenção do registro: `react`, `plan-and-execute`, `reflect:react`
ou `reflect:plan-and-execute`. Em override, o motivo é fixo: `"Estratégia imposta pelo
pedido."`

**Rationale**: FR-017 e FR-018. `route` sozinho não distingue um override de
`plan-and-execute` com reflexão de um `reflect` roteado (ambos rodam no nó `reflect`).
`strategy` completa a informação com o mesmo vocabulário da arena (`reflect:plan-and-execute`).
O nome vem da seleção, não de `strategy.name`, para não depender do nome que um dublê de teste
declara.

## R-011 — `nodeName` é carimbado pelo grafo, não pelas estratégias

**Decision**: `TraceEvent` passa a ser a união atual `& { nodeName?: NodeName }`. Cada nó
carimba os eventos que acrescenta ao canal `trace` do estado, com `stampNode(events, node)`, uma
função pura que devolve cópias. O canal `trace` usa o redutor de concatenação.

- `context` carimba o `summarize`.
- `router` emite o `route` já carimbado.
- O nó de estratégia carimba todo o rastro da estratégia com o próprio nome, inclusive os
  `critique` e as tentativas de base dentro de `reflect`.
- `response` não acrescenta eventos. O nome existe no enum porque é um nó do grafo, e qualquer
  evento que ele venha a emitir já tem nome reservado.

**Rationale**: FR-020 e FR-024. As estratégias continuam sem saber do grafo, então arena, bench
e MCP produzem exatamente o rastro de hoje, sem `nodeName`. Campo opcional, sem quebrar nenhum
consumidor atual.

**Alternatives considered**: um campo `nodeName` obrigatório. Obrigaria as estratégias e o
`messagesToTrace` a conhecer os nós, e mudaria a saída da arena.

## R-012 — O roteador não entra em `llmCalls`, `promptTokens` nem `latencyMs`

**Decision**: o roteador não recebe `LlmCallCounter`. `metrics` continua vindo do resultado da
estratégia, mais `contextBreakdown` acrescentado no nó `response`.

**Rationale**: FR-022, com o mesmo raciocínio da 011 (SM3). O spike da R-001 confirmou que a
chamada feita no nó `router`, sem callbacks, não chega ao contador de outro nó. `latencyMs`
continua sendo medido pela estratégia. O tempo do roteador aparece no tempo total do pedido,
visto pelo cliente.

## R-013 — O nó `context` concentra contexto de conversa e recall, em paralelo

**Decision**: o nó `context` executa, em `Promise.all`, `prepareConversationContext` (011) e
`memoryStore.recall` (008), com as mesmas regras de falha aberta, e grava no estado
`conversationContext`, `memories` e o evento `summarize` carimbado, quando houver. O `router`
vem depois, porque depende do contexto da conversa.

**Rationale**: FR-002. É o bloco que hoje abre o `runChat` em `chat.ts`, movido para dentro do
grafo sem mudar o comportamento. O roteador acrescenta sua latência depois da preparação do
contexto. Rodá-lo em paralelo com o recall economizaria o tempo do recall, mas exigiria dividir
o nó de contexto em dois. Fica anotado como otimização possível, fora de escopo.

## R-014 — O handler encolhe para as bordas

**Decision**: `createChatHandler` mantém parse (400), override e 422, 404, a corrida contra o
prazo (504/500), a gravação do turno e o refletor de aprendizado. O `runChat` é substituído por
`graph.invoke({ message, conversationId, userId, override }, { signal: controller.signal })`,
que devolve o `StrategyResult` montado pelo nó `response`.

**Rationale**: FR-005 e FR-006. Gravação, prazo e aprendizado são borda HTTP e ficam onde estão.
Qualquer exceção do grafo segue o mesmo caminho de hoje (500), e o aborto segue a corrida atual
(504).

## R-015 — `reflect: true` sozinho é override; `reflect: false` explícito não é

**Decision**: override quando `strategy !== undefined || reflect === true`. A seleção é
passada como vem, e o registro aplica o padrão `react`.

**Rationale**: assumption da spec. `chatRequestSchema` já transforma a ausência de `reflect` em
`false`, então `reflect: false` explícito é indistinguível da ausência. Os dois significam "não
pedi reflexão", e o pedido é roteado.

## R-016 — Testes existentes que mudam de expectativa

**Decision**: `withServer` passa a injetar um roteador falso por padrão
(`fixedRouter("react", …)`). Mudam de expectativa:

- os testes que conferem `calls[0].name === undefined` quando `strategy` é omitida: agora
  chega `{ name: "react", reflect: false }`, vindo da tabela da R-002;
- os testes que comparam `body.trace` com `FIXED_TRACE` inteiro, ou fatiam o rastro a partir
  de uma posição (011): agora o rastro traz o `route` e o `nodeName` em cada evento.

Um auxiliar `stripGraphFields(trace)` remove o `route` e o `nodeName`, para que as asserções
sobre o conteúdo da estratégia continuem legíveis.

**Rationale**: a mudança de comportamento é a finalidade da feature (Assumptions da spec). As
demais asserções (métricas, persistência, 404, 504, aprendizado) não mudam.

## R-017 — Exibição legível

**Decision**: `formatEvent` ganha `case "route"`, com a linha `[route]       reflect:react
(router) motivo…`. `formatTrace` prefixa `nodeName` entre chaves quando presente (`{router}
[route] …`). Sem `nodeName`, a linha fica byte a byte igual à de hoje, e a arena não muda.

## R-018 — Validação do acerto do roteador (SC-005) é manual

**Decision**: `quickstart.md` traz uma amostra anotada de 10 pedidos com a rota esperada e um
laço de `curl` que imprime rota, origem e motivo. O acerto é conferido à mão contra o servidor
real. Nenhum script novo.

**Rationale**: Princípio V. A suíte não chama o modelo. Um script dedicado só se justificaria
se a avaliação fosse recorrente, e o bench é o lugar certo para isso numa feature futura (fora
de escopo na spec).
