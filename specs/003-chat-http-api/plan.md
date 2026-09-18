# Implementation Plan: API HTTP de Chat

**Branch**: `003-chat-http-api` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-chat-http-api/spec.md`

## Summary

Expor o OpsPilot por HTTP: um `POST /chat` que recebe `{ message, strategy?, reflect? }`
validado com zod, executa a estratégia escolhida (padrão `react`, opcionalmente decorada
com `withReflection`) e devolve `{ answer, trace, metrics, stoppedReason }`. Corpo
malformado é 400 com as issues do zod, estratégia inexistente é 422 com os nomes válidos,
e a execução tem deadline de 180 s que responde 504. O registry de estratégias muda de
`src/agents/registry.ts` para `src/agents/index.ts` e passa a tratar a reflexão como
**modificador** (`reflect: boolean`) em vez de prefixo de nome — sem alterar o
comportamento da arena, que continua aceitando `reflect:react`.

A abordagem técnica central, definida na Fase 0: **uma camada Controller fina sobre
contratos que já existem, com dependências injetadas**. `createApp(deps)` monta a aplicação
sem abrir porta (R-001); `resolveStrategy` e `timeoutMs` entram por injeção (R-007), o que
torna o teste de integração offline, determinístico e rápido por construção — o mesmo
movimento que a 002 fez com o crítico. O handler não transforma nada: `StrategyResult` já é
JSON-serializável (R-012), então preservar rastro e métricas intactos é consequência de
não mexer neles.

A única alteração invasiva é deliberada: `RunOptions` ganha `signal?: AbortSignal`,
propagado às estratégias, porque com estado compartilhado entre requisições (FR-012a) um
timeout que apenas responde 504 deixaria uma execução órfã **escrevendo no estado que os
próximos pedidos vão ler** (R-006).

## Technical Context

**Language/Version**: TypeScript 7.x em ESM (`"type": "module"`), `strict: true`, module
NodeNext. Runtime **Node 22.22.2**.

**Primary Dependencies**: Nenhuma nova. `express@5.2.1` e `@types/express@5.0.6` já estão
declarados no `package.json` e até aqui não eram importados por nenhum arquivo de `src/` —
esta feature é o primeiro uso real deles. `zod@4.6.5` para a validação de fronteira.
`@langchain/core` entra indiretamente: é de lá que vem o `signal` de `RunnableConfig`, o
canal pelo qual o cancelamento chega ao modelo (R-006). **`supertest` não é adicionado**:
o teste de integração usa `app.listen(0)` + `fetch` nativo (R-010).

**Storage**: Uma instância de `InMemoryOpsRepository` compartilhada pelo processo, semeada
de `baselineState()` na subida (FR-012a). Sem banco, sem persistência em disco — `seed.json`
nunca é reescrito (FR-012c). `sequelize`/`mysql2` seguem instalados e não usados, como já
estavam antes desta feature; ver Complexity Tracking.

**Testing**: `node:test` via `tsx`, arquivos `*.test.ts` ao lado do código. O alvo principal
é `src/http/server.test.ts`: integração ponta a ponta (porta efêmera, `fetch` real,
`express.json()` real) com estratégia falsa e determinística injetada. Mais testes unitários
puros para a montagem do corpo de erro e para o registry.

**Target Platform**: Servidor HTTP em Linux/macOS, via `npm run dev`.

**Project Type**: Single project — a biblioteca de agentes existente ganha sua primeira
camada Controller.

**Performance Goals**: Nenhuma meta de throughput. A latência é dominada pelas chamadas de
modelo, entre segundos e minutos. O único número duro é o teto: 180 s por requisição
(FR-018, SC-005).

**Constraints**:
- Node 22.22.2 — `npm run typecheck` e `npm test` destravados.
- Testes sem rede, sem credencial, sem chamada de modelo — por injeção, não por mock de
  módulo.
- `timeoutMs` injetável: a suíte não pode esperar 180 s reais (FR-025, SC-007).
- Mudança aditiva em `RunOptions` (campo opcional) — não pode quebrar arena, bench nem os
  testes das features 001 e 002.
- Migração de `registry.ts` para `index.ts` com comportamento observável idêntico da arena
  (FR-012). Sob `NodeNext` o import precisa ser `./agents/index.ts` por extenso.
- Corpo de erro nunca carrega stack nem mensagem de exceção interna (FR-017).
- ⚠️ **Risco assumido e documentado**: com estado compartilhado, uma requisição que estoura
  o deadline depois de já ter aberto ou resolvido um incidente **deixa esse efeito no
  estado** — não há desfazimento (edge case da spec, R-008).

**Scale/Scope**: 4 arquivos novos + 2 de teste novos; 6 arquivos existentes alterados
(1 deles movido); 1 teste renomeado. Uma linha alterada no `package.json` (`dev` ganha
`--env-file-if-exists=.env`), sem dependência nova.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> ⚠️ **A constituição do projeto continua não ratificada** (R-013).
> `.specify/memory/constitution.md` ainda contém o conteúdo de template, com todos os
> princípios como placeholders — a recomendação feita nos planos da 001 e da 002 não foi
> executada. Não há portões constitucionais formais a avaliar.
>
> Como substituto provisório, este plano é avaliado contra
> [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md), a governança
> de facto do projeto. **A recomendação de rodar `/speckit-constitution` permanece aberta**.

| Convenção (governança de facto) | Avaliação | Veredito |
|---|---|---|
| Camadas MVC (Model, Service, Controller) | Esta é a feature que **introduz a camada Controller** (`src/http/`), até aqui inexistente. Model (`domain`/`store`) intocado; Service (`src/agents`) só ganha o registry movido e o `signal` aditivo. O Controller não contém regra de domínio: valida, resolve, cronometra e serializa. | ✅ Passa |
| Toda entrada externa validada com zod | Duas fronteiras novas, ambas validadas: o corpo do `POST /chat` (R-003) e `process.env.PORT` no bootstrap (R-011). | ✅ Passa |
| Erros de domínio são classes traduzidas na borda | Nenhuma tradução nova, e isso é a decisão certa: `src/agents/tools.ts` já captura `DomainError` e a converte em observação de rastro **antes** de chegar aqui. Um segundo ponto de tradução criaria duas verdades sobre o mesmo erro (R-009). | ✅ Passa (n/a por construção) |
| Lógica nova nasce com teste | Toda a lógica nova é coberta offline: os 13 casos de integração do endpoint, a montagem pura do corpo de erro e o registry. O único ponto não exercitado é o valor de 180 s em condições reais — verificado por inspeção do padrão, com o comportamento coberto via `timeoutMs` injetado. | ✅ Passa |
| `npm run typecheck` e `npm test` sempre verdes | Portão de aceitação na [Validação 1](./quickstart.md) do quickstart, mais a Validação 2 de regressão da arena. | ✅ Passa |
| Nunca commitar secrets, nunca ler `.env` | Nenhum código novo lê `.env`. O script `dev` ganha `--env-file-if-exists=.env`, exatamente o mesmo mecanismo que `arena` e `bench` já usam — é o runtime que carrega, não o código. | ✅ Passa |
| Sempre utilizar funções puras | Puras: o schema de validação, `toErrorBody`, a decomposição do prefixo `reflect:`. Efeitosos por natureza: o handler (I/O) e `resolveStrategy` (constrói objetos). O efeito entra por injeção, que é o que torna o teste puro possível. | ✅ Passa |
| Stack declarada: "Express com MySQL como banco (Sequelize + mysql2)" | Traz o Express; **não** traz o MySQL. O estado continua em memória por decisão explícita da spec (FR-012a, FR-012c). Divergência consciente, registrada no Complexity Tracking. | ⚠️ Divergência justificada |

**Resultado do portão**: nenhuma violação de princípio. A única divergência é de escopo
(persistência), não de design, e está justificada abaixo.

**Re-avaliação pós-Fase 1**: os artefatos de design não introduziram violações. Dois pontos
que a Fase 1 melhorou em relação ao esboço inicial: (a) validar `PORT` com zod fechou uma
entrada externa que teria passado sem validação, e (b) a decisão de **não** adicionar lock
no estado compartilhado (R-008) foi verificada no código — as transições do repositório são
síncronas de ponta a ponta — em vez de presumida.

## Project Structure

### Documentation (this feature)

```text
specs/003-chat-http-api/
├── plan.md                      # Este arquivo
├── spec.md                      # Especificação da feature
├── research.md                  # Fase 0 — 13 decisões técnicas
├── data-model.md                # Fase 1 — entidades novas, tipos alterados, config
├── quickstart.md                # Fase 1 — 6 validações, offline e online
├── contracts/                   # Fase 1
│   ├── chat-endpoint.md         # POST /chat: requisição, respostas, obrigações do handler
│   └── strategy-registry.md     # src/agents/index.ts: interface, regras, migração
├── checklists/
│   └── requirements.md
└── tasks.md                     # Fase 2 — criado por /speckit-tasks, NÃO por este comando
```

### Source Code (repository root)

```text
src/
├── http/
│   ├── server.ts             # NOVO — createApp(deps): monta rotas, json, error handler (R-001)
│   ├── chat.ts               # NOVO — chatRequestSchema + handler do POST /chat
│   ├── errors.ts             # NOVO — ChatErrorCode, toErrorBody (pura), UnknownStrategyError
│   ├── server.test.ts        # NOVO — integração ponta a ponta, offline (FR-023)
│   └── errors.test.ts        # NOVO — toErrorBody, puro
├── agents/
│   ├── index.ts              # NOVO (movido de registry.ts) — baseStrategyNames,
│   │                         #   resolveStrategy + a superfície da arena preservada (R-002)
│   ├── index.test.ts         # RENOMEADO de registry.test.ts — casos antigos + novos
│   ├── registry.ts           # REMOVIDO — absorvido por index.ts
│   ├── types.ts              # ALTERADO — RunOptions += signal?: AbortSignal (R-006)
│   ├── react.ts              # ALTERADO — repassa signal na config do stream
│   ├── plan-and-execute.ts   # ALTERADO — repassa signal no stream e nas 2 invokes diretas
│   ├── reflection.ts         # ALTERADO — checa signal.aborted entre tentativas
│   ├── critic.ts             # inalterado
│   ├── tools.ts              # inalterado — já traduz DomainError em observação (R-009)
│   └── model.ts              # inalterado
├── store/                    # inalterado — instanciado uma vez no bootstrap (R-008)
├── trace/                    # inalterado — StrategyResult vai direto para o JSON (R-012)
├── arena.ts                  # ALTERADO — só o caminho do import do registry
├── bench.ts                  # inalterado — importa as fábricas direto, não o registry
└── index.ts                  # ALTERADO — de vazio para o bootstrap: valida PORT, listen
```

**Structure Decision**: Projeto único, testes ao lado do código, como nas features
anteriores. A camada nova ganha diretório próprio (`src/http/`) porque é a primeira
Controller do projeto e a convenção MVC pede a separação explícita — misturá-la em
`src/agents` apagaria justamente a fronteira que a governança exige.

Três pontos de atenção na implementação:

1. **A migração do registry é a única mudança com risco de regressão.** `arena.ts` é o
   único consumidor a atualizar, e sob `NodeNext` o import precisa ser `./agents/index.ts`
   por extenso — `./agents` não resolve. A Validação 2 do quickstart existe só para cobrir
   isso.
2. **`RunOptions.signal` toca três estratégias.** Campo opcional, então nada quebra, mas a
   propagação precisa chegar a **todas** as chamadas de modelo — inclusive as duas `.invoke()`
   diretas do planner e do replanner em `plan-and-execute.ts`, que são fáceis de esquecer
   porque não passam pelo `graph.stream`.
3. **O corpo de sucesso tem um campo a mais do que o pedido original.**
   `{ answer, trace, metrics }` vira `{ answer, trace, metrics, stoppedReason }`, por
   FR-006 (R-012). É acréscimo, não substituição; um cliente que ignore o campo extra
   funciona igual.

Um script alterado no `package.json` (`dev` ganha `--env-file-if-exists=.env`); nenhum
script novo, nenhuma dependência nova.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
|---|---|---|
| Stack declarada pede MySQL/Sequelize; a feature entrega Express sobre estado in-memory | A spec fixou o ciclo de vida do estado como compartilhado no processo e não durável (FR-012a, FR-012c). Introduzir persistência aqui dobraria o escopo e arrastaria migrations, conexão e um modo de teste com banco para dentro de uma feature cujo valor é expor o agente por HTTP. | Não há alternativa *mais simples* — a alternativa é *maior*. Persistência é uma feature própria, e a interface `OpsRepository` já existe exatamente para que trocar `InMemoryOpsRepository` por uma implementação Sequelize não toque a camada HTTP. |
| `RunOptions` ganha um campo, alterando um tipo compartilhado pelas features 001 e 002 | Sem `signal`, uma execução que estoura o deadline continua rodando e **escrevendo no estado compartilhado** que as próximas requisições vão ler — FR-020 e FR-012a juntos tornam o cancelamento real obrigatório, não cosmético (R-006). | *Só `Promise.race`*: responde 504 no tempo certo, mas deixa a execução órfã mutando o estado. *Timeout no servidor HTTP*: corta a conexão sem corpo, indistinguível de queda (fere FR-019 e SC-004). |

Fora isso, a feature não introduz dependência, camada extra, grafo nem abstração além do
mínimo: um Controller, um registry no lugar pedido, e um sinal de cancelamento.

---

## Próxima fase

`/speckit-tasks` para gerar `tasks.md`. Este comando encerra após a Fase 1.
