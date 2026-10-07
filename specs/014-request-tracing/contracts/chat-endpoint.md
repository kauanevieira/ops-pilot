# Contract: `POST /chat` (emenda)

**Feature**: `014-request-tracing` | Satisfaz FR-001 a FR-005, FR-011, FR-012, FR-026

Emenda [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md),
já emendado pela 007 a 013. **O corpo da requisição não muda.**

> **Emendado por `016-war-room-web`**: para uma origem autorizada (`OPSPILOT_CORS_ORIGINS`) a
> resposta traz `Access-Control-Expose-Headers: X-Request-Id`, o que deixa o navegador ler o
> cabeçalho (RT1 continua valendo). O preflight `OPTIONS` termina antes do middleware de
> rastreio: não gera `requestId`, registro nem linha de log. Ver
> [`016-war-room-web/contracts/cors.md`](../../016-war-room-web/contracts/cors.md).

## O que muda para quem chama

1. Toda resposta traz o cabeçalho `X-Request-Id`.
2. O corpo 200 ganha `requestId`.
3. O corpo de erro ganha `requestId`, como chave irmã de `error`.

## Resposta 200

```jsonc
// X-Request-Id: 3f2b9c1e-7a4d-4b8e-9f10-2c6d5e8a1b47
{
  "answer": "…",
  "trace": [ … ],                // inalterado
  "metrics": { … },              // inalterado
  "stoppedReason": "completed",
  "conversationId": "…",
  "requestId": "3f2b9c1e-7a4d-4b8e-9f10-2c6d5e8a1b47"   // NOVO
}
```

## Resposta de erro (qualquer status)

```jsonc
// X-Request-Id: 3f2b9c1e-…
{
  "error": { "code": "timeout", "message": "A execução excedeu o tempo limite de 180000ms." },
  "requestId": "3f2b9c1e-…"      // NOVO
}
```

## Garantias

- **RT1**: `X-Request-Id` está presente em 100% das respostas do `/chat`: 200, 400 (inclusive
  JSON malformado), 404, 422, 500, 503 e 504. O cabeçalho e o corpo têm o mesmo valor.
- **RT2**: um `X-Request-Id` enviado pelo cliente é ignorado. O valor é sempre um UUID v4 gerado
  pelo servidor.
- **RT3**: o registro do pedido 200 está gravado antes de a resposta ser escrita
  (`GET /requests/:id` logo em seguida devolve 200).
- **RT4**: uma falha de gravação do registro não muda status, corpo nem cabeçalhos. O turno é
  gravado e o refletor de aprendizado roda como antes.
- **RT5**: todos os demais campos, códigos e mensagens continuam como estão.

## Ordem do handler (atualizada)

`requestTracking` (id, cabeçalho) → `express.json()` → validar corpo (400) →
[override: resolver estratégia (422)] → conversa (404) → grafo com prazo (504/503/500) →
gravar turno → **gravar registro e rastro** → **log `trace.event` × N** → 200 → refletor.
Nos erros, o registro é gravado no `finish` da resposta.
