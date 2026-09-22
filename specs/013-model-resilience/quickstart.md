# Quickstart: Resiliência de Modelo

**Feature**: 013-model-resilience

A etapa 1 é o portão obrigatório (offline). As etapas 2 e 3 usam o provedor real e exigem
`OPENROUTER_API_KEY` no `.env`.

## 1. Portões offline

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, sem rede. Dois testes esperam de propósito a espera da biblioteca entre
tentativas, cerca de 7 s no total ([research R-013](./research.md#r-013--estratégia-de-testes-com-a-espera-fixa-da-biblioteca)).

## 2. Troca para o reserva no servidor real

Force a falha do principal com um modelo que não existe, que é erro não passageiro e vai direto
ao reserva:

```bash
OPENROUTER_MODEL=nao/existe OPENROUTER_MODEL_FALLBACK=<um modelo válido> npm run dev
```

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?"}' \
  | jq '{fallback: [.trace[] | select(.type=="fallback")], modelUsed: .metrics.modelUsed, status: "200"}'
```

Conferir:
- exatamente um evento `fallback`, com `reason: "non_transient"`, `from: "nao/existe"` e
  `nodeName: "router"`, porque o roteador é a primeira chamada do pedido
  ([MR1](./contracts/chat-endpoint.md#garantias));
- `metrics.modelUsed` igual ao reserva (MR3);
- no log do servidor, a troca registrada com o erro do provedor (MF9).

## 3. Nenhum modelo disponível

```bash
OPENROUTER_MODEL=nao/existe OPENROUTER_MODEL_FALLBACK=tambem/nao-existe npm run dev
```

```bash
curl -s -w '\n%{http_code}\n' localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?"}'
```

Esperado: `503` com `error.code: "model_unavailable"` e nenhum detalhe do provedor (MR4). O
roteador e o sumarizador falham antes, de forma aberta, e só a estratégia gera o 503 (MR6).

## 4. Sem reserva, nada muda

Sem `OPENROUTER_MODEL_FALLBACK`, com o modelo principal válido: a resposta é a mesma de antes
desta feature, mais `metrics.modelUsed` com o principal (SC-006).
