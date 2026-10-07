# Contract: `GET /stats`

**Feature**: `015-request-stats` | Satisfaz FR-001 a FR-009

## Requisição

`GET /stats?since=24h`. `since` opcional: `^[1-9][0-9]*(m|h|d)$`, até 90 dias. Padrão: `24h`.

## Resposta 200

```jsonc
{
  "since": "24h",
  "from": "2026-10-06T14:00:00.000Z",
  "to": "2026-10-07T14:00:00.000Z",
  "total": 42,
  "errors": 3,
  "errorsByCode": { "timeout": 1, "unknown_strategy": 2 },
  "promptTokens": 183420,
  "costUsd": 0.0123,               // estimado, só tokens de entrada
  "unpricedRequests": 0,
  "latencyMs": { "p50": 4210, "p95": 18750 },   // só pedidos 200; null sem nenhum
  "byRoute": [
    { "route": "react", "requests": 30, "promptTokens": 90000, "costUsd": 0, "unpricedRequests": 0,
      "latencyMs": { "p50": 3100, "p95": 9000 } }
  ],
  "byModel": [
    { "model": "meta-llama/llama-3.3-70b-instruct:free", "requests": 35, "promptTokens": 150000,
      "costUsd": 0, "unpricedRequests": 0, "latencyMs": { "p50": 3900, "p95": 17000 } }
  ]
}
```

## Resposta 400

```json
{ "error": { "code": "invalid_query", "message": "since deve ser <número><m|h|d>, até 90d (ex.: 30m, 24h, 7d).", "details": { "since": "abc" } } }
```

## Garantias

- **ST1**: janela `[to − since, to]` por `received_at`, inclusiva nas duas pontas.
- **ST2**: `errors = total − (pedidos 200)`, e `Σ errorsByCode = errors`.
- **ST3**: `Σ byRoute[].requests = Σ byModel[].requests = pedidos 200`. Erros nunca entram nos grupos.
- **ST4**: custo de modelo `:free` é 0. Modelo pago sem preço ou pedido sem tokens entra em `unpricedRequests`, nunca em `costUsd`.
- **ST5**: percentil nearest-rank: o valor de posição `⌈q·n⌉` na lista ordenada.
- **ST6**: `costUsd` arredondado a 6 casas, grupos ordenados por `requests` decrescente e, no empate, pela chave.
- **ST7**: somente leitura. Não grava registro nem emite `X-Request-Id`.

## Configuração

`OPENROUTER_PRICES` (opcional): JSON `{ "<id do modelo>": <USD por 1M tokens de entrada> }`, validado
na partida. Valor inválido derruba a partida com mensagem, como `PORT`.
