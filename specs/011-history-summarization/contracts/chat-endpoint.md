# Contract: `POST /chat` (emenda)

**Feature**: `011-history-summarization` | Satisfaz FR-017 a FR-029

> **Emendado também por `012-unified-graph`**: o evento `summarize`, quando presente,
> continua na posição 0 do rastro — agora sempre seguido por um evento `route` (presente
> em todo pedido, com ou sem sumarização), antes dos eventos da estratégia. Todo evento
> do rastro, incluindo `summarize`, ganha `nodeName` (`"context"` no caso do
> `summarize`). Nada do que este documento descreve muda. Ver
> [`specs/012-unified-graph/contracts/chat-endpoint.md`](../../012-unified-graph/contracts/chat-endpoint.md).

Emenda [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md),
já emendado pela 007, 008, 009 e 010. **Corpo da requisição e corpos de erro não mudam.**

## O que muda para quem chama

1. **Janela menor**: o agente recebe na íntegra as 8 mensagens mais recentes da conversa (eram
   12), mais as que já saíram da janela e ainda não foram resumidas, até 15 no total.
2. **Resumo**: o que sai da janela é resumido a cada 8 mensagens e entregue ao agente antes
   das mensagens.
3. **200**: o rastro pode começar com um evento `summarize`, e `metrics` ganha
   `summaryCoveredMessages` e `contextBreakdown.summary`.

## Resposta 200

```jsonc
{
  "answer": "…",
  "trace": [
    { "type": "summarize", "content": "Decidido abrir INC no checkout-api (alta). …", "absorbedMessages": 8 },  // NOVO, só quando resumiu
    { "type": "thought", "content": "…" },
    …
  ],
  "stoppedReason": "completed",
  "conversationId": "…",
  "metrics": {
    "llmCalls": 3,                    // NÃO inclui o sumarizador
    "latencyMs": 6120,                // inclui a sumarização
    "historyMessages": 8,             // só mensagens na íntegra
    "summaryCoveredMessages": 8,      // NOVO: mensagens cobertas pelo resumo entregue; 0 sem resumo
    "promptTokens": 5873,             // NÃO inclui o sumarizador
    "contextBreakdown": {
      "message": 14,
      "history": 96,
      "summary": 52,                  // NOVO: estimativa do bloco do resumo; 0 sem resumo
      "memories": 21,
      "total": 183                    // agora soma as quatro fontes
    }
  }
}
```

`summaryCoveredMessages` aparece em todo 200 que passa por `withConversationHistory`, ou seja,
em todo 200 do `/chat`.

## Garantias

- **SM1**: o evento `summarize` aparece no máximo uma vez, na posição 0 do rastro, e só no
  pedido que gravou um resumo novo (FR-022).
- **SM2**: falha, tempo esgotado ou resumo vazio do sumarizador não alteram o status nem a
  forma da resposta: 200 sem evento, `summaryCoveredMessages` igual ao do resumo anterior
  (FR-011, SC-006).
- **SM3**: `llmCalls` e `promptTokens` não contam a chamada do sumarizador (FR-026).
  `latencyMs` é medido pelas estratégias e também não a inclui. O tempo total do pedido,
  visto pelo cliente, inclui.
- **SM4**: `contextBreakdown` tem sempre cinco chaves; `total === message + history + summary +
  memories`. Emenda a M5/M7 da 010.
- **SM5**: a soma dos comprimentos dos blocos de memórias, resumo e histórico mais a mensagem é
  igual ao comprimento da entrada entregue à estratégia (extensão de M6 da 010).
- **SM6**: sem `conversationId`, nada muda: sem resumo, sem sumarização, `summaryCoveredMessages:
  0`, `contextBreakdown.summary: 0`.
- **SM7**: a sumarização conta dentro do prazo do pedido (504 se o total passar dele) e é
  cancelada com ele. O resumo já gravado permanece mesmo se o pedido depois der 504 ou 500.
- **SM8**: `conversationId` inexistente continua 404 antes de qualquer execução, e portanto
  antes de qualquer sumarização.

## Ordem do handler

Com os acréscimos em negrito:

```text
parse (400) → estratégia (422) → conversa (404, agora por countMessages)
  → runChat, com prazo (504/500):
      **[com conversationId: prepareConversationContext]** ‖ [com userId: recall fail-open]   (em paralelo)
      → [com userId: withMemory] → withConversationHistory(**{ summary, messages, summaryCoveredMessages }**)
      → run
      → **trace = [summarizeEvent?, …result.trace]**
      → metrics.contextBreakdown = buildContextBreakdown({ message, history, **summary**, memories })
  → append da rodada → 200 → [com userId: learn…] (009)
```

## `ChatAppDeps`

| Campo novo | Default | Testes |
|---|---|---|
| `summarizer?: Summarizer` | `createModelSummarizer()` (só construído, não lê env) | fake determinístico em `withServer` (R-015) |
| `summaryTimeoutMs?: number` | `SUMMARY_TIMEOUT_MS` (30 s) | curto, nos casos de tempo esgotado |

`src/index.ts` passa `createModelSummarizer()` explicitamente, como faz com o distiller.

## Aviso na 003 e na 007

O bloco de emendas da 003 ganha:

> **Emendado também por `011-history-summarization`**: janela de 8 mensagens mais resumo
> cumulativo do que sai dela; evento `summarize` no rastro; `metrics.summaryCoveredMessages`
> e `contextBreakdown.summary`. Ver [`specs/011-history-summarization/contracts/chat-endpoint.md`](../../011-history-summarization/contracts/chat-endpoint.md).

A spec da 007 ganha, no FR-018, a nota: *"Janela reduzida para 8 por 011-history-summarization
(FR-001), que resume o que sai dela."*
