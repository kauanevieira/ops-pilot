# Contract: `GET /requests/:id`

**Feature**: `014-request-tracing` | Satisfaz FR-015 a FR-018

## Requisição

`GET /requests/:id`. Sem corpo, sem autenticação, sem parâmetros de consulta.

## Resposta 200

```jsonc
{
  "request": {
    "requestId": "3f2b9c1e-7a4d-4b8e-9f10-2c6d5e8a1b47",
    "receivedAt": "2026-10-07T14:03:11.204Z",
    "durationMs": 8412,
    "status": 200,
    "errorCode": null,
    "conversationId": "c-…",
    "userId": "ana",
    "route": "react",
    "strategy": "react",
    "routeSource": "router",
    "stoppedReason": "completed",
    "llmCalls": 3,
    "promptTokens": 4120,
    "modelUsed": "meta-llama/llama-3.3-70b-instruct:free",
    "historyMessages": 4,
    "summaryCoveredMessages": 0,
    "recalledMemories": 1,
    "traceEvents": 6
  },
  "trace": [
    { "type": "route", "route": "react", "strategy": "react", "reason": "…", "source": "router", "nodeName": "router" },
    { "type": "thought", "content": "…", "nodeName": "react" },
    …
  ]
}
```

Pedido que terminou em erro: `status` e `errorCode` preenchidos, campos de execução `null`,
`traceEvents: 0`, `trace: []`.

## Resposta 404

```json
{ "error": { "code": "request_not_found", "message": "Pedido não encontrado." , "details": { "requestId": "…" } } }
```

## Garantias

- **RQ1**: `trace` vem ordenado por posição original, e cada evento é idêntico (deep-equal) ao
  entregue pelo `/chat` naquele pedido, inclusive `nodeName` (FR-016).
- **RQ2**: todas as chaves de `request` estão sempre presentes. Valor desconhecido é `null`.
- **RQ3**: id inexistente ou de formato qualquer devolve 404 `request_not_found`, nunca 400 nem 500.
- **RQ4**: somente leitura. Não grava registro, não emite `X-Request-Id` nem linha de log de
  pedido (FR-018).
- **RQ5**: disponível depois de reiniciar o servidor (mesmo arquivo `OPSPILOT_DB`).
