# Data Model: Grafo Unificado com Roteador

**Feature**: 012-unified-graph | **Date**: 2026-09-22

Nenhuma tabela nova, nenhuma mudança no banco. Tudo abaixo vive em memória, dentro de um
pedido.

## Entidades de domínio (`src/domain/schemas.ts`)

| Esquema | Definição | Regras |
|---|---|---|
| `routeSchema` | `z.enum(["react", "plan-and-execute", "reflect"])` | Conjunto fechado das rotas do roteador (FR-007) |
| `routeDecisionSchema` | `z.object({ route: routeSchema, reason: z.string() })` | Cada campo com `.describe()`. `reason` sem `.max()`: é cortado por `capReason`, nunca rejeitado (FR-013, R-005) |
| `routeSourceSchema` | `z.enum(["router", "override", "fallback"])` | Origem da escolha (FR-017) |
| `nodeNameSchema` | `z.enum(["context", "router", "react", "plan-and-execute", "reflect", "response"])` | Nós do grafo (FR-020) |
| `ROUTE_REASON_MAX_CHARS` | `300` | Teto do motivo registrado |

Tipos derivados por `z.infer`: `Route`, `RouteDecision`, `RouteSource`, `NodeName`.

## Rastro (`src/trace/types.ts`)

```ts
type TraceEvent = (
  | …eventos atuais…
  | { type: "route"; route: Route; strategy: string; reason: string; source: RouteSource }
) & { nodeName?: NodeName };
```

| Campo do `route` | Significado |
|---|---|
| `route` | Nó de estratégia que rodou |
| `strategy` | Combinação executada, no vocabulário do registro: `react`, `plan-and-execute`, `reflect:react`, `reflect:plan-and-execute` |
| `reason` | Motivo do roteador depois de `capReason`, ou o texto fixo de override ou de recuo |
| `source` | `router`, `override` ou `fallback` |

`nodeName` é opcional no tipo. No `/chat`, está presente em todo evento. Na arena, no bench e no
MCP, está sempre ausente.

## Roteador (`src/agents/router.ts`)

```ts
interface RouterInput {
  message: string;
  summary: string | null;             // ConversationContext.summary (011)
  messages: ConversationMessage[];    // ConversationContext.messages (011)
}
type Router = (input: RouterInput, signal: AbortSignal) => Promise<unknown>;
```

| Símbolo | Tipo | Papel |
|---|---|---|
| `ROUTER_PROMPT` | `string` | Instruções com a tabela (R-006) |
| `formatRouterInput(input)` | puro | `formatSummaryBlock` + `formatHistoryBlock` + mensagem |
| `capReason(text)` | puro | `trim` e corte em 300 com `…` |
| `ROUTER_TIMEOUT_MS` | `15_000` | Limite próprio (R-007) |
| `FALLBACK_REASON`, `OVERRIDE_REASON` | `string` | Motivos fixos (R-008, R-010) |
| `createModelRouter()` | `Router` | Real, com `withStructuredOutput(routeDecisionSchema)`, sem ler env na construção |

## Estado do grafo (`src/agents/production-graph.ts`)

| Canal | Tipo | Escrito por | Redutor |
|---|---|---|---|
| `message` | `string` | entrada | último valor |
| `conversationId` | `string \| undefined` | entrada | último valor |
| `userId` | `string \| undefined` | entrada | último valor |
| `override` | `{ selection: StrategySelection; strategy: ReasoningStrategy } \| undefined` | entrada (handler, R-003) | último valor |
| `conversationContext` | `ConversationContext` | `context` | último valor |
| `memories` | `RecalledMemory[]` | `context` | último valor |
| `route` | `Route` | `router` | último valor |
| `strategy` | `ReasoningStrategy` | `router` | último valor |
| `trace` | `TraceEvent[]` | `context`, `router`, nó de estratégia | concatenação |
| `result` | `StrategyResult` | nó de estratégia | último valor |
| `response` | `StrategyResult` | `response` | último valor |

## Funções puras

| Função | Entrada → saída | Regra |
|---|---|---|
| `isOverride(body)` | `{ strategy?, reflect }` → `boolean` | `strategy !== undefined \|\| reflect === true` (R-015) |
| `routeForSelection(selection)` | `StrategySelection` → `Route` | `reflect` → `"reflect"`; `name === "plan-and-execute"` → `"plan-and-execute"`; senão `"react"` |
| `strategyLabel(selection)` | `StrategySelection` → `string` | `${reflect ? "reflect:" : ""}${name ?? "react"}` |
| `ROUTE_SELECTIONS[route]` | `Route` → `StrategySelection` | Tabela da R-002 |
| `stampNode(events, node)` | `TraceEvent[]`, `NodeName` → `TraceEvent[]` | Cópias com `nodeName`, sem mutar a entrada |

Invariante: para toda rota `r`, `routeForSelection(ROUTE_SELECTIONS[r]) === r`.

## Fluxo de um pedido

```text
handler: parse (400) → [override? resolveStrategy → 422] → conversa (404)
  → graph.invoke({ message, conversationId, userId, override }, { signal })
      START → context → router ─┬─> react ────────────┐
                                ├─> plan-and-execute ─┼─> response → END
                                └─> reflect ──────────┘
  → prazo (504) / falha (500) / gravação do turno → 200 → aprendizado
```

### Decisão no nó `router`

```text
override presente?
  sim → route = routeForSelection(override.selection), source = "override",
        strategy = override.strategy, reason = OVERRIDE_REASON   (roteador não é chamado)
  não → withTimeout(ROUTER_TIMEOUT_MS, router(entrada), parentSignal)
          ok e safeParse ok → route = decisão.route, source = "router", reason = capReason(decisão.reason)
          qualquer falha    → route = "react", source = "fallback", reason = FALLBACK_REASON, log
        strategy = resolveStrategy(ROUTE_SELECTIONS[route], store)
emite { type: "route", route, strategy: strategyLabel(seleção), reason, source, nodeName: "router" }
```

## Métricas

Nenhum campo novo em `RunMetrics`. `metrics` vem do resultado da estratégia (com
`historyMessages`, `summaryCoveredMessages` e `recalledMemories` dos decoradores), mais
`contextBreakdown`, acrescentado no nó `response`. O roteador não entra em `llmCalls`,
`promptTokens` nem `latencyMs` (R-012).
