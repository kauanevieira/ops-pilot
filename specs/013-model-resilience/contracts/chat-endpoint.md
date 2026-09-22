# Contract: `POST /chat` (emenda)

**Feature**: `013-model-resilience` | Satisfaz FR-012 a FR-022, FR-025

Emenda [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md),
já emendado pela 007 a 012. **O corpo da requisição não muda.**

## O que muda para quem chama

1. Uma falha passageira do modelo principal é tentada de novo, e uma falha persistente passa ao
   reserva (`OPENROUTER_MODEL_FALLBACK`), sem erro para o cliente.
2. **200**: o rastro pode trazer um evento `fallback`, e `metrics` ganha `modelUsed`.
3. **503** `model_unavailable` quando nenhum modelo atendeu a estratégia.

## Resposta 200 com troca

```jsonc
{
  "trace": [
    { "type": "fallback", "from": "meta-llama/llama-3.3-70b-instruct:free",
      "to": "openai/gpt-4o-mini", "reason": "rate_limit", "nodeName": "router" },   // NOVO
    { "type": "route", "route": "react", "strategy": "react", "reason": "…",
      "source": "router", "nodeName": "router" },
    { "type": "thought", "content": "…", "nodeName": "react" },
    …
  ],
  "metrics": {
    "llmCalls": 3,                          // só chamadas concluídas
    "modelUsed": "openai/gpt-4o-mini",      // NOVO: modelo da resposta final
    …
  }
}
```

## Resposta 503

```json
{ "error": { "code": "model_unavailable", "message": "Nenhum modelo disponível para atender o pedido. Tente novamente em instantes." } }
```

## Garantias

- **MR1**: no máximo um evento `fallback` por pedido do `/chat`, com o `nodeName` do nó em que a
  troca aconteceu, no início do trecho desse nó (FR-013, FR-011a).
- **MR2**: nova tentativa bem-sucedida no principal não gera evento (FR-014).
- **MR3**: `metrics.modelUsed` está presente sempre que ao menos uma chamada da estratégia foi
  atendida, e é o modelo da última delas (FR-015).
- **MR4**: `ModelUnavailableError` vindo da estratégia vira 503 `model_unavailable`, sem
  `details`. O turno não é gravado e o refletor de aprendizado não roda (FR-018, FR-019).
- **MR5**: outros erros técnicos continuam 500 `internal`. Prazo esgotado continua 504
  `timeout`, mesmo durante tentativas ou troca (FR-020).
- **MR6**: falha de modelo no roteador, no sumarizador ou no crítico não vira 503. Vale a falha
  aberta de cada um (FR-021).
- **MR7**: o evento `fallback` não tem relação com o `route` de `source: "fallback"` (012). O
  primeiro é troca de modelo, o segundo é recuo de estratégia.
- **MR8**: cada pedido começa com a troca desligada. Um pedido que usou o reserva não afeta o
  seguinte.

## Ordem do handler

```text
parse (400) → [override: resolveStrategy (422)] → conversa (404)
  → runWithResilienceScope( graph.run(…, callbacks: [recorder]) ), com prazo (504)
      erro ModelUnavailableError → 503 | outro erro → 500
  → grava o turno → 200 → [userId: aprendizado]
```

## `.env.example`

```text
# Modelo reserva, usado quando o principal falha (opcional).
OPENROUTER_MODEL_FALLBACK=
```
