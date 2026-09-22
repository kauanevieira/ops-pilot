# Contract: Grafo de produção

**Feature**: `012-unified-graph` | Satisfaz FR-001 a FR-006, FR-017 a FR-021, FR-024

Módulo: `src/agents/production-graph.ts`. Único consumidor: `src/http/chat.ts`.

## Interface

```ts
interface ProductionGraphDeps {
  store: OpsRepository;
  conversationStore: ConversationStore;
  memoryStore: MemoryStore;
  resolveStrategy: ResolveStrategy;
  summarizer: Summarizer;
  summaryTimeoutMs: number;
  router: Router;
  routerTimeoutMs: number;
}

interface ProductionGraphInput {
  message: string;
  conversationId?: string;   // já validado como existente pelo handler (404 antes)
  userId?: string;
  override?: { selection: StrategySelection; strategy: ReasoningStrategy };
}

function createProductionGraph(deps: ProductionGraphDeps): {
  run(input: ProductionGraphInput, signal: AbortSignal): Promise<StrategyResult>;
};
```

`createProductionGraph` compila o grafo uma vez. `run` invoca o grafo e devolve o canal
`response`.

## Nós

| Nó | Faz | Escreve |
|---|---|---|
| `context` | `prepareConversationContext` (com `conversationId`) ‖ `recall` (com `userId`), ambos com falha aberta | `conversationContext`, `memories`, `trace` += `[summarize?]` carimbado `context` |
| `router` | Decide a rota (ver [router.md](./router.md)) e resolve a estratégia | `route`, `strategy`, `trace` += `[route]` |
| `react` / `plan-and-execute` / `reflect` | `withConversationHistory(withMemory?(strategy))` → `run(message, { maxIterations: DEFAULT_MAX_ITERATIONS, signal })` | `result`, `trace` += rastro da estratégia carimbado com o nome do nó |
| `response` | Monta o `StrategyResult` final | `response` |

Arestas: `START → context → router`; `router → state.route` (condicional); cada nó de estratégia
`→ response → END`.

## Garantias

- **G1**: exatamente um nó de estratégia roda por `run` (FR-004).
- **G2**: `resolveStrategy` é chamado no máximo uma vez por `run`, e nunca quando há `override`.
  Com `override`, a estratégia executada é `override.strategy`.
- **G3**: a entrada que a estratégia recebe é byte a byte igual à que o handler compunha antes
  desta feature, para o mesmo contexto: memórias, resumo, histórico e mensagem (FR-003).
- **G4**: `response.trace` = eventos de `context` ++ `[route]` ++ rastro da estratégia, nessa
  ordem. `route` aparece exatamente uma vez. `summarize`, quando existe, fica na posição 0 e
  `route` na 1. Sem `summarize`, `route` fica na 0 (FR-017, FR-019).
- **G5**: todo evento de `response.trace` tem `nodeName` (FR-020): `summarize` → `context`;
  `route` → `router`; os demais → o nó de estratégia que rodou. Com `reflect`, isso inclui os
  `critique` e os eventos das tentativas de base.
- **G6**: `response.answer` e `response.stoppedReason` são os da estratégia. `response.metrics`
  é o `metrics` da estratégia mais `contextBreakdown`, calculado por `buildContextBreakdown` com
  a mensagem, o contexto e as memórias do estado (FR-005).
- **G7**: o `signal` de `run` chega a `prepareConversationContext`, ao roteador e ao `run` da
  estratégia. Abortá-lo rejeita `run` (FR-006).
- **G8**: uma exceção de um nó de estratégia (falha técnica) rejeita `run` sem tentar outra
  estratégia. Falhas do roteador, da sumarização e do recall nunca rejeitam `run`.
- **G9**: as estratégias e o registro (`agents/index.ts`) não importam este módulo. Arena, bench
  e MCP não passam por ele, e o rastro deles não tem `route` nem `nodeName` (FR-024).

## Funções puras exportadas

`isOverride`, `routeForSelection`, `strategyLabel`, `ROUTE_SELECTIONS`, `stampNode`. Definições
em [data-model.md](../data-model.md#funções-puras).

- **G10**: `routeForSelection(ROUTE_SELECTIONS[r]) === r` para as três rotas.
- **G11**: `stampNode` não muta o array nem os eventos recebidos.

## Exibição (`src/trace/format.ts`)

- **G12**: `formatEvent` tem `case "route"`: `[route]       <strategy> (<source>) <reason>`.
- **G13**: `formatTrace` prefixa `{<nodeName>} ` quando o evento tem `nodeName`. Sem ele, a
  linha fica idêntica à de antes (a arena não muda).
