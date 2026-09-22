# Contract: `POST /chat` (emenda)

**Feature**: `010-context-measurement` | Satisfaz FR-005 a FR-017

> **Emendado por `011-history-summarization`**: `contextBreakdown` (M5/M7 abaixo) ganha
> uma quinta chave, `summary` — `total` passa a somar quatro estimativas, não três.
> `history` continua cobrindo só as mensagens entregues na íntegra. Ver
> [`specs/011-history-summarization/contracts/chat-endpoint.md`](../../011-history-summarization/contracts/chat-endpoint.md).
>
> **Emendado também por `013-model-resilience`**: `llmCalls` passa a contar só chamadas
> CONCLUÍDAS (uma tentativa que falhou e foi repetida, ou substituída pelo reserva, não
> conta mais). `promptTokens` continua ausente se alguma chamada concluída não reportou
> consumo, mas uma chamada que nunca chegou a concluir não torna mais o total ausente —
> ela simplesmente não é contada. Sem falha de modelo, os números não mudam. Ver
> [`specs/013-model-resilience/contracts/model-factory.md`](../../013-model-resilience/contracts/model-factory.md).

Emenda [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md),
já emendado pela 007, 008 e 009. **Corpo da requisição e corpos de erro não mudam.** No 200,
`metrics` ganha dois campos opcionais.

## Resposta 200: `metrics`

```jsonc
{
  "answer": "…",
  "trace": [ … ],
  "stoppedReason": "completed",
  "conversationId": "…",
  "metrics": {
    "llmCalls": 3,
    "latencyMs": 4120,
    "historyMessages": 4,
    "recalledMemories": 1,
    "promptTokens": 5873,           // NOVO: real, reportado pelo provedor; pode faltar
    "contextBreakdown": {           // NOVO: estimativa local (caracteres ÷ 4), sempre presente no 200
      "message": 14,
      "history": 96,
      "memories": 21,
      "total": 131
    }
  }
}
```

| Campo | Natureza | Presença |
|---|---|---|
| `promptTokens` | **real**: soma dos tokens de entrada reportados pelo provedor em todas as chamadas contadas em `llmCalls` | ausente quando alguma dessas chamadas não reportou consumo |
| `contextBreakdown` | **estimativa**: só das fontes que o pedido compõe | sempre, em todo 200 |

`contextBreakdown.total` não é comparável a `promptTokens`, e o sistema não tenta
reconciliá-los (FR-013). A diferença inclui o que a decomposição não cobre: instruções das
estratégias, esquemas de ferramentas, o rastro que cresce a cada iteração, e cada chamada
repetida (um ReAct com 3 chamadas envia o contexto 3 vezes).

## Garantias

- **M1**: `promptTokens` cobre exatamente as chamadas de `llmCalls`: base, crítico e todas as
  tentativas quando `reflect: true` (FR-005, FR-007).
- **M2**: uma chamada contada sem consumo reportado remove `promptTokens` da resposta; nunca
  aparece soma parcial (FR-006).
- **M3**: a chamada do refletor (009), feita depois do 200, não entra em `promptTokens`
  (FR-009).
- **M4**: dois pedidos simultâneos não trocam consumo entre si (FR-008); contadores são por
  `run()`.
- **M5**: `contextBreakdown` tem sempre as quatro chaves. Fonte ausente vale `0` (FR-011).
- **M6**: `message` estima a `message` do corpo depois do `trim`. `history` estima o bloco que
  `withConversationHistory` prefixa. `memories` estima o bloco que `withMemory` prefixa. A soma
  dos comprimentos dos três textos é igual ao comprimento da entrada entregue à estratégia
  (research R-007).
- **M7**: `total === message + history + memories` (FR-012).
- **M8**: corpos 400/404/422/504/500 idênticos aos da 009 (FR-016).

## Ordem do handler

Com o acréscimo em negrito:

```text
parse (400) → estratégia (422) → conversa (404)
  → [com userId: recall fail-open + withMemory] → withConversationHistory → run com prazo (504/500)
  → **metrics.contextBreakdown = buildContextBreakdown({ message, history, memories })**
  → append da rodada → 200 → [com userId: learn…] (009)
```

A decomposição é anexada dentro de `runChat()`, depois do `run` e fora de todos os
decoradores. O `withReflection` reconstrói `metrics` e apagaria qualquer campo anexado por
dentro.

## Aviso na 003

O bloco de emendas no topo do contrato da 003 ganha:

> **Emendado também por `010-context-measurement`**: no 200, `metrics` ganha `promptTokens`
> (tokens de entrada reais, somados em todas as chamadas do pedido; ausente se o provedor não
> reportar) e `contextBreakdown` (estimativa por fonte: mensagem, histórico, memórias, total).
> Ver [`specs/010-context-measurement/contracts/chat-endpoint.md`](../../010-context-measurement/contracts/chat-endpoint.md).
