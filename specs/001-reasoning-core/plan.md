# Implementation Plan: Núcleo de Raciocínio do OpsPilot

**Branch**: `001-reasoning-core` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-reasoning-core/spec.md`

## Summary

Construir o núcleo de raciocínio do OpsPilot: um contrato único `ReasoningStrategy` que
devolve resposta, rastro tipado e métricas; duas implementações desse contrato (ReAct
pré-construído do LangGraph e um grafo Plan-and-Execute com planner/executor/replanner e
teto de 8 passos); três ferramentas operacionais validadas por zod sobre um store
in-memory puro; e uma arena de linha de comando que roda estratégias sobre o mesmo pedido
para comparar rastros e métricas.

A abordagem técnica central, definida na Fase 0: **manter o núcleo puro e empurrar os
efeitos para as bordas**. As transições de estado e a conversão de mensagens em rastro são
funções puras — é isso que torna os testes determinísticos e offline uma consequência do
design, não um exercício de mocks. As chamadas ao modelo, a leitura de ambiente e a
impressão da arena ficam confinadas às bordas.

## Technical Context

**Language/Version**: TypeScript 7.x em ESM (`"type": "module"`), `strict: true`, target ES2022, module NodeNext. Runtime **Node 22 LTS** — ver Constraints.

**Primary Dependencies**: `@langchain/langgraph@1.4.15` (grafo + `createReactAgent`), `@langchain/core@1.2.11` (`tool()`, callbacks), `@langchain/openai@1.5.13` (`ChatOpenAI` apontado ao OpenRouter), `zod@4.6.5` (validação de fronteira e saída estruturada). `express`, `sequelize` e `mysql2` estão instalados mas **não são usados nesta feature**.

**Storage**: In-memory, atrás de interface de repositório (R-008). MySQL/Sequelize adiados para a feature seguinte, sem alteração em ferramentas ou estratégias.

**Testing**: `node:test` via `tsx` (`node --import tsx --test`), arquivos `*.test.ts` colocados ao lado do código. Alvos: transições do store e formatação de rastro.

**Target Platform**: CLI em Linux/macOS. Sem interface gráfica; a API Express (`src/index.ts`) está fora do escopo desta feature.

**Project Type**: Single project — biblioteca de agentes + entrypoints de CLI.

**Performance Goals**: Nenhuma meta de throughput. A latência é dominada pelo provedor de LLM e é *medida* (`latencyMs`), não otimizada. Testes offline devem rodar em poucos segundos.

**Constraints**:
- ⚠️ **Node 22 obrigatório, não satisfeito no ambiente atual (20.6.0)**. `@langchain/openai` declara `engines.node: ">=22"`; o glob `src/**/*.test.ts` do script de teste depende da expansão feita pelo `node --test` (Node 21+); e o Node 20.6.0 já quebrou `npm run typecheck` neste repositório. **Atualizar o Node é pré-requisito da implementação.** Detalhes em R-010.
- `temperature: 0` em todas as chamadas, para reprodutibilidade.
- Testes sem rede, sem credenciais, sem chamada de modelo.
- Credenciais via `--env-file` nativo do Node; `dotenv` vetado pelo projeto.

**Scale/Scope**: Monoprocesso, usuário único. 5 serviços e 6 alertas na linha de base. Máximo 8 passos por plano. ~10 módulos novos em `src/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> ⚠️ **A constituição do projeto não está ratificada.** `.specify/memory/constitution.md`
> ainda contém o conteúdo de template, com todos os princípios como placeholders. Não há,
> portanto, portões constitucionais formais a avaliar.
>
> Como substituto provisório, este plano foi avaliado contra as convenções declaradas em
> [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md), que são a
> governança de facto do projeto. **Recomenda-se rodar `/speckit-constitution` para
> ratificá-las** antes de `/speckit-implement`; se os princípios ratificados divergirem do
> que está abaixo, este plano precisa ser reavaliado.

| Convenção (governança de facto) | Avaliação | Veredito |
|---|---|---|
| Camadas MVC (Model, Service, Controller) | Esta feature não tem camada HTTP. O mapeamento aplicado: **Model** = `src/domain` + `src/store`; **Service** = `src/agents` (estratégias e ferramentas); **Controller** = entrypoints de CLI (`src/arena.ts`, `src/scripts/seed.ts`). A camada MVC canônica chega com a API Express, fora desta feature. | ✅ Passa, com mapeamento documentado |
| Toda entrada externa validada com zod | Entrada de ferramenta (contrato `tools.md`), argumentos da CLI da arena (contrato `arena-cli.md`) e saída estruturada do planner são validadas por zod. | ✅ Passa |
| Erros de domínio são classes traduzidas na borda | `src/domain/errors.ts` define as classes; a tradução ocorre na borda da ferramenta, virando observação para o agente (FR-015). | ✅ Passa |
| Lógica nova nasce com teste | Store e formatação de rastro têm testes exigidos por FR-034. Ver ressalva em Complexity Tracking sobre as estratégias. | ⚠️ Passa com ressalva |
| `npm run typecheck` e `npm test` sempre verdes | Ambos são portão de aceitação no [quickstart.md](./quickstart.md). Bloqueado hoje pela versão do Node. | ⚠️ Bloqueado por ambiente |
| Nunca commitar secrets, nunca ler `.env` | Credenciais só via `process.env`, populado por `--env-file` no runtime. `.env` está no `.gitignore`. Nenhum artefato desta feature lê o arquivo. | ✅ Passa |
| Sempre utilizar funções puras | Núcleo puro (transições de store, `messagesToTrace`); efeitos isolados nas bordas. Ver Complexity Tracking. | ⚠️ Passa com desvio justificado |

**Resultado do portão**: nenhuma violação injustificada. Dois itens dependem de ação
externa (ratificar a constituição, atualizar o Node) e estão registrados como
pré-requisitos, não como bloqueios de design.

**Re-avaliação pós-Fase 1**: os artefatos de design não introduziram novas violações. A
interface de repositório (FR-017) e a separação puro/efeitoso reforçam as convenções em
vez de tensioná-las.

## Project Structure

### Documentation (this feature)

```text
specs/001-reasoning-core/
├── plan.md              # Este arquivo
├── spec.md              # Especificação da feature
├── research.md          # Fase 0 — 10 decisões técnicas verificadas
├── data-model.md        # Fase 1 — entidades, transições, linha de base
├── quickstart.md        # Fase 1 — guia de validação ponta a ponta
├── contracts/           # Fase 1
│   ├── reasoning-strategy.md
│   ├── tools.md
│   └── arena-cli.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 — criado por /speckit-tasks, NÃO por este comando
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── schemas.ts            # Esquemas zod das entidades e enums
│   ├── errors.ts             # Classes de erro de domínio
│   └── errors.test.ts
├── store/
│   ├── state.ts              # Transições puras (state, command) => newState
│   ├── state.test.ts         # FR-034: testes de store
│   ├── repository.ts         # Interface de repositório (FR-017)
│   ├── in-memory.ts          # Implementação in-memory
│   └── seed.ts               # Dados da linha de base (5 serviços, 6 alertas)
├── trace/
│   ├── types.ts              # TraceEvent, RunMetrics, StrategyResult
│   ├── from-messages.ts      # messagesToTrace — função pura (R-002)
│   ├── format.ts             # Renderização do rastro para terminal
│   └── format.test.ts        # FR-034: testes de formatação de rastro
├── agents/
│   ├── types.ts              # ReasoningStrategy, RunOptions
│   ├── model.ts              # Fábrica única do modelo (FR-007 a FR-010)
│   ├── tools.ts              # As três ferramentas com esquemas zod
│   ├── llm-counter.ts        # Callback handler que conta chamadas (R-003)
│   ├── react.ts              # Estratégia ReAct
│   ├── plan-and-execute.ts   # Grafo planner/executor/replanner
│   └── registry.ts           # Registro nome -> estratégia
├── scripts/
│   └── seed.ts               # Comando autônomo de carga inicial (FR-019)
├── arena.ts                  # CLI de comparação (FR-030 a FR-033)
└── index.ts                  # API Express — fora do escopo desta feature
```

**Structure Decision**: Projeto único, com os testes **colocados ao lado do código** em
vez de um diretório `tests/` separado — decisão ditada pelo script já existente em
`package.json` (`node --import tsx --test src/**/*.test.ts`). A divisão em `domain` /
`store` / `trace` / `agents` separa o que é puro e testável offline (os três primeiros) do
que depende de efeitos externos (`agents`), que é a espinha dorsal da estratégia de teste
desta feature.

Um script novo é necessário no `package.json`: `seed` = `tsx src/scripts/seed.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Estratégias e ferramentas não são funções puras, contrariando a convenção "sempre utilize funções puras" | Chamar um LLM, ler `process.env` e imprimir na arena são efeitos irredutíveis — não existe versão pura de "perguntar ao modelo". O desvio é contido: os efeitos ficam confinados a `agents/` e aos entrypoints, enquanto `store/` e `trace/` permanecem puros. | Um núcleo inteiramente puro exigiria injetar todo efeito como parâmetro até a borda, inflando as assinaturas sem ganho de testabilidade — os testes exigidos por FR-034 já cobrem exatamente as partes puras. |
| Estratégias (`react.ts`, `plan-and-execute.ts`) não nascem com teste unitário próprio, contrariando "lógica nova nasce com teste" | Testá-las de verdade exigiria chamadas reais ao modelo, o que viola FR-035 (sem rede, determinístico). A lógica testável que elas contêm — conversão de mensagens em rastro — foi **extraída** para `trace/from-messages.ts`, que é puro e tem teste. | Dublês de LLM validariam o dublê, não a estratégia, ao custo de manutenção alta. A validação real das estratégias é o roteiro manual do [quickstart.md](./quickstart.md). |

---

## Próxima fase

`/speckit-tasks` para gerar `tasks.md`. Este comando encerra após a Fase 1.
