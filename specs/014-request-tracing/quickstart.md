# Quickstart: Rastro Persistido e Logs Estruturados

**Feature**: `014-request-tracing`

Roteiro de validação ponta a ponta. Os detalhes de forma estão em
[contracts/](./contracts/) e [data-model.md](./data-model.md).

## 1. Portões offline

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, sem rede e sem credenciais. A suíte não imprime linhas JSON (logger
silencioso por default, LG6).

## 2. Identificador no `/chat` (US1)

```bash
npm run dev | tee /tmp/opspilot.log
```

Em outro terminal:

```bash
curl -s -D - localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?"}'
```

Esperado: cabeçalho `X-Request-Id: <uuid>` e o mesmo valor em `requestId` no corpo.

Erros também trazem o id:

```bash
curl -s -D - localhost:3000/chat -H 'content-type: application/json' -d '{"message":'          # 400 JSON malformado
curl -s -D - localhost:3000/chat -H 'content-type: application/json' -d '{"message":"oi","strategy":"x"}'  # 422
curl -s -D - localhost:3000/chat -H 'X-Request-Id: meu-id' -H 'content-type: application/json' \
  -d '{"message":""}'                                                                              # 400; id ≠ meu-id
```

## 3. Consulta do pedido (US2)

```bash
ID=<requestId do passo 2>
curl -s localhost:3000/requests/$ID | jq '.request, (.trace | map({type, nodeName}))'
```

Esperado: registro com `status: 200`, estratégia, `durationMs`, `llmCalls` e `modelUsed`, e o
rastro na mesma ordem do `/chat`. Comparação exata:

```bash
diff <(curl -s localhost:3000/chat -H 'content-type: application/json' -d '{"message":"liste os serviços tier-1"}' \
        | tee /tmp/r.json | jq '.trace') \
     <(curl -s localhost:3000/requests/$(jq -r .requestId /tmp/r.json) | jq '.trace')
```

Esperado: nenhuma diferença (RQ1).

- Id de um erro (passo 2): `status` 400 ou 422, `errorCode` preenchido, `trace: []`.
- `curl -s localhost:3000/requests/nao-existe` devolve 404 `request_not_found`.
- Reinicie o `npm run dev` e repita a consulta do primeiro id: mesmo resultado (RQ5).

## 4. Logs (US3)

```bash
jq -c 'select(.requestId == "'$ID'") | {event, level}' /tmp/opspilot.log
grep -c 'quais alertas' /tmp/opspilot.log    # esperado: 0
```

Esperado: `request.start`, uma linha `trace.event` por evento do rastro e `request.end` com
`status: 200`. Cada linha do arquivo passa em `jq -e . >/dev/null`. O texto da mensagem não
aparece.

Falha tratada com id: rode com `OPENROUTER_MODEL=nao/existe` e um `OPENROUTER_MODEL_FALLBACK`
válido. Esperado: uma linha `model.fallback` (ou `model.failed`) com o `requestId` do pedido e
sem mensagem de erro do provedor.

## 5. Nada muda fora do HTTP

```bash
npm run arena -- "quais alertas estão disparando?"
```

Esperado: a mesma saída de antes, sem linhas JSON. O MCP continua sem escrever em stdout
(teste existente da 006).
