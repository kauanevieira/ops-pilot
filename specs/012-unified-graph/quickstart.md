# Quickstart: Grafo Unificado com Roteador

**Feature**: 012-unified-graph

Roteiro de validação. Etapa 1 é o portão obrigatório (offline). Etapas 2 e 3 usam o modelo real
e exigem `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` no `.env`.

## 1. Portões offline

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, sem rede. Os testes do grafo e do `/chat` usam roteador, sumarizador e
estratégias falsos ([router.md](./contracts/router.md#dublês-de-teste)).

## 2. Roteamento, override e rastro no servidor real

```bash
npm run dev
```

Em outro terminal:

```bash
# Roteado: espera route com source "router" e nodeName em todos os eventos
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?"}' \
  | jq '{route: (.trace[] | select(.type=="route")), nodes: [.trace[].nodeName] | unique, llmCalls: .metrics.llmCalls}'

# Override: espera source "override", strategy "reflect:plan-and-execute", route "reflect"
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?","strategy":"plan-and-execute","reflect":true}' \
  | jq '.trace[] | select(.type=="route")'

# 422 inalterado, sem consultar o roteador
curl -s -w '\n%{http_code}\n' localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"oi","strategy":"planner"}'
```

Conferir:
- exatamente um evento `route` por resposta ([CH1](./contracts/chat-endpoint.md#garantias));
- `nodeName` presente em todos os eventos (CH2);
- `route` antes do primeiro evento da estratégia.

O recuo por falha do roteador (RN4) é coberto pelos testes offline da etapa 1. No servidor
real, uma falha do roteador aparece no log como `Falha ao rotear pedido:`, e a resposta traz
`source: "fallback"`.

## 3. Acerto do roteador (SC-005, manual)

Amostra anotada. Rode cada pedido sem `strategy`, sem `conversationId`, e compare `route` com a
coluna esperada. Meta: pelo menos 8 de 10.

| # | Pedido | Rota esperada |
|---|---|---|
| 1 | quais alertas estão disparando? | `react` |
| 2 | qual o status do provedor de pagamentos? | `react` |
| 3 | mostra o runbook do checkout | `react` |
| 4 | quais incidentes estão abertos? | `react` |
| 5 | investigue os alertas do checkout, descubra o time responsável e me diga qual runbook seguir | `plan-and-execute` |
| 6 | para cada alerta crítico, verifique se já existe incidente aberto e liste os que estão sem incidente | `plan-and-execute` |
| 7 | levante os alertas do payments, cheque o provedor e resuma a causa provável | `plan-and-execute` |
| 8 | abra um incidente de severidade alta para o checkout | `reflect` |
| 9 | resolva o incidente do payments que abrimos hoje | `reflect` |
| 10 | abra incidente crítico para o serviço com mais alertas disparando | `reflect` |

```bash
while IFS= read -r msg; do
  curl -s localhost:3000/chat -H 'content-type: application/json' \
    -d "$(jq -n --arg m "$msg" '{message:$m}')" \
    | jq -r --arg m "$msg" '.trace[] | select(.type=="route") | "\(.route)\t\(.source)\t\($m)\t\(.reason)"'
done <<'EOF'
quais alertas estão disparando?
qual o status do provedor de pagamentos?
mostra o runbook do checkout
quais incidentes estão abertos?
investigue os alertas do checkout, descubra o time responsável e me diga qual runbook seguir
para cada alerta crítico, verifique se já existe incidente aberto e liste os que estão sem incidente
levante os alertas do payments, cheque o provedor e resuma a causa provável
abra um incidente de severidade alta para o checkout
resolva o incidente do payments que abrimos hoje
abra incidente crítico para o serviço com mais alertas disparando
EOF
```

Os pedidos 8 a 10 têm efeito colateral e alteram o banco. Rode `npm run seed` depois, para
voltar à linha de base.

**Continuação** (FR-010): numa conversa, envie `investigue os alertas do checkout` e depois,
com o mesmo `conversationId`, `ok, abre o incidente então`. Esperado: o segundo pedido é
roteado para `reflect`, porque a conversa estabelece o serviço e a ação tem efeito colateral.
