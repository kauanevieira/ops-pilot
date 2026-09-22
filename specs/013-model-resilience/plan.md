# Implementation Plan: Resiliência de Modelo

**Branch**: `013-model-resilience` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-model-resilience/spec.md`

## Summary

A fábrica de modelos (`src/agents/model.ts`) passa a montar cada chamada com `withRetry` no
modelo principal, com até 3 tentativas e só em falha passageira, e `withFallbacks` para um reserva
opcional, `OPENROUTER_MODEL_FALLBACK`. Num pedido do `/chat`, a troca vale para o resto do
pedido. Cada troca vira um evento `fallback` no rastro, `metrics.modelUsed` diz qual modelo
produziu a resposta, e, se nenhum modelo atender a estratégia, o `/chat` responde 503
`model_unavailable`.

Decisões da Fase 0, com as duas perguntas da spec resolvidas sem resposta pelas opções mais
simples de sustentar:

1. **Resiliência por fora do modelo já preparado** (R-001). `withRetry`/`withFallbacks` não têm
   `bindTools` nem `withStructuredOutput`, então cada ponto de chamada prepara o modelo, e a
   fábrica envolve o resultado. O ReAct recebe o modelo como função, formato que o
   `createReactAgent` aceita sem religar ferramentas. Verificado em spike.
2. **Troca válida para o resto do pedido** (R-006, Q1), por um `AsyncLocalStorage` aberto por
   pedido. Sem isso, um principal fora cobraria tentativas e esperas em cada iteração do ReAct.
3. **`modelUsed` é o modelo da resposta final** (R-009, Q2), uma string.
4. **Eventos customizados de callback** levam a troca e o modelo usado de onde acontecem até o
   contador da estratégia, ou até um recorder por pedido, no caso do roteador e do sumarizador
   (R-007). Nenhuma assinatura de `Router` ou `Summarizer` muda.
5. **Três ajustes descobertos no código instalado** e levados à spec: `maxRetries: 0` no
   `ChatOpenAI`, que tentava até 6 vezes por baixo (R-003); tempo esgotado não é tentado de
   novo (FR-005); e a espera entre tentativas é a fixa da biblioteca (R-002, R-013).

## Technical Context

**Language/Version**: TypeScript em ESM, `strict: true`. Node 22.22.2.

**Primary Dependencies**: nenhuma nova. `@langchain/core` 1.2.11 (`withRetry`, `withFallbacks`,
`RunnableLambda`, `dispatchCustomEvent`), `@langchain/openai` (classificação de erros já feita
por `wrapOpenAIClientError`) e `node:async_hooks` (`AsyncLocalStorage`).

**Storage**: nenhuma mudança.

**Testing**: `node:test`. Tabela para `classifyModelError` e para a leitura de ambiente.
`resilient` com `fakeSource` de modelos falsos que falham com `status`/`name` controlados. O
contador com eventos customizados. O grafo e o `/chat` com fontes falsas injetadas nas fábricas.
Dois testes aceitam a espera real da biblioteca (~7 s). Nenhum teste chama o provedor.

**Target Platform**: servidor Node local.

**Project Type**: Single project.

**Performance Goals**: sem falha, nenhum custo extra além de um `AsyncLocalStorage` por pedido.
Com o principal fora: uma troca por pedido, e o resto do pedido direto no reserva.

**Constraints**:
- `npm test` offline (Princípio V). `envModelSource()` não lê o ambiente ao ser construído.
- Tudo dentro do prazo de 180 s. Cancelamento nunca vira tentativa nem troca.
- Arena, bench e MCP ganham a resiliência, mas não o escopo por pedido. Saída idêntica sem troca.
- `llmCalls` passa a contar só chamadas concluídas: emenda explícita à 010 (R-010). O
  `llm-counter.test.ts` muda nesse ponto.

**Scale/Scope**: nenhum módulo novo. Alterados: `agents/model.ts` (reescrita), `agents/llm-counter.ts`,
os 7 pontos de chamada (`react.ts`, `plan-and-execute.ts`, `critic.ts`, `router.ts`,
`reflection.ts`, `context/summarizer.ts`, `memory/distiller.ts`), `agents/production-graph.ts`,
`domain/schemas.ts`, `trace/types.ts`, `trace/format.ts`, `http/errors.ts`, `http/chat.ts`,
`.env.example`, README, testes correspondentes e avisos na 003, 010 e 012.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `failureKindSchema` e `modelIdSchema` definidos uma vez em `src/domain/schemas.ts`. `classifyModelError` é pura. O ambiente é lido num só ponto, `envModelSource()`, e só na chamada | ✅ Passa |
| **II. Persistência Local em SQLite** | Nenhuma mudança | ✅ N/A |
| **III. Contrato Antes de Código** | [model-factory.md](./contracts/model-factory.md) e [chat-endpoint.md](./contracts/chat-endpoint.md). Avisos na 003 (503), na 010 (`llmCalls`) e na 012 (evento `fallback` e `nodeName`), `.env.example` e README na mesma mudança | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | Nenhuma ferramenta nova ou alterada | ✅ N/A |
| **V. Portões Offline e Determinísticos** | Fonte de modelos injetável (R-005), modelos falsos, nada de estado de módulo compartilhado entre testes. Dois testes esperam a espera real da biblioteca, sem afetar o determinismo do resultado | ✅ Passa |
| **Restrições: validação na borda** | IDs de modelo passam por `modelIdSchema` na leitura do ambiente | ✅ Passa |
| **Restrições: credenciais** | Nenhuma variável lida na construção. O erro do provedor fica só no log, nunca no corpo da resposta nem no rastro | ✅ Passa |
| **Restrições: erros** | `ModelUnavailableError` é falha técnica, não de domínio, e mora em `agents/model.ts`. A borda HTTP o traduz para 503 | ✅ Passa |

**Governança: complexidade adicional**:
- Nenhuma dependência nova, nenhum diretório novo.
- Um `AsyncLocalStorage` para o escopo por pedido (R-006). A alternativa mais simples, sem
  escopo e com cada chamada decidindo sozinha, foi descartada porque, com o principal fora,
  cada iteração de uma estratégia pagaria as tentativas e esperas de novo, até esgotar o prazo.
  Passar o estado por todas as assinaturas foi descartado por espalhar um detalhe de
  resiliência por estratégias, decoradores e nós.
- Um `FallbackRecorder` passado ao `graph.invoke`, em vez de mudar as assinaturas de `Router`
  e `Summarizer` (R-007).

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. O desenho não muda nenhuma interface pública da
012, só acrescenta um parâmetro opcional às fábricas.

## Project Structure

### Documentation (this feature)

```text
specs/013-model-resilience/
├── plan.md
├── spec.md
├── research.md              # Fase 0: 14 decisões, com spike
├── data-model.md            # FailureKind, ModelSource, fluxo de uma chamada, contador, recorder
├── quickstart.md
├── contracts/
│   ├── model-factory.md     # MF1–MF10, LC1–LC3, pontos de chamada
│   └── chat-endpoint.md     # emenda ao POST /chat: MR1–MR8, 503
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── domain/schemas.ts                  # + failureKindSchema, RETRYABLE_FAILURES, modelIdSchema
├── agents/
│   ├── model.ts                       # reescrito: ModelSource, envModelSource, createChatModel, resilient,
│   │                                  #   classifyModelError, runWithResilienceScope, ModelUnavailableError
│   ├── model.test.ts                  # NOVO: MF1–MF10
│   ├── llm-counter.ts                 # conta em handleLLMEnd; fallbackEvents, modelUsed (LC1–LC3)
│   ├── llm-counter.test.ts            # ajustado a LC1
│   ├── react.ts, plan-and-execute.ts  # resilient(...), source opcional, fallbackEvents no rastro, modelUsed
│   ├── critic.ts, reflection.ts       # resilient no crítico; modelUsed e fallbackEvents do crítico
│   ├── router.ts                      # resilient
│   └── production-graph.ts            # FallbackRecorder, escopo por pedido, eventos em context/router
├── context/summarizer.ts              # resilient
├── memory/distiller.ts                # resilient
├── trace/types.ts, format.ts          # + evento fallback; RunMetrics.modelUsed; rótulo [fallback]
└── http/
    ├── errors.ts                      # + model_unavailable
    ├── chat.ts                        # ModelUnavailableError → 503
    └── server.test.ts                 # MR1–MR8
.env.example                           # + OPENROUTER_MODEL_FALLBACK
```

**Structure Decision**: toda a resiliência fica em `agents/model.ts`, a fábrica única que o
pedido nomeia. Os pontos de chamada mudam só a forma de pedir o modelo. O grafo da 012 ganha só
o escopo por pedido e o recorder. O handler ganha só a tradução do erro.

### Ordem de implementação sugerida

1. Domínio (`failureKindSchema`). `model.ts`: `classifyModelError`, `envModelSource`,
   `createChatModel`, `resilient`, escopo, erro, com testes (MF1–MF10).
2. `llm-counter.ts` (LC1–LC3), com o teste ajustado.
3. Os 7 pontos de chamada com `resilient` e `source` opcional. `modelUsed` e `fallbackEvents`
   nas estratégias e na reflexão. Tipos do rastro e `format.ts`. Neste ponto US1 (P1) está
   entregue, porque o pedido sobrevive à falha.
4. `production-graph.ts`: escopo por pedido, recorder, eventos nos nós. Com isso a US2 (P1)
   fica completa.
5. `errors.ts` e `chat.ts`: 503, que completa a US3. Testes do `/chat`.
6. `.env.example`, README, avisos na 003, 010 e 012.

### Riscos

| Risco | Mitigação |
|---|---|
| O LangGraph embrulha o `ModelUnavailableError` e o `instanceof` do handler falha | Teste do grafo que confere a instância (R-011). Se embrulhar, o handler examina `error.cause` |
| Um evento customizado não chega ao contador de dentro do `createReactAgent` | O spike cobriu handler explícito numa chamada. Teste da estratégia com fonte falsa confere o evento no rastro |
| `AsyncLocalStorage` perde o escopo em algum ponto assíncrono do LangChain | O spike mostrou o escopo atravessando `withRetry`/`withFallbacks`. Teste do grafo com duas chamadas no mesmo pedido confere que a segunda pula o principal |
| A espera fixa da biblioteca torna a suíte mais lenta | Só dois testes esperam (~7 s). O resto usa erro não passageiro |
| O reserva tem qualidade pior e isso passa despercebido | `modelUsed` em toda resposta, evento `fallback` e log. A arena e o bench registram `modelUsed` |
| Mudar `llmCalls` para chamadas concluídas altera números comparados na 010 | Emenda documentada. Sem falha, o número é o mesmo de antes |

## Complexity Tracking

Nenhuma violação a justificar. O escopo por pedido e o recorder estão justificados acima, em
Governança.
