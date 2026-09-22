# Research: Resiliência de Modelo

**Feature**: 013-model-resilience | **Date**: 2026-09-22

Verificado no ambiente: Node v22.22.2, `@langchain/core` 1.2.11, `@langchain/openai` (a versão
instalada), `@langchain/langgraph` 1.4.15. Um spike offline (script descartável, modelos falsos
de `@langchain/core/utils/testing`) confirmou os pontos marcados **[spike]**.

---

## R-001 — `withRetry` e `withFallbacks` envolvem o modelo já preparado, não o modelo cru

**Decision**: a fábrica não devolve mais um `ChatOpenAI`. Ela expõe
`resilient(build, source?)`, que recebe como preparar um modelo (`m => m.bindTools(tools)`,
`m => m.withStructuredOutput(schema)`, ou `m => m`) e devolve:

```ts
primaryStep(build(primary)).withRetry({ stopAfterAttempt: 3, onFailedAttempt })
  .withFallbacks([backupStep(build(backup))])
```

**Rationale**: `withRetry` e `withFallbacks` devolvem `Runnable`s que não têm `bindTools` nem
`withStructuredOutput`. `createReactAgent` exige um de dois formatos: um chat model com
`bindTools`, ou uma **função** que devolve o modelo já pronto. O segundo caminho não tenta
ligar ferramentas de novo **[spike]**. Então o modelo é preparado primeiro (ferramentas ou
esquema), e a resiliência vem por fora. Cada ponto de chamada diz como prepara:

| Ponto de chamada | `build` |
|---|---|
| `react.ts`, executor do `plan-and-execute.ts` | `m => m.bindTools(tools)`, passado a `createReactAgent` como `llm: () => …` |
| planejador e revisor do `plan-and-execute.ts`, `router.ts`, `distiller.ts`, `critic.ts` | `m => m.withStructuredOutput(schema)` |
| `summarizer.ts` | `m => m` |

**Alternatives considered**:
- Uma subclasse de `BaseChatModel` que delega a dois modelos e reimplementa `bindTools` e
  `withStructuredOutput`: reimplementa a API do LangChain e foge do `withRetry`/`withFallbacks`
  pedidos.
- `withFallbacks` direto no `ChatOpenAI` cru: não funciona com ferramentas nem com saída
  estruturada, que é justamente o que todos os pontos de chamada usam.

## R-002 — O comportamento verificado de `withRetry` e `withFallbacks` nesta versão

**Decision**: usar os dois como estão, com três cuidados.

1. **Sem nova tentativa em erro não passageiro**: `withRetry` tenta de novo qualquer erro. O
   `onFailedAttempt` relança o erro quando `classifyModelError` diz que não é passageiro, e
   isso encerra as tentativas na hora **[spike: erro não passageiro = 1 tentativa]**.
2. **A espera não é configurável**: `RunnableRetry` chama o `p-retry` embutido com os padrões
   (cerca de 1 s e depois 2 s, aleatorizados), sem expor `minTimeout`. O `p-retry` também não é
   exportado pelo pacote. Três tentativas esgotadas custaram 5,7 s no spike. Os testes que
   esgotam as tentativas ficam restritos a dois (R-013).
3. **Cancelamento**: `RunnableWithFallbacks` chama `signal.throwIfAborted()` antes de cada
   alternativa, então um pedido cancelado nunca chega ao reserva. O cancelamento durante a
   espera entre tentativas também encerra: `AbortError` em ~200 ms, com uma tentativa só
   **[spike]**.

**Rationale**: o pedido nomeia `withRetry` e `withFallbacks`. Os três cuidados cabem nas opções
que eles já têm, sem reimplementar nada.

## R-003 — `maxRetries: 0` nos dois `ChatOpenAI`

**Decision**: `createChatModel(id)` passa `maxRetries: 0`.

**Rationale**: o cliente `openai` já roda com `maxRetries: 0`, mas o `AsyncCaller` do LangChain,
por baixo do `ChatOpenAI`, tenta até 6 vezes por padrão. Sem zerar, cada tentativa do
`withRetry` viraria até 7 chamadas ao provedor. FR-007.

## R-004 — Classificação dos erros: função pura sobre o que o `@langchain/openai` já marca

**Decision**: `classifyModelError(error): FailureKind | "aborted"`, pura, em `model.ts`:

| Erro recebido | Classe | Nova tentativa |
|---|---|---|
| `name === "AbortError"`, ou o `signal` do pedido abortado | `aborted` (não é falha de modelo) | não, e sem reserva |
| `name === "TimeoutError"` | `timeout` | não (FR-005), vai ao reserva |
| `status === 429` | `rate_limit` | sim |
| `status >= 500` | `provider_error` | sim |
| `APIConnectionError`, ou `TypeError` de rede | `network` | sim |
| qualquer outro (401, 404, 400, erro de parse da saída estruturada) | `non_transient` | não, vai ao reserva |

**Rationale**: o `wrapOpenAIClientError` do `@langchain/openai` já converte timeout em
`name: "TimeoutError"` e preserva `status` em 401/404/429 (verificado no código instalado).
Função pura, testada em tabela (Princípio I).

## R-005 — `ModelSource`: a fonte dos modelos é injetável e lê o ambiente só na chamada

**Decision**:

```ts
interface ModelSource {
  primary(): { id: string; model: BaseChatModel };
  backup(): { id: string; model: BaseChatModel } | null;
}
function envModelSource(): ModelSource;   // lê OPENROUTER_* na chamada de primary()/backup()
```

`backup()` devolve `null` quando `OPENROUTER_MODEL_FALLBACK` está ausente, vazio ou igual ao
principal (FR-002). Todo ponto de chamada recebe um `ModelSource` opcional, com padrão
`envModelSource()`. As fábricas que já existem (`createReactStrategy`, `createModelRouter`,
`createModelSummarizer`, `createModelDistiller`, `createLlmCritic`,
`createPlanAndExecuteStrategy`) ganham esse parâmetro opcional no fim.

**Rationale**: FR-003 e FR-026. É o mesmo padrão da 009, 011 e 012: nada lê ambiente ao ser
construído. Os testes passam uma fonte com modelos falsos e ids fixos, sem rede.

**Alternatives considered**: um setter global de modelo para os testes. É estado de módulo
compartilhado entre testes, o que o Princípio V proíbe (estado isolado por teste).

## R-006 — A troca vale para o resto do pedido por um `AsyncLocalStorage` (FR-011a)

**Decision**: `model.ts` exporta `runWithResilienceScope(fn)`, que roda `fn` dentro de um
`AsyncLocalStorage<{ primaryDown: boolean }>`. O passo do principal consulta o escopo: com
`primaryDown`, lança na hora e o `withFallbacks` vai direto ao reserva, sem novas tentativas. O
passo do reserva marca `primaryDown = true` ao ser usado. `createProductionGraph().run` roda o
grafo dentro de um escopo novo por pedido. Arena e bench não abrem escopo: cada chamada decide
sozinha **[spike: segunda chamada no mesmo escopo = 0 tentativas no principal]**.

**Rationale**: a alternativa seria passar um estado por pedido por todas as assinaturas
(estratégias, decoradores, nós), só para isso. O `AsyncLocalStorage` atravessa `await`s e o
próprio LangChain, que já usa o mesmo mecanismo para propagar configuração. O escopo não sai do
pedido, e o próximo começa limpo.

**Alternatives considered**: um disjuntor por processo, com o principal pulado por N segundos
para todos os pedidos. Afeta pedidos que não viram a falha, e o pedido não pediu isso.

## R-007 — O evento `fallback` e o `modelUsed` chegam por eventos customizados de callback

**Decision**: os passos do principal e do reserva despacham, com `dispatchCustomEvent` e a
config da própria chamada:

- `opspilot:model_used` `{ model }`, depois de cada chamada atendida (principal ou reserva);
- `opspilot:model_fallback` `{ from, to, reason }`, quando o reserva assume.

Quem escuta:
- **Estratégias e crítico**: o `LlmCallCounter` de cada execução, que já é passado
  explicitamente em `callbacks`, ganha `handleCustomEvent`. Guarda os eventos `fallback` em
  ordem e o último `model` usado.
- **Roteador e sumarizador**, que não passam callbacks: um `FallbackRecorder` por pedido,
  passado em `graph.invoke(…, { callbacks: [recorder] })` e herdado implicitamente pelas
  chamadas desses nós. Os nós `context` e `router` leem do recorder os eventos gravados
  durante a própria execução e os carimbam com seu `nodeName`.

**[spike]**: um handler passado explicitamente numa chamada recebe o evento customizado dela; um
handler passado ao `graph.invoke` recebe o de uma chamada que não passa callbacks; e callbacks
explícitos substituem os herdados, então o recorder do grafo não recebe duplicado o que já foi
para o contador da estratégia.

**Rationale**: não muda a assinatura de `Router` nem de `Summarizer`. A informação sai de onde a
troca acontece, e não de uma inferência sobre as mensagens.

## R-008 — Onde os eventos `fallback` entram no rastro

**Decision**:
- ReAct e Plan-and-Execute: `trace = [...counter.fallbackEvents, ...rastro]`.
- `withReflection`: cada tentativa já traz os seus, e os do crítico entram logo antes do
  `critique` correspondente.
- Nós `context` e `router`: antes do `summarize` e do `route`, respectivamente.

**Rationale**: FR-013 (revisto): no início do trecho do nó em que aconteceram. Com a troca
valendo para o resto do pedido (R-006), há no máximo um evento `fallback` por pedido do `/chat`,
e posicionar dentro do trecho não muda nada que se leia. Na arena, sem escopo, pode haver mais
de um, e eles saem juntos no início do trecho.

## R-009 — `modelUsed`: último `model_used` visto pelo contador da estratégia

**Decision**: `RunMetrics.modelUsed?: string`, preenchido por `react`, `plan-and-execute` e
`withReflection` (que o copia da última tentativa, porque a resposta é dela, e não do crítico).
Ausente quando nenhuma chamada foi atendida (estratégia falsa, nos testes). O nó `response` não
mexe nele.

**Rationale**: FR-015. A última chamada atendida é a que produz a resposta: a última iteração no
ReAct; o `encerrar` do revisor, ou o último passo sem revisor, no Plan-and-Execute.

## R-010 — `llmCalls` conta chamadas concluídas (emenda à 010)

**Decision**: `LlmCallCounter` passa a contar em `handleLLMEnd`, não em `handleChatModelStart`.
`promptTokens` continua ausente se alguma chamada **concluída** não reportou consumo.

**Rationale**: FR-024. Com novas tentativas, contar inícios somaria tentativas que falharam, e um
único erro passageiro tornaria `promptTokens` ausente. O motivo original da 010 (uma soma parcial
nunca apresentada como total) continua valendo para as chamadas que responderam.

## R-011 — `ModelUnavailableError` e o 503

**Decision**: o passo do reserva, e o próprio `resilient` quando não há reserva, relançam uma
falha de modelo como `ModelUnavailableError { tried: string[]; reason: FailureKind }`, exportado
de `model.ts`. Cancelamento é relançado intacto. No handler, `ModelUnavailableError` vira 503
`model_unavailable`, com mensagem fixa e sem `details` de provedor. O `ChatErrorCode` ganha
`model_unavailable`.

**Rationale**: FR-011 e FR-018. `withFallbacks` relança o erro do **principal** quando tudo
falha, então a identificação precisa vir de um invólucro próprio. Um teste do grafo confirma que
o LangGraph repassa a instância sem embrulhá-la (tarefa), porque o handler depende do
`instanceof`.

## R-012 — Falha aberta continua onde já existia

**Decision**: nenhuma mudança em roteador (recua para `react`), sumarizador (segue sem resumo
novo), crítico (entrega a resposta corrente) e refletor (só log). Eles já capturam qualquer
erro, então `ModelUnavailableError` também. Só a estratégia deixa o erro subir.

**Rationale**: FR-021.

## R-013 — Estratégia de testes com a espera fixa da biblioteca

**Decision**: modelos falsos que falham com erros com `status` e `name` controlados.
- Só dois testes esgotam as tentativas com erro passageiro: "exatamente 3 tentativas" e
  "passageiro seguido de sucesso". Juntos, ~7 s.
- Todo o resto usa erro não passageiro (401/404), que vai ao reserva sem espera.
- O cancelamento durante a espera usa o comportamento da R-002 (~200 ms).

**Rationale**: FR-026 revisto. O custo é aceito em troca de usar o `withRetry` pedido, e a suíte
continua offline e determinística quanto ao resultado. A espera muda, o desfecho não.

## R-014 — O que muda para quem usa o `/chat` e o `.env`

**Decision**: `.env.example` ganha `OPENROUTER_MODEL_FALLBACK=`, comentado como opcional. O
README ganha a variável, o 503, o evento `fallback` (com a distinção do `route` com `source:
"fallback"` da 012) e o `metrics.modelUsed`.

**Rationale**: FR-025.
