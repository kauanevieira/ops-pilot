# Implementation Plan: Estatísticas de Pedidos

**Branch**: `015-request-stats` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

## Summary

`GET /stats?since=24h` lê os registros da janela na tabela `requests` (014) e agrega por uma
função pura: totais, erros por código, tokens de entrada, custo estimado (`:free` = 0, demais
pela tabela `OPENROUTER_PRICES`), p50/p95 da duração dos 200, e os mesmos números por rota e
por modelo. Contrato: [contracts/stats-endpoint.md](./contracts/stats-endpoint.md).

## Technical Context

- **Stack**: a mesma da 014. Nenhuma dependência nova.
- **Storage**: `requests` ganha o índice `idx_requests_received_at` (idempotente) e o
  `RequestStore` ganha `listSince(from, to)`, uma consulta com statement preparado. Datas ISO-8601
  UTC comparam lexicograficamente.
- **Testing**: `node:test`. A função pura com registros montados no teste, o store sobre
  `:memory:` e o endpoint via `createApp` com `now` e `modelPrices` injetados.

## Decisões

1. **Agregação em TypeScript, não em SQL**: o SQLite não tem percentil, e a regra de custo por
   modelo (`:free`, tabela) é lógica de domínio. Uma função pura em `src/obs/stats.ts`
   (Princípio I) recebe registros, janela e preços.
2. **Preços por ambiente, lidos uma vez em `src/index.ts`** e injetados no `createApp`
   (`modelPrices`, default `{}`), validados por zod. Os testes nunca leem o ambiente.
3. **`invalid_query` não entra em `chatErrorCodeSchema`**: esse enum é o `CHECK` de
   `requests.error_code`, e `/stats` nunca grava registro. `errors.ts` ganha
   `ApiErrorCode = ChatErrorCode | "invalid_query"` para o corpo de erro.
4. **Nearest-rank** para percentil: sem interpolação, sempre um valor observado.

## Constitution Check

| Princípio | Veredito |
|---|---|
| I. Domínio puro | ✅ `parseSince`, `percentile`, `costOf` e `computeStats` puras. Relógio injetado |
| II. SQLite | ✅ Índice idempotente, consulta com statement preparado, nenhuma tabela nova |
| III. Contrato antes | ✅ Contrato `stats-endpoint.md`, README e `.env.example` na mesma mudança |
| IV. Ferramentas | N/A |
| V. Offline | ✅ Sem rede: preços vêm do ambiente, nunca da API do OpenRouter |

## Source Code

```text
src/obs/stats.ts            # NOVO: parseSince, percentile, costOf, computeStats (puras)
src/obs/stats.test.ts       # NOVO
src/obs/pricing.ts          # NOVO: modelPricesSchema, readModelPrices(env)
src/obs/request-store.ts    # + índice, listSince
src/http/stats.ts           # NOVO: handler GET /stats
src/http/errors.ts          # ApiErrorCode (+ invalid_query)
src/http/server.ts          # deps modelPrices; rota
src/index.ts                # lê OPENROUTER_PRICES
.env.example, README.md
```
