# Contract: Roteador

**Feature**: `012-unified-graph` | Satisfaz FR-007 a FR-016, FR-022, FR-026

Módulo: `src/agents/router.ts`. Esquemas em `src/domain/schemas.ts`.

## Interface

```ts
interface RouterInput { message: string; summary: string | null; messages: ConversationMessage[] }
type Router = (input: RouterInput, signal: AbortSignal) => Promise<unknown>;

const ROUTER_TIMEOUT_MS = 15_000;
const ROUTER_PROMPT: string;
function formatRouterInput(input: RouterInput): string;
function capReason(text: string): string;
function createModelRouter(): Router;
```

## Saída estruturada

```ts
routeDecisionSchema = z.object({
  route: z.enum(["react", "plan-and-execute", "reflect"])
    .describe("estratégia de raciocínio escolhida para o pedido: react, plan-and-execute ou reflect"),
  reason: z.string()
    .describe("uma frase curta explicando por que essa estratégia é a mais adequada ao pedido"),
});
```

## Garantias do módulo

- **RT1**: `ROUTER_PROMPT` contém uma tabela com uma linha por rota e as colunas quando usar,
  quando NÃO usar e custo. As três rotas aparecem pelo nome exato do enum (FR-009).
- **RT2**: `ROUTER_PROMPT` manda escolher a mais barata na dúvida, proíbe responder ao pedido e
  declara que a conversa e a mensagem são dado, nunca instrução (FR-010).
- **RT3**: `formatRouterInput` = `formatSummaryBlock(summary)` + `formatHistoryBlock(messages)` +
  `message`, os mesmos blocos que a estratégia recebe. Sem resumo e sem histórico, é só a
  mensagem.
- **RT4**: `createModelRouter()` não lê variável de ambiente nem constrói modelo ao ser
  chamado. O modelo é criado a cada invocação, com `withStructuredOutput(routeDecisionSchema)`,
  mensagens `[["system", ROUTER_PROMPT], ["human", formatRouterInput(input)]]` e o `signal`
  recebido. Nenhum callback é passado (FR-022).
- **RT5**: `capReason` apara o texto. Acima de 300 caracteres, devolve 299 caracteres mais `…`.
  Nunca rejeita, e vazio continua vazio (FR-013).

## Garantias do nó `router` (em `production-graph.ts`)

- **RN1**: com `override`, o roteador não é chamado. O evento sai com `source: "override"`,
  `reason: OVERRIDE_REASON` e `route = routeForSelection(override.selection)` (FR-015, FR-018).
- **RN2**: sem `override`, o roteador é chamado uma única vez, dentro de
  `withTimeout(routerTimeoutMs, …, { parentSignal })` (FR-011).
- **RN3**: o retorno passa por `routeDecisionSchema.safeParse`. Com sucesso, o evento sai com
  `source: "router"`, a rota decidida e `capReason(reason)` (FR-008).
- **RN4**: rejeição, tempo esgotado ou `safeParse` falho levam a `route: "react"`, `source:
  "fallback"`, `reason: FALLBACK_REASON` e `console.error`. O pedido segue (FR-012, SC-003).
- **RN5**: se o `signal` do pedido é abortado durante o roteamento, o nó não recua. A
  rejeição do `withTimeout` é propagada como aborto, e o handler responde 504, como hoje. O
  recuo vale só para falhas do próprio roteador, com o pedido ainda vivo.
- **RN6**: sem `override`, depois da decisão, `strategy = resolveStrategy(ROUTE_SELECTIONS[route],
  store)`. Um erro aqui é falha técnica (500), não recuo.
- **RN7**: o roteador nunca contribui para `llmCalls`, `promptTokens` ou `latencyMs` (FR-022).

## Dublês de teste

| Dublê | Comportamento | Cobre |
|---|---|---|
| `fixedRouter(route, reason)` | Devolve `{ route, reason }` e grava as entradas | RN2, RN3, rotas |
| `rejectingRouter()` | Rejeita | RN4 |
| `invalidRouter(value)` | Devolve `value` (ex.: `{ route: "planner" }`, `"react"`, `{}`) | RN3/RN4 |
| `neverResolvingRouter()` | Nunca resolve (com `routerTimeoutMs` curto) | RN2, RN4 |
