# Quickstart: API HTTP de Chat

**Feature**: `003-chat-http-api` | **Date**: 2026-09-18

Guia de validação: como provar que a feature funciona ponta a ponta depois de implementada.
Não contém código de implementação — ver [contracts/](./contracts/) e
[data-model.md](./data-model.md) para as formas exatas.

---

## Pré-requisitos

1. **Node 22 LTS ou superior** (`node --version`; o ambiente atual roda **22.22.2**).
2. `npm install`. Esta feature **não acrescenta nenhuma dependência nova** — `express` e
   `@types/express` já estão no `package.json` e até aqui não eram usados.
3. As features 001 e 002 implementadas (`npm run arena` roda as quatro estratégias).
4. Credenciais do OpenRouter em `.env` — **apenas** para as validações online (3 em
   diante). As validações 1 e 2 rodam sem chave e sem rede.

---

## Validação 1 — Portões de qualidade (offline, obrigatória)

```bash
npm run typecheck
npm test
```

**Esperado**: ambos verdes, em menos de 30 segundos no total (SC-007), **sem nenhum acesso
à rede**. O teste de integração do endpoint usa uma estratégia falsa e determinística
injetada em `createApp` (R-007), então nada chama modelo.

Casos que os testes novos devem cobrir, no mínimo (FR-024):

| Caso | Requisição | Prova |
|---|---|---|
| Caminho feliz, estratégia padrão | `{ "message": "oi" }` | 200; `resolveStrategy` recebeu `name` indefinido e resolveu `react` (FR-007) |
| Escolha explícita de estratégia | `{ "message": "oi", "strategy": "plan-and-execute" }` | 200; a estratégia pedida foi a executada |
| Reflexão ligada | `{ "message": "oi", "reflect": true }` | 200; `resolveStrategy` recebeu `reflect: true` |
| Rastro e métricas intactos | qualquer 200 | corpo idêntico ao `StrategyResult` do dublê, mesma ordem de eventos (FR-004, R-012) |
| Corpo inválido | `{}` / `{ "message": "" }` / `{ "message": "oi", "reflect": "sim" }` | 400, `code: "invalid_body"`, `details` apontando o campo (FR-014) |
| JSON malformado | corpo `"{"` | 400, `code: "invalid_body"` — **não** HTML de stack trace (R-005) |
| Estratégia desconhecida | `{ "message": "oi", "strategy": "planner" }` | 422, `code: "unknown_strategy"`, `details.validStrategies` |
| Nome composto na API | `{ "message": "oi", "strategy": "reflect:react" }` | 422 — a reflexão é o campo `reflect` |
| Validação precede execução | corpo inválido | o dublê de estratégia **não** foi chamado (SC-003) |
| Tempo esgotado | dublê que nunca resolve, `timeoutMs` de dezenas de ms | 504, `code: "timeout"`, sem resposta parcial (FR-019, FR-025) |
| Cancelamento chega à estratégia | mesmo dublê | o `AbortSignal` recebido pelo `run()` foi abortado (FR-020) |
| Uma resposta só | dublê que resolve logo depois do deadline | exatamente um corpo enviado; sem `ERR_HTTP_HEADERS_SENT` (FR-021) |
| Falha inesperada | dublê que lança | 500, `code: "internal"`, sem stack no corpo; requisição seguinte ainda responde 200 (FR-017, SC-006) |
| Registry | — | casos de `registry.test.ts` preservados + `resolveStrategy` com/sem `reflect` e nome inválido |

---

## Validação 2 — Regressão da arena e do bench (offline)

A migração do registry para `src/agents/index.ts` não pode mudar nada observável (FR-012):

```bash
npm run arena -- "quais alertas estão abertos?" --strategies reflect:react
```

**Esperado**: falha só por falta de credencial (se não houver `.env`), **não** por
estratégia desconhecida. Com nome inválido, a mensagem continua listando os quatro nomes:

```bash
npm run arena -- "teste" --strategies nao-existe
```

**Esperado**: `Unknown strategy: "nao-existe". Valid strategies: react, plan-and-execute, reflect:react, reflect:plan-and-execute`.

---

## Validação 3 — Caminho feliz real (online)

```bash
npm run dev
```

Em outro terminal:

```bash
curl -sS -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"quais alertas estão abertos?"}' | jq
```

**Esperado**: 200 com `answer`, `trace`, `metrics` e `stoppedReason` (SC-001). O rastro deve
ter a mesma forma que `npm run arena` imprime para o mesmo pedido — mesmos eventos, mesma
ordem (FR-004).

Com reflexão:

```bash
curl -sS -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"quais alertas estão abertos?","reflect":true}' | jq '.trace[].type, .metrics'
```

**Esperado**: ao menos um evento `critique` no rastro e `llmCalls` maior que o da mesma
requisição sem `reflect` (FR-010, SC-002).

---

## Validação 4 — Erros distinguíveis (online, mas sem gastar modelo)

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' -d '{}'
# 400

curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' -d '{"message":"oi","strategy":"planner"}' | jq
# 422 + details.validStrategies

curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' -d '{"message":"oi","strategy":"reflect:react"}'
# 422
```

**Esperado**: três respostas distinguíveis só pelo corpo, sem consultar log (SC-004).
Nenhuma delas chega a chamar modelo.

---

## Validação 5 — Estado compartilhado entre requisições (online)

Com o servidor rodando, dois pedidos em sequência:

```bash
curl -sS -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -d '{"message":"abra um incidente crítico para o serviço checkout-api com título \"teste de estado\""}' | jq -r .answer

curl -sS -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -d '{"message":"liste os incidentes abertos"}' | jq -r .answer
```

**Esperado**: o segundo pedido enxerga o incidente aberto pelo primeiro (FR-012a, SC-009).

Reiniciar o servidor e repetir o segundo comando: o incidente **não** está mais lá — o
estado voltou ao baseline (FR-012c).

---

## Validação 6 — Resiliência (online)

```bash
# depois de qualquer erro acima, o servidor ainda atende:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' -d '{"message":"oi"}'
# 200
```

**Esperado**: nenhum erro previsto derruba o processo (SC-006). O log do servidor não deve
conter `unhandledRejection`.

---

## O que este guia não valida

- **O timeout de 180s em condições reais**: reproduzir exige um pedido que demore mais de
  três minutos, o que não é determinístico nem barato. A garantia está na Validação 1, com
  `timeoutMs` injetado (FR-025); o valor de produção é verificado por inspeção do padrão.
- **Concorrência sob carga**: R-008 argumenta a segurança a partir da natureza síncrona das
  transições do repositório, não a partir de teste de carga.
- **Qualidade das respostas do agente**: continua sendo assunto de `npm run bench`.
