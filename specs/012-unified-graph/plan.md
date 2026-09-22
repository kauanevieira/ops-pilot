# Implementation Plan: Grafo Unificado com Roteador

**Branch**: `012-unified-graph` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-unified-graph/spec.md`

## Summary

O `/chat` passa a executar cada pedido por um grafo LangGraph com os nós `context`, `router`,
`react`, `plan-and-execute`, `reflect` e `response`. Sem `strategy` no pedido, o nó `router`
pede ao modelo uma decisão estruturada `{ route, reason }`, guiado por uma tabela de estratégias
no prompt. Com `strategy` ou `reflect: true`, a escolha é imposta e o roteador não é consultado.
Todo pedido ganha um evento `route` no rastro, e todo evento ganha `nodeName`.

Cinco decisões de desenho saíram da Fase 0:

1. **O grafo envolve as estratégias, não as desmonta** (R-001, R-002). Cada nó de estratégia
   roda o `ReasoningStrategy` que o registro já resolve, com os mesmos decoradores de hoje. Um
   spike offline confirmou que grafo dentro de grafo funciona, que os contadores de chamadas
   ficam isolados e que o aborto propaga. Arena, bench e MCP não mudam.
2. **O 422 continua antes do grafo** (R-003). Em override, o handler resolve a estratégia como
   hoje. Sem override, o nó `router` a resolve depois de decidir. É uma chamada a
   `resolveStrategy` por pedido, sempre.
3. **O roteador devolve `unknown` e o nó valida** (R-004, R-005). A saída do modelo passa pelo
   mesmo `safeParse` que os dublês. Rota fora do enum, erro ou tempo esgotado recuam para
   ReAct, e o motivo longo é cortado, não rejeitado.
4. **`nodeName` é carimbado pelo grafo** (R-011). As estratégias não sabem dos nós, e o campo é
   opcional no tipo, então só o rastro do `/chat` o tem.
5. **O roteador fica fora das métricas** (R-012), como o sumarizador da 011. `llmCalls` e
   `promptTokens` continuam comparáveis com arena e bench.

## Technical Context

**Language/Version**: TypeScript em ESM, `strict: true`. Node 22.22.2.

**Primary Dependencies**: nenhuma nova. `@langchain/langgraph` 1.4.15 (`StateGraph`,
`Annotation`, aresta condicional) e `@langchain/core` 1.2.11 (`withStructuredOutput`).

**Storage**: nenhuma mudança. Nenhuma tabela, coluna ou DDL novos.

**Testing**: `node:test`. Funções puras em tabela (`isOverride`, `routeForSelection`,
`strategyLabel`, `stampNode`, `capReason`, `formatRouterInput`). O grafo é testado direto, com
stores em memória, roteadores falsos ([router.md](./contracts/router.md#dublês-de-teste)) e
`resolveStrategy` falso. O `/chat` de ponta a ponta usa `withServer`, que passa a ter um
roteador falso por padrão. Nenhum teste chama modelo.

**Target Platform**: servidor Node local, como antes.

**Project Type**: Single project.

**Performance Goals**: uma chamada extra ao modelo, de saída curta, por pedido sem override.
Zero chamadas extras com override.

**Constraints**:
- `npm test` offline (Princípio V). O default `createModelRouter()` só é construído.
- O roteamento roda dentro do prazo de 180 s do pedido, com limite próprio de 15 s.
- Arena, bench e MCP inalterados (FR-024). Nenhum deles importa `production-graph.ts`.
- Campos novos opcionais e aditivos (`nodeName`, evento `route`). Nenhuma métrica nova.
- Testes existentes do `/chat` que mudam de expectativa estão listados na R-016. As demais
  asserções continuam iguais.

**Scale/Scope**: 2 módulos novos (`agents/router.ts`, `agents/production-graph.ts`), com testes.
Alterados: `domain/schemas.ts`, `trace/types.ts`, `trace/format.ts`, `http/chat.ts`,
`http/server.ts`, `index.ts`, `http/server.test.ts`, README, aviso na 003.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `routeSchema`, `routeDecisionSchema`, `routeSourceSchema` e `nodeNameSchema` são definidos uma vez em `src/domain/schemas.ts`, e os tipos saem por `z.infer`. A decisão de override, o mapeamento de rotas, o rótulo, o carimbo e o corte do motivo são funções puras. O modelo fica só no roteador injetado. Relógio e persistência continuam no handler e nos stores | ✅ Passa |
| **II. Persistência Local em SQLite** | Nenhuma mudança de persistência | ✅ N/A |
| **III. Contrato Antes de Código** | [production-graph.md](./contracts/production-graph.md), [router.md](./contracts/router.md) e [chat-endpoint.md](./contracts/chat-endpoint.md). Aviso na 003 (a estratégia padrão deixa de ser fixa) e README na mesma mudança (FR-025) | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | Nenhuma ferramenta nova ou alterada. O esquema de saída do roteador segue as regras 5 e 6 mesmo assim: todo campo tem `.describe()`, e `route` é enum (R-005) | ✅ N/A |
| **V. Portões Offline e Determinísticos** | Roteador injetável. `withServer` usa um falso por padrão. O tempo limite é testado com roteador que nunca resolve e valor curto, via `withTimeout` (já seguro com `node:test`). As asserções inspecionam rota, origem e estratégia executada, não texto do modelo. SC-005 fica no roteiro manual | ✅ Passa |
| **Restrições: validação na borda** | O corpo do `/chat` continua em `chatRequestSchema`, sem mudança. A saída do roteador passa por `routeDecisionSchema.safeParse` (R-004) | ✅ Passa |
| **Restrições: credenciais** | O default não lê env ao ser construído (R-004, como 009 e 011) | ✅ Passa |

**Governança: complexidade adicional**:
- Nenhuma dependência nova, nenhum diretório novo.
- Uma camada nova, o grafo externo. Justificada: é o pedido da feature, e ela substitui a
  composição que hoje vive dentro do `runChat` do handler, sem somar a ela. A alternativa mais
  simples (uma função `async` em sequência) foi descartada na R-001 por não ser o grafo pedido
  e por esconder a aresta condicional.

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. O desenho mantém a regra da 010 e da 011 de que o
bloco medido é o bloco entregue: o nó de estratégia usa os mesmos `withMemory` e
`withConversationHistory`, e o nó `response` usa o mesmo `buildContextBreakdown` (G3, G6). O
roteador lê a conversa com os mesmos `format*Block` (RT3).

## Project Structure

### Documentation (this feature)

```text
specs/012-unified-graph/
├── plan.md
├── spec.md
├── research.md              # Fase 0: 18 decisões
├── data-model.md            # esquemas de rota, evento route, estado do grafo, funções puras, fluxo
├── quickstart.md            # portões offline, servidor real, amostra anotada de 10 pedidos (SC-005)
├── contracts/
│   ├── production-graph.md  # nós, arestas, G1–G13
│   ├── router.md            # saída estruturada, prompt, RT1–RT5, nó RN1–RN7, dublês
│   └── chat-endpoint.md     # emenda ao POST /chat, CH1–CH9, ChatAppDeps
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── domain/schemas.ts                    # + routeSchema, routeDecisionSchema, routeSourceSchema, nodeNameSchema, ROUTE_REASON_MAX_CHARS
├── agents/
│   ├── router.ts                        # NOVO: Router, RouterInput, ROUTER_PROMPT, formatRouterInput, capReason, ROUTER_TIMEOUT_MS, motivos fixos, createModelRouter
│   ├── router.test.ts                   # NOVO: RT1–RT5
│   ├── production-graph.ts              # NOVO: estado, nós, createProductionGraph, isOverride, routeForSelection, strategyLabel, ROUTE_SELECTIONS, stampNode
│   └── production-graph.test.ts         # NOVO: G1–G11, RN1–RN7
├── trace/
│   ├── types.ts                         # + evento route; TraceEvent & { nodeName? }
│   ├── format.ts                        # + case "route"; prefixo {nodeName}
│   └── format.test.ts                   # + G12, G13 (sem nodeName, linha idêntica)
├── http/
│   ├── chat.ts                          # override + 422 antes; runChat → graph.run
│   ├── server.ts                        # ChatAppDeps.router, routerTimeoutMs
│   └── server.test.ts                   # withServer com fixedRouter; stripGraphFields; R-016; CH1–CH9
└── index.ts                             # passa createModelRouter()
```

**Structure Decision**: o grafo e o roteador ficam em `src/agents/`, ao lado das estratégias
que orquestram. O registro (`agents/index.ts`) continua sem importar nenhum dos dois (G9), com o
mesmo princípio que manteve memória e histórico fora dele. O contexto da conversa continua em
`src/context/` e é só chamado pelo nó `context`. `http/chat.ts` fica com as responsabilidades de
borda: validação, erros, prazo, gravação e aprendizado.

### Ordem de implementação sugerida

1. Domínio: esquemas de rota e de nó. `trace/types.ts`: evento `route` e `nodeName`.
   `format.ts` com testes (G12, G13).
2. `router.ts` + testes (RT1–RT5).
3. `production-graph.ts`: funções puras + testes. Depois os nós e `createProductionGraph`, com
   testes do grafo usando dublês (G1–G11, RN1–RN7).
4. `chat.ts`, `server.ts` e `index.ts`. `server.test.ts`: roteador falso no `withServer`,
   expectativas da R-016, testes CH1–CH9. Neste ponto US1 e US2 (P1) ficam entregáveis.
5. US3 já sai pronta dos passos 1 e 3 (o `nodeName` é carimbado pelo grafo). Aqui entram só os
   testes de ponta a ponta de CH2 e a checagem de que o rastro da arena não mudou.
6. README (seção do `/chat`: roteamento, `route`, `nodeName`) e aviso na 003
   (`contracts/chat-endpoint.md` e `strategy-registry.md`: padrão deixou de ser fixo).
7. Roteiro manual do `quickstart.md`, etapas 2 e 3, com o modelo real.

### Riscos

| Risco | Mitigação |
|---|---|
| O roteador escolhe `reflect` ou `plan-and-execute` demais e encarece consultas simples | Tabela com custo explícito, desempate pela mais barata (R-006) e amostra anotada no quickstart (SC-005). Override por `strategy` continua disponível |
| O roteador escolhe `react` para uma ação com efeito colateral e perde a revisão | `withIncidentConfirmation` continua por baixo de toda estratégia (005), e a garantia do id do incidente não depende do roteador. A amostra do quickstart tem três pedidos desse tipo |
| O roteador acrescenta latência a todo pedido sem override | Saída curta, limite de 15 s, recuo imediato em falha. Override zera o custo. Paralelizar com o recall fica anotado como otimização (R-013) |
| Grafo dentro de grafo misturando config (callbacks, recursionLimit) | Spike da R-001. As estratégias já passam `callbacks`, `recursionLimit` e `signal` explícitos. G6 e CH8 testam que `llmCalls` é exatamente o da estratégia falsa |
| Aborto durante o roteamento confundido com falha do roteador (recuo em vez de 504) | RN5: o nó checa `signal.aborted` antes de recuar e propaga. Coberto por teste com `timeoutMs` curto do pedido e roteador que nunca resolve |
| Clientes dependiam do padrão `react` implícito | Mudança documentada no README, no contrato e no aviso da 003. `strategy: "react"` restaura o comportamento |

## Complexity Tracking

Nenhuma violação a justificar. A camada nova (grafo) está justificada acima, em Governança.
