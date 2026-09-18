# Implementation Plan: Camada de Reflexão

**Branch**: `002-reflection-layer` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-reflection-layer/spec.md`

## Summary

Acrescentar uma camada de reflexão que envolve qualquer estratégia de raciocínio já
existente: executa a base, submete a resposta a um crítico que a confronta com as
observações do próprio rastro, e — se reprovada — re-executa a base com o feedback no
contexto, até aprovar ou esgotar o limite de reflexões (padrão 2). O ciclo registra um
evento `critique` no rastro por avaliação e soma as chamadas extras nas métricas. A arena
ganha `reflect:react` e `reflect:plan-and-execute`.

A abordagem técnica central, definida na Fase 0: **decorator sobre o contrato, com o
crítico injetável**. `withReflection(strategy, opts)` devolve uma `ReasoningStrategy` —
nenhuma estratégia existente é alterada, e o resultado é intercambiável com qualquer
estratégia crua. Como tudo que a feature acrescenta é lógica de controle (contar
tentativas, decidir quando parar, montar rastro, somar métricas), injetar o crítico
(R-004) deixa **o ciclo inteiro coberto por testes offline e determinísticos** — corrigindo
a lacuna de testes que a 001 precisou justificar no seu Complexity Tracking.

## Technical Context

**Language/Version**: TypeScript 7.x em ESM (`"type": "module"`), `strict: true`, module NodeNext. Runtime **Node 22.22.2** — ver Constraints.

**Primary Dependencies**: Nenhuma nova. Reaproveita `@langchain/core` (callbacks, `LlmCallCounter`), `@langchain/openai` via `createModel()`, e `zod@4.6.5` para a saída estruturada do crítico. `@langchain/langgraph` **não é usado por esta feature** — o ciclo de reflexão é um laço TypeScript comum, não um grafo.

**Storage**: Nenhum. A camada não toca o store; o crítico não tem acesso a repositório nem a ferramentas.

**Testing**: `node:test` via `tsx` (`node --import tsx --test src/**/*.test.ts`), arquivos `*.test.ts` ao lado do código. Alvos: o laço de reflexão completo (com estratégia base e crítico falsos) e a montagem pura do contexto de crítica.

**Target Platform**: CLI em Linux/macOS, via `npm run arena`.

**Project Type**: Single project — extensão da biblioteca de agentes.

**Performance Goals**: Nenhuma meta de throughput. O custo esperado é multiplicativo e conhecido: com o padrão de 2 reflexões, no pior caso 3 execuções da base + 3 chamadas de crítico. É esse custo que a arena existe para tornar visível (SC-004).

**Constraints**:
- ✅ **O bloqueio de ambiente da 001 está resolvido**: o ambiente roda Node 22.22.2, compatível com `engines.node: ">=22"` e `.nvmrc`. `npm run typecheck` e `npm test` estão destravados (R-012).
- `temperature: 0` também no crítico, por usar a mesma `createModel()`.
- Testes sem rede, sem credenciais, sem chamada de modelo — garantido por injeção, não por mocks de módulo.
- Mudança aditiva em `StoppedReason` (R-005): não pode quebrar `src/trace/format.ts` nem os testes da 001.
- ⚠️ **Risco assumido e documentado**: a regeneração re-executa a base sobre o mesmo store, e `open_incident` não é idempotente. A duplicação é mitigada por contexto, não impedida (R-002).

**Scale/Scope**: 3 arquivos novos + 2 arquivos de teste novos; 2 arquivos existentes alterados. Nenhuma mudança em `package.json`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> ⚠️ **A constituição do projeto continua não ratificada.** `.specify/memory/constitution.md`
> ainda contém o conteúdo de template, com todos os princípios como placeholders — a
> recomendação feita no plano da 001 não foi executada. Não há portões constitucionais
> formais a avaliar.
>
> Como substituto provisório, este plano foi avaliado contra as convenções declaradas em
> [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md), que são a
> governança de facto do projeto. **A recomendação de rodar `/speckit-constitution`
> permanece aberta**; se os princípios ratificados divergirem do que está abaixo, este
> plano precisa ser reavaliado.

| Convenção (governança de facto) | Avaliação | Veredito |
|---|---|---|
| Camadas MVC (Model, Service, Controller) | Esta feature vive inteira na camada **Service** (`src/agents`), mais uma linha de tipo em `src/trace`. Não toca Model (`domain`/`store`) nem introduz Controller. | ✅ Passa |
| Toda entrada externa validada com zod | A saída do crítico é saída de modelo — entrada externa — e é validada por `critiqueSchema` via `withStructuredOutput` (R-003). A arena não ganha flag nova, então não há entrada de CLI nova a validar. | ✅ Passa |
| Erros de domínio são classes traduzidas na borda | Nenhum erro de domínio novo. A falha do crítico não é erro de domínio: é degradação registrada no rastro (R-009). | ✅ Passa (n/a) |
| Lógica nova nasce com teste | **Toda** a lógica nova tem teste offline: o laço de reflexão via dublês, e `buildCritiqueContext` por ser pura. Sem a ressalva que a 001 precisou abrir. | ✅ Passa |
| `npm run typecheck` e `npm test` sempre verdes | Portão de aceitação na [Validação 1](./quickstart.md) do quickstart. Destravado pelo Node 22. | ✅ Passa |
| Nunca commitar secrets, nunca ler `.env` | O crítico usa `createModel()`, que lê apenas `process.env`. Nenhum artefato novo lê `.env`. | ✅ Passa |
| Sempre utilizar funções puras | `buildCritiqueContext` e a montagem do input enriquecido são puras. O laço em si é assíncrono e efeitoso por natureza (chama modelo), mas recebe seus efeitos por injeção — o que é exatamente o que torna o teste puro possível. | ✅ Passa |

**Resultado do portão**: nenhuma violação, injustificada ou não — o Complexity Tracking
desta feature está vazio. O único item pendente depende de ação externa (ratificar a
constituição) e está registrado como recomendação, não como bloqueio de design.

**Re-avaliação pós-Fase 1**: os artefatos de design não introduziram violações. Ao
contrário: a decisão de injetar o crítico (R-004) resolve, para esta feature, a ressalva de
"lógica nova nasce com teste" que a 001 teve de justificar.

## Project Structure

### Documentation (this feature)

```text
specs/002-reflection-layer/
├── plan.md              # Este arquivo
├── spec.md              # Especificação da feature
├── research.md          # Fase 0 — 12 decisões técnicas
├── data-model.md        # Fase 1 — entidades novas, tipos alterados, agregações
├── quickstart.md        # Fase 1 — guia de validação ponta a ponta
├── contracts/           # Fase 1
│   ├── reflection.md    # withReflection: algoritmo, obrigações, registro
│   └── critic.md        # Critic, critiqueSchema, critérios de julgamento
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 — criado por /speckit-tasks, NÃO por este comando
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── critic.ts             # NOVO — critiqueSchema, buildCritiqueContext (pura), createLlmCritic
│   ├── critic.test.ts        # NOVO — testes de buildCritiqueContext (puros, offline)
│   ├── reflection.ts         # NOVO — withReflection: o ciclo, o rastro, as métricas
│   ├── reflection.test.ts    # NOVO — ciclo completo com base e crítico falsos (offline)
│   ├── registry.ts           # ALTERADO — deriva reflect:* das fábricas base (R-011)
│   ├── types.ts              # inalterado
│   ├── model.ts              # inalterado — reaproveitado pelo crítico
│   ├── llm-counter.ts        # inalterado — reaproveitado pelo crítico
│   ├── react.ts              # inalterado (FR-001)
│   └── plan-and-execute.ts   # inalterado (FR-001)
├── trace/
│   ├── types.ts              # ALTERADO — StoppedReason += "max-reflections" (R-005)
│   └── format.ts             # inalterado — já renderiza `critique` e interpola stoppedReason
└── arena.ts                  # inalterado — herda os nomes novos via availableStrategyNames()
```

**Structure Decision**: Projeto único, testes ao lado do código, como na 001. A feature
inteira cabe em `src/agents` porque é composição de estratégias, não domínio novo — a
separação puro/efeitoso da 001 se mantém: `critic.ts` separa a parte pura
(`buildCritiqueContext`) da efeitosa (`createLlmCritic`) no mesmo módulo, e `reflection.ts`
só se torna efeitoso pelo que recebe injetado.

Dois pontos de atenção na implementação, ambos aditivos e sem quebra:

1. `src/trace/types.ts` ganha um valor em `StoppedReason`. Nenhum `switch` exaustivo sobre
   esse tipo existe hoje (verificado) — `formatMetrics` interpola a string.
2. `registry.ts` passa a gerar as entradas refletidas a partir do mapa base, o que muda o
   retorno de `availableStrategyNames()` de 2 para 4 nomes. A arena consome essa função
   como padrão quando `--strategies` é omitido: sem a flag, ela passará a rodar as quatro.

Nenhum script novo no `package.json`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Sem violações a justificar. A feature não introduz dependência, camada, grafo nem
abstração nova além do decorator — que é o mínimo necessário para satisfazer FR-001
(decorar sem alterar a base).

---

## Próxima fase

`/speckit-tasks` para gerar `tasks.md`. Este comando encerra após a Fase 1.
