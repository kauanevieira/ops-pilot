# Phase 0 Research: Núcleo de Raciocínio do OpsPilot

**Feature**: `001-reasoning-core` | **Date**: 2026-09-17

Todas as verificações abaixo foram feitas contra as versões efetivamente instaladas
em `node_modules`, não contra documentação de memória: `@langchain/core@1.2.11`,
`@langchain/langgraph@1.4.15`, `@langchain/openai@1.5.13`, `zod@4.6.5`.

---

## R-001: Estratégia ReAct pré-construída

**Decision**: Usar `createReactAgent` de `@langchain/langgraph/prebuilt`, invocado com
`{ llm, tools }`, em vez de montar um `StateGraph` manual.

**Rationale**: O export existe e está estável na 1.4.15 (verificado em
`dist/prebuilt/index.d.ts`). Aceita `llm: LanguageModelLike` e
`tools: ToolNode | ClientTool[]`, exatamente a forma das tools que produziremos.
FR-022 pede a estratégia reativa, não uma reimplementação dela.

**Alternatives considered**: `StateGraph` manual com nós `agent`/`tools` — mais
código para o mesmo comportamento, e divergiria do que o LangGraph mantém; rejeitado.
`createAgentExecutor` (legado) — sobrevive no pacote mas é a geração anterior; rejeitado.

---

## R-002: Captura do rastro completo

**Decision**: Derivar o rastro do array final de mensagens com uma **função pura**
`messagesToTrace(messages): TraceEvent[]`, mapeando:

| Mensagem | Evento de rastro |
|----------|------------------|
| `AIMessage` com conteúdo textual | `thought` |
| `AIMessage` com `tool_calls` | um `action` por chamada, carregando `tool` e `args` |
| `ToolMessage` | `observation` |
| `AIMessage` final sem `tool_calls` | `answer` |

**Rationale**: Atende FR-002/FR-003/FR-023 e, crucialmente, torna a formatação de
rastro testável offline e de forma determinística (FR-034/FR-035) — os testes montam
arrays de mensagens à mão e verificam o rastro resultante, sem tocar em rede nem no
modelo. Uma função pura aqui também satisfaz a convenção de funções puras do projeto.

**Alternatives considered**: `streamEvents` / `stream({ streamMode: "updates" })` para
capturar eventos ao vivo — mais fiel ao tempo real, porém acopla a captura do rastro ao
runtime assíncrono do grafo e torna o teste dependente de execução do agente. Rejeitado
para esta feature; pode ser adicionado depois sem quebrar o contrato, já que o tipo
`TraceEvent` é o mesmo.

---

## R-003: Contagem de chamadas de LLM

**Decision**: Um `BaseCallbackHandler` que incrementa um contador em
`handleChatModelStart`, passado via `callbacks` na config de invocação. O contador vive
por execução (uma instância nova por `run()`).

**Rationale**: `handleChatModelStart` existe em
`@langchain/core/dist/callbacks/base.d.ts` (linha 84) e dispara uma vez por chamada ao
modelo de chat — que é exatamente a unidade que FR-006 pede contar. Funciona
identicamente para ReAct e para Plan-and-Execute, sem que cada estratégia precise
instrumentar seus próprios nós.

**Alternatives considered**: Somar `usage_metadata` das respostas — mede tokens, não
chamadas, e não responde FR-006. Contador manual em cada nó do grafo — duplicaria
lógica por estratégia e erraria nas chamadas internas do agente pré-construído.

---

## R-004: Limite de iterações

**Decision**: Traduzir o limite de iterações da estratégia para `recursionLimit` na
config de invocação, usando `recursionLimit = 2 * maxIterations + 1`, e capturar
`GraphRecursionError` para encerrar de forma controlada com o rastro parcial e
`stoppedReason: "max-iterations"`.

**Rationale**: O LangGraph conta *super-steps*, não iterações de raciocínio. Um ciclo
ReAct completo consome dois super-steps (nó `agent` + nó `tools`), mais o passo inicial —
daí a fórmula. Sem a conversão, `--max-iterations 3` cortaria a execução na metade da
segunda iteração e o usuário veria um limite que não corresponde ao que pediu. O
`catch` é o que transforma um erro de runtime no encerramento gracioso que FR-005 exige.

**Alternatives considered**: Repassar o valor cru como `recursionLimit` — simples, mas
semanticamente errado pelo motivo acima. Deixar o erro propagar — viola FR-005, que
exige encerramento controlado com rastro parcial preservado.

---

## R-005: Plan-and-Execute como grafo

**Decision**: `StateGraph` próprio com três nós — `planner` → `executor` → `replanner` —
e aresta condicional do `replanner` de volta ao `executor` ou para `END`. Estado do grafo
(`PEState`) carrega `input`, `plan: string[]` (passos restantes), `done: [step, result][]`
(acumulado por reducer — seu comprimento **é** o contador de passos, sem campo
`stepCount` separado), `answer: string` e `trace`. Planner usa `withStructuredOutput()`
para devolver a lista de passos. O replanner devolve uma de três decisões —
`ajustar` (revisa `plan`), `seguir` (mantém `plan` como está) ou `encerrar` (preenche
`answer`) — em vez de inferir a decisão a partir de `remainingSteps` vazio/não vazio; a
enumeração explícita deixa a intenção do modelo auditável no rastro. O teto de 8 passos
é verificado na aresta condicional (`done.length >= 8`), antes de reentrar no `executor`.

**Nota de tipagem**: `withStructuredOutput<T>(schema)` precisa do parâmetro de tipo
explícito. Sem ele, a inferência estrutural do `@langchain/core@1.2.11` a partir do
schema zod produz `campo: T | undefined` para campos com `.default()` — um descompasso
entre o tipo inferido e o que o zod realmente valida em runtime (confirmado isolando a
chamada fora do projeto). `withStructuredOutput<Plan>(planSchema)` e
`withStructuredOutput<Replan>(replanSchema)` contornam o problema.

**Rationale**: FR-024 a FR-029 descrevem esse grafo. Saída estruturada via zod garante
que o plano chegue como lista de passos e não como prosa a ser parseada. Verificar o
teto na aresta — e não dentro do executor — é o que garante FR-028 mesmo se o replanner
devolver um plano gigante de uma vez. Derivar o contador de passos de `done.length` em
vez de um campo redundante elimina uma fonte de dessincronia entre os dois.

**Alternatives considered**: Executar o plano inteiro em lote sem replanejamento — mais
barato em chamadas de LLM, mas viola FR-025 (um passo por vez) e FR-026 (revisão após
cada passo). Teto aplicado só por `recursionLimit` — não distingue "8 passos" de "8
super-steps" e deixaria FR-028 sem garantia direta. Replanner com `remainingSteps`
vazio/não-vazio em vez de uma decisão explícita — funciona, mas obriga inferir a
intenção (ajustar vs. seguir) a partir de um efeito colateral do array.

---

## R-006: Acesso ao OpenRouter

**Decision**: Fábrica única em `src/agents/model.ts` retornando
`new ChatOpenAI({ apiKey, model, temperature: 0, configuration: { baseURL: "https://openrouter.ai/api/v1" } })`,
lendo `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` de `process.env` e falhando com erro
nomeando a variável ausente.

**Rationale**: `configuration?: ClientOptions` está em
`@langchain/openai/dist/chat_models/base.d.ts` (linha 164) e é o ponto de injeção do
`baseURL`; `apiKey` está em `dist/types.d.ts` (linha 81). OpenRouter expõe API
compatível com OpenAI, então o cliente OpenAI com `baseURL` trocado é o caminho
suportado. Ponto único atende FR-007 e a falha explícita atende FR-010.

**Alternatives considered**: Cada estratégia instanciar o próprio modelo — viola FR-007
e espalharia a leitura de env pelo código.

---

## R-007: Carregamento de variáveis de ambiente

**Decision**: Usar a flag nativa `--env-file=.env` do Node nos comandos que precisam de
credencial (arena e dev), sem biblioteca de terceiros. O arquivo `.env` permanece fora do
versionamento e **nunca** é lido pelo agente de desenvolvimento — apenas pelo runtime.

**Rationale**: Requisito explícito do projeto de não usar `dotenv`. A flag existe desde o
Node 20.6 e dispensa dependência. A convenção "nunca ler `.env`" vale para o agente de
codificação, não para o processo em execução — distinção registrada aqui para evitar
ambiguidade futura.

**Alternatives considered**: `dotenv` — vetado pelo projeto. Exportar variáveis no shell —
funciona, mas piora a ergonomia de quem roda a arena.

---

## R-008: Fonte de verdade do estado

**Decision**: Store in-memory puro atrás de uma interface `AlertRepository` /
`IncidentRepository`. MySQL + Sequelize ficam **fora** desta feature. A linha de base
(antes um literal TypeScript) agora mora em `src/store/seed.json`, lida via
`readFileSync` e validada contra os esquemas zod do domínio (com `z.coerce.date()` para
os campos de data, que chegam como string ISO no JSON) em `src/store/seed.ts`. O JSON é
a "base de dados" desta fase: as ferramentas leem o que já existe nele; itens novos
(incidentes abertos durante uma execução) vivem apenas no `WorldState` em memória
construído a partir do arquivo — a execução não regrava o JSON.

**Rationale**: Decisão tomada com o usuário durante `/speckit-specify` (registrada em
`checklists/requirements.md`) e refinada durante a implementação: mover o literal para
um arquivo `.json` separa dado de código sem abandonar "in-memory nesta feature" — o
arquivo é lido uma vez por processo, exatamente como o literal TS era antes. Mantém
FR-035 trivialmente satisfeito — testes sem rede, sem container de banco,
determinísticos — e preserva o caminho para persistência durável via FR-017, sem tocar
em ferramentas nem estratégias.

**Alternatives considered**: Sequelize com SQLite em memória nos testes e MySQL em
produção — entrega persistência já nesta feature, ao custo de infraestrutura de banco
para rodar a arena e de I/O assíncrono no núcleo. Adiado para a feature seguinte.
Regravar `seed.json` a cada incidente aberto, para persistência entre execuções —
rejeitado por ora: introduziria I/O de escrita e problemas de concorrência que a decisão
"in-memory nesta feature" existe justamente para evitar; revisitar quando a persistência
durável entrar.

---

## R-009: Testes

**Decision**: `node:test` via `tsx`, arquivos `*.test.ts` colocados ao lado do código que
testam, cobrindo (a) transições do store e (b) `messagesToTrace` / formatação de rastro.

**Rationale**: O script `test` já declarado em `package.json`
(`node --import tsx --test src/**/*.test.ts`) fixa tanto o runner quanto a colocação dos
testes junto ao fonte. Os dois alvos exigidos por FR-034 são justamente as partes puras
do sistema, o que torna FR-035 (determinístico, sem rede) consequência do design e não
de mocks elaborados.

**Alternatives considered**: Vitest/Jest — dependência extra para o que `node:test` já
resolve. Diretório `tests/` separado — não casa com o glob já definido no script.

---

## R-010: Versão do Node — restrição bloqueante

**Decision**: Exigir **Node 22 LTS**, declarar `engines.node: ">=22"` em `package.json`, e
tratar a atualização do ambiente local como pré-requisito da implementação.

**Rationale**: Dois fatos verificados neste ambiente:

1. `@langchain/openai@1.5.13` declara `engines.node: ">=22"`, e a máquina atual roda
   **Node 20.6.0** — a instalação já emitiu `EBADENGINE`.
2. O glob `src/**/*.test.ts` do script de teste depende da expansão de globs feita pelo
   próprio `node --test`, disponível a partir do Node 21. No Node 20 a expansão recai
   sobre o shell, que em `sh` não expande `**` recursivamente — a suíte rodaria
   silenciosamente sobre um conjunto errado de arquivos.

Some-se a isso o bug do Node 20.6.0 que já impediu `npm run typecheck` de rodar via o
binário `tsc`. As três evidências apontam para a mesma ação.

**Alternatives considered**: Fixar versões antigas das bibliotecas compatíveis com Node
20 — contraria a stack declarada e adia o problema. Reescrever o script de teste com
lista explícita de arquivos — funciona no Node 20, mas não resolve o `EBADENGINE` do
`@langchain/openai`.

**Status**: ⚠️ Pré-requisito não satisfeito no ambiente atual. Ver `plan.md` → Constraints.

---

## Resolved Unknowns

Nenhum marcador `NEEDS CLARIFICATION` permanece. A única ambiguidade da spec (fonte de
verdade do estado) foi resolvida em R-008 antes desta fase.
